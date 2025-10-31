// backend/controllers/helpers.js
import OutboundQueue from "../models/outboundQueue.js";
import AvailabilityModel from "../models/availabilityModel.js";
import { sendWhatsAppMessage, sendSMSMessage, toE164 } from "../utils/twilioClient.js";

// In-process per-phone locks (sufficient for single instance / dev)
const phoneLocks = new Map(); // phone -> boolean (locked)

/* -------------------------------------------------------------------------- */
/*                             addressShortOf                                 */
/* -------------------------------------------------------------------------- */
function addressShortOf(address = "") {
  console.log(`🐔 (controllers/helpers.js) addressShortOf called at`, new Date().toISOString(), { address });
  return String(address || "")
    .split(",")
    .slice(-2)
    .join(",")
    .replace(/,\s*UK$/i, "")
    .trim();
}

/* -------------------------------------------------------------------------- */
/*                             enqueueUnique                                  */
/* -------------------------------------------------------------------------- */
/**
 * Enqueue a unique message per phone/kind/(actId+dateISO+addressShort).
 * Prevents duplicates when shortlist + addToCart both fire.
 * Now enforced at DB layer via `dedupeKey` unique index.
 */
export async function enqueueUnique({ phone, kind, payload }) {
  console.log(`🐔 (controllers/helpers.js) enqueueUnique called at`, new Date().toISOString(), { phone, kind, hasPayload: !!payload });

  const e164 = toE164(phone);
  if (!e164 || !kind || !payload) {
    console.warn(`🐔 enqueueUnique skipped: invalid`, { e164, kind, payloadExists: !!payload });
    return { enqueued: false, skippedReason: "invalid" };
  }

  const { actId, dateISO } = payload || {};
  if (!actId || !dateISO) {
    console.warn(`🐔 enqueueUnique skipped: missing_keys`, { actId, dateISO });
    return { enqueued: false, skippedReason: "missing_keys" };
  }

  const normalizedAddressShort =
    payload.addressShort || addressShortOf(payload.address || "");
  const dedupeKey = `${e164}|${kind}|${actId}|${dateISO}|${normalizedAddressShort}`;

  try {
    const doc = {
      phone: e164,
      kind,
      payload: { ...payload, addressShort: normalizedAddressShort },
      dedupeKey,
    };

    const res = await OutboundQueue.updateOne(
      { dedupeKey },
      { $setOnInsert: doc },
      { upsert: true }
    );

    const enqueued =
      (res.upsertedCount && res.upsertedCount > 0) ||
      !!res.upsertedId ||
      (res.matchedCount === 0 && res.modifiedCount === 0);

    if (!enqueued) {
      console.log(`🐔 enqueueUnique skipped: duplicate`, { phone: e164, kind, actId, dateISO });
      return { enqueued: false, skippedReason: "duplicate" };
    }

    console.log(`🐔 enqueueUnique success`, {
      phone: e164,
      kind,
      actId,
      dateISO,
      addressShort: normalizedAddressShort,
    });
    return { enqueued: true };
  } catch (err) {
    if (err?.code === 11000) {
      console.warn(`🐔 enqueueUnique duplicate key`, { dedupeKey });
      return { enqueued: false, skippedReason: "duplicate" };
    }
    console.warn(`🐔 enqueueUnique error`, err?.message || err);
    return { enqueued: false, skippedReason: "error" };
  }
}

/* -------------------------------------------------------------------------- */
/*                                  kickQueue                                 */
/* -------------------------------------------------------------------------- */
/**
 * Process next queued message for a phone (respects in-process lock).
 * Sends WA first, then SMS fallback, then removes the queue item.
 */
export async function kickQueue(phone) {
  console.log(`🐔 (controllers/helpers.js) kickQueue called at`, new Date().toISOString(), { phone });
  const e164 = toE164(phone);
  if (!e164) {
    console.warn(`🐔 kickQueue aborted: invalid phone`, { phone });
    return;
  }
  if (phoneLocks.get(e164)) {
    console.log(`🐔 kickQueue skipped: already locked`, { e164 });
    return;
  }

  phoneLocks.set(e164, true);
  try {
    let item = await OutboundQueue.findOne({ phone: e164 }).sort({ insertedAt: 1 }).lean();
    while (item) {
      console.log(`🐔 kickQueue processing item`, {
        e164,
        kind: item.kind,
        itemId: item._id?.toString?.(),
      });

      const { kind, payload } = item;
      const { contentSid, variables, smsBody } = payload || {};

      console.log(`🐔 kickQueue sending`, {
        phone: e164,
        kind,
        hasVars: !!variables && typeof variables === "object",
        hasSmsFallback: !!smsBody,
      });

      let waOk = false;
      try {
        await sendWhatsAppMessage({
          to: e164,
          variables,
          contentSid,
          smsBody,
        });
        waOk = true;
        console.log(`🐔 kickQueue WhatsApp sent`, { e164, kind });
      } catch (waErr) {
        console.warn(`🐔 kickQueue WA send failed; fallback to SMS`, waErr?.message || waErr);
      }

      if (!waOk && smsBody) {
        try {
          await sendSMSMessage(e164, smsBody);
          console.log(`🐔 kickQueue SMS fallback sent`, { e164 });
        } catch (smsErr) {
          console.warn(`🐔 kickQueue SMS fallback failed`, smsErr?.message || smsErr);
        }
      }

      try {
        await OutboundQueue.deleteOne({ _id: item._id });
        console.log(`🐔 kickQueue deleted queue item`, { id: item._id?.toString?.() });
      } catch (delErr) {
        console.warn(`🐔 kickQueue delete item failed`, delErr?.message || delErr);
      }

      if (payload?.actId && payload?.dateISO) {
        try {
          await AvailabilityModel.updateOne(
            { phone: e164, actId: payload.actId, dateISO: payload.dateISO, v2: true },
            { $set: { updatedAt: new Date(), status: waOk ? "sent" : "queued" } }
          );
          console.log(`🐔 kickQueue updated availability status`, {
            e164,
            status: waOk ? "sent" : "queued",
          });
        } catch (updateErr) {
          console.warn(`🐔 kickQueue failed to update availability`, updateErr?.message || updateErr);
        }
      }

      item = await OutboundQueue.findOne({ phone: e164 }).sort({ insertedAt: 1 }).lean();
    }
  } catch (err) {
    console.error(`🐔 kickQueue error`, err?.message || err);
  } finally {
    phoneLocks.delete(e164);
    console.log(`🐔 kickQueue released lock`, { e164 });
  }
}

/* -------------------------------------------------------------------------- */
/*                         releaseLockAndProcessNext                          */
/* -------------------------------------------------------------------------- */
/**
 * Release the lock for a phone (after inbound reply) and immediately
 * process the next queued message, if any.
 */
export async function releaseLockAndProcessNext(phone) {
  console.log(`🐔 (controllers/helpers.js) releaseLockAndProcessNext called at`, new Date().toISOString(), { phone });
  const e164 = toE164(phone);
  if (!e164) {
    console.warn(`🐔 releaseLockAndProcessNext aborted: invalid phone`, { phone });
    return;
  }

  phoneLocks.delete(e164);
  console.log(`🐔 releaseLockAndProcessNext lock cleared`, { e164 });

  await kickQueue(e164);
  console.log(`🐔 releaseLockAndProcessNext kicked queue`, { e164 });
}

export const calculateActPricing = async (act, selectedCounty, selectedAddress, selectedDate, selectedLineup) => {
  console.groupCollapsed("🧾 calculateActPricing Debug");
  console.log("Inputs →", { actName: act?.tscName, selectedCounty, selectedAddress, selectedDate, selectedLineup });

  if (!act || !selectedLineup) {
    console.warn("⚠️ Missing act or lineup");
    console.groupEnd();
    return { total: 0, travelCalculated: false };
  }

  // helpers
  const normalizeCounty = (c) => String(c || "").toLowerCase().trim();

  // Treat band managers / non-performers as not travel-eligible
  const isManagerLike = (m = {}) => {
    const has = (s = "") => /\b(manager|management)\b/i.test(String(s));
    if (m.isManager === true || m.isNonPerformer === true) return true;
    if (has(m.instrument) || has(m.title)) return true;
    const rolesArr = Array.isArray(m.additionalRoles) ? m.additionalRoles : [];
    return rolesArr.some((r) => has(r?.role) || has(r?.title));
  };

  // Case/space-insensitive lookup for county fees, supports Map or plain object
  const getCountyFeeFromMap = (feesMap, countyName) => {
    if (!feesMap) return undefined;
    const target = normalizeCounty(countyName);
    const entries =
      typeof feesMap.forEach === "function"
        ? (() => { const arr = []; feesMap.forEach((v, k) => arr.push([k, v])); return arr; })()
        : Object.entries(feesMap);
    for (const [key, val] of entries) {
      if (normalizeCounty(key) === target) return val;
    }
    return undefined;
  };

  const hasAnyCountyFees = (feesMap) => {
    if (!feesMap) return false;
    if (typeof feesMap.size === "number") return feesMap.size > 0;
    if (typeof feesMap.forEach === "function") {
      let any = false; feesMap.forEach(() => { any = true; }); return any;
    }
    return Object.keys(feesMap || {}).length > 0;
  };

  // Try to spot a county in the address by matching fee keys (case-insensitive)
  const guessCountyFromAddress = (addr, feesMap) => {
    if (!addr || !feesMap) return "";
    const addrL = String(typeof addr === "string" ? addr : (addr?.address || addr?.postcode || "")).toLowerCase();
    const entries =
      typeof feesMap.forEach === "function"
        ? (() => { const arr = []; feesMap.forEach((v, k) => arr.push([k, v])); return arr; })()
        : Object.entries(feesMap);
    for (const [key] of entries) {
      const k = normalizeCounty(key);
      if (k && addrL.includes(k)) return key; // return original key
    }
    return "";
  };

  // Extract outward code (e.g., "SL6")
  const extractOutcode = (addr) => {
    const s = typeof addr === "string" ? addr : (addr?.postcode || addr?.address || "");
    const m = String(s || "")
      .toUpperCase()
      .match(/\b([A-Z]{1,2}\d{1,2}[A-Z]?)\s*\d[A-Z]{2}\b|\b([A-Z]{1,2}\d{1,2}[A-Z]?)\b/);
    return (m && (m[1] || m[2])) ? (m[1] || m[2]) : "";
  };

  // Robust county lookup from outcode (supports your { county: [OUTCODES...] } layout)
  const countyFromOutcode = (outcode) => {
    if (!outcode) return "";
    const OUT = String(outcode).toUpperCase().trim();
    let db = outcodeToCounty;
    if (!db && typeof window !== "undefined") {
      db = window.OUTCODE_TO_COUNTY || window.POSTCODE_TO_COUNTY || {};
    }
    if (!db) return "";

    if (typeof db.get === "function") {
      const val = db.get(OUT); // Map(OUT → County)
      if (val) return String(val);
      for (const [county, codes] of db.entries()) { // Map(County → [OUTS])
        if (Array.isArray(codes) && codes.includes(OUT)) return county.replace(/_/g, " ");
      }
      return "";
    }

    if (Array.isArray(db)) db = db[0] || {};

    const inverted = db[OUT];
    if (typeof inverted === "string") return inverted; // { "SL6": "Berkshire" }

    for (const [county, codes] of Object.entries(db)) { // { berkshire: ["SL6", ...] }
      if (Array.isArray(codes) && codes.includes(OUT)) return county.replace(/_/g, " ");
    }
    return "";
  };

  let travelFee = 0;
  let travelCalculated = false;

  // Pick a lineup
  let smallestLineup = null;
  if (selectedLineup && Array.isArray(selectedLineup.bandMembers)) {
    smallestLineup = selectedLineup;
  } else {
    smallestLineup = act.lineups?.reduce((min, lineup) => {
      if (!Array.isArray(lineup.bandMembers)) return min;
      if (!min || lineup.bandMembers.length < min.bandMembers.length) return lineup;
      return min;
    }, null);
  }
 if (!smallestLineup || !Array.isArray(smallestLineup.bandMembers)) {
  return { total: null, travelCalculated: false };
}

// 👇 add this block here
const looksTrue = (v) => v === true || v === "true" || v === 1 || v === "1";
const isTestAct =
  looksTrue(act?.isTest) || looksTrue(act?.actData?.isTest);

if (isTestAct) {
  console.log("🧪 Test act detected → forcing price £0.30");
  return { total: 0.3, travelCalculated: false, forcedTestPrice: true };
}

    console.log("🎸 Using lineup:", smallestLineup?.actSize, smallestLineup?.bandMembers?.length, "members");


  // Derive county (so we can use county travel & northern team)
  const guessedFromAddress = guessCountyFromAddress(selectedAddress, act?.countyFees);
  const outcode = extractOutcode(selectedAddress);
  const guessedFromOutcode = countyFromOutcode(outcode);
  const derivedCounty = selectedCounty || guessedFromAddress || guessedFromOutcode;
  console.log("📍 County derived:", { guessedFromAddress, outcode, guessedFromOutcode, derivedCounty });

  // Northern detection
  const northernCounties = new Set([
    "ceredigion","cheshire","cleveland","conway","cumbria","denbighshire","derbyshire","durham",
    "flintshire","greater manchester","gwynedd","herefordshire","lancashire","leicestershire",
    "lincolnshire","merseyside","north humberside","north yorkshire","northumberland",
    "nottinghamshire","rutland","shropshire","south humberside","south yorkshire",
    "staffordshire","tyne and wear","warwickshire","west midlands","west yorkshire",
    "worcestershire","wrexham","rhondda cynon taf","torfaen","neath port talbot","bridgend",
    "blaenau gwent","caerphilly","cardiff","merthyr tydfil","newport","aberdeen city",
    "aberdeenshire","angus","argyll and bute","clackmannanshire","dumfries and galloway",
    "dundee city","east ayrshire","east dunbartonshire","east lothian","east renfrewshire",
    "edinburgh","falkirk","fife","glasgow","highland","inverclyde","midlothian","moray",
    "na h eileanan siar","north ayrshire","north lanarkshire","orkney islands","perth and kinross",
    "renfrewshire","scottish borders","shetland islands","south ayrshire","south lanarkshire",
    "stirling","west dunbartonshire","west lothian"
  ]);
  const isNorthernGig = northernCounties.has(normalizeCounty(derivedCounty));
  console.log("🧭 Is northern gig?", isNorthernGig);

  // Team (for travel postcode list)
  const bandMembers =
    act.useDifferentTeamForNorthernGigs && isNorthernGig
      ? act.northernTeam || []
      : smallestLineup.bandMembers || [];
  const lineupSizeCount = Array.isArray(bandMembers) ? bandMembers.length : 0;

  // Exclude band managers/non-performers from travel calculations
  const travelEligibleMembers = Array.isArray(bandMembers) ? bandMembers.filter((m) => !isManagerLike(m)) : [];
  const travelEligibleCount = travelEligibleMembers.length;
  console.log("👥 Band members:", bandMembers.length, "Travel eligible:", travelEligibleMembers.length);

  // --- FEES (NET) ----------------------------------------------------------
  const perMemberFees = (smallestLineup.bandMembers || []).map((m) => {
    const baseFee = m.isEssential ? Number(m.fee) || 0 : 0;
    const essentialRoles = (m.additionalRoles || [])
      .filter((r) => r?.isEssential)
      .map((r) => ({ role: r?.role, fee: Number(r?.additionalFee) || 0 }));
    const rolesTotal = essentialRoles.reduce((s, r) => s + (r.fee || 0), 0);
    const memberTotal = baseFee + rolesTotal;
        console.log("💰 Member fee:", m.firstName, { baseFee, rolesTotal, memberTotal, essentialRoles });

    return {
      id: m?._id?.toString?.() || "",
      name: `${m.firstName || ""} ${m.lastName || ""}`.trim() || (m.instrument || "Member"),
      instrument: m.instrument,
      isEssential: !!m.isEssential,
      baseFee,
      rolesTotal,
      essentialRoles,
      memberTotal,
    };
  });

  const fee = perMemberFees.reduce((s, m) => s + (m.memberTotal || 0), 0);
  console.log("💸 Total base lineup fee:", fee);

  // ----- TRAVEL -----
  // County-fee path (per-member)
  const hasCountyTable = !!(act?.useCountyTravelFee && hasAnyCountyFees(act?.countyFees) && derivedCounty);
  console.log("🗺️ Travel method:", hasCountyTable ? "County table" : act.costPerMile > 0 ? "Cost per mile" : "MU Rates");

  if (hasCountyTable) {
    const feePerMemberRaw = getCountyFeeFromMap(act.countyFees, derivedCounty);
    const feePerMember = Number(feePerMemberRaw) || 0;
        console.log("📊 County travel fee per member:", feePerMember);

    if (feePerMember > 0 && travelEligibleCount > 0) {
      travelFee = feePerMember * travelEligibleCount;
      travelCalculated = true;
          console.log("🚗 Travel fee (county):", travelFee);

    }
  }

  // If county path didn't run and we don't have addr/date → return base+margin
  if (!travelCalculated && (!selectedAddress || !selectedDate)) {
    const totalPrice = Math.ceil(fee / 0.75);
        console.log("⚠️ No travel data → base + margin only", totalPrice);
    console.groupEnd();

    return { total: totalPrice, travelCalculated: false };
  }

  // Cost-per-mile path
  if (!travelCalculated && Number(act.costPerMile) > 0) {
    for (const m of travelEligibleMembers) {
      const postCode = m.postCode;
      const destination =
        typeof selectedAddress === "string"
          ? selectedAddress
          : selectedAddress?.postcode || selectedAddress?.address || "";
      if (!postCode || !destination) continue;

      const { miles } = await getTravelV2(postCode, destination, selectedDate);
      const cost = (miles || 0) * Number(act.costPerMile) * 25;
            console.log(`🛣️ ${m.firstName} travel: ${miles} miles × £${act.costPerMile}/mi × 25 →`, cost);

      travelFee += cost;
    }
    travelCalculated = true;
  } else if (!travelCalculated) {
    // MU rate path
    for (const m of travelEligibleMembers) {
      const postCode = m.postCode;
      const destination =
        typeof selectedAddress === "string"
          ? selectedAddress
          : selectedAddress?.postcode || selectedAddress?.address || "";
      if (!postCode || !destination) continue;

      const { outbound, returnTrip } = await getTravelV2(postCode, destination, selectedDate);
      if (!outbound || !returnTrip) continue;

      const totalDistanceMiles = (outbound.distance.value + returnTrip.distance.value) / 1609.34;
      const totalDurationHours = (outbound.duration.value + returnTrip.duration.value) / 3600;
      const fuelFee = totalDistanceMiles * 0.56;
      const timeFee = totalDurationHours * 13.23;
      const lateFee = (returnTrip.duration.value / 3600) > 1 ? 136 : 0;
      const tollFee = (outbound.fare?.value || 0) + (returnTrip.fare?.value || 0);
      const cost = fuelFee + timeFee + lateFee + tollFee;
      console.log(`🚕 MU Travel (${m.firstName})`, { totalDistanceMiles, totalDurationHours, fuelFee, timeFee, lateFee, tollFee, cost });

      travelFee += cost;
    }
    travelCalculated = true;
  }

  // Gross with 25% margin
  const totalPrice = Math.ceil((fee + travelFee) / 0.75);
 console.log("✅ Final:", { fee, travelFee, marginApplied: 0.25, totalPrice, travelCalculated });
  console.groupEnd();
  return { total: totalPrice, travelCalculated };
};