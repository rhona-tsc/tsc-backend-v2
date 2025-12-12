/* ===================== outcodeToCounty + helpers + calculateActPricing ===================== */



// … your outcodeToCounty mapping stays exactly as you pasted it …

// ───────────────────────────────────────────────────────────────────────────────
// Helper logging (left as-is from your version)
// ───────────────────────────────────────────────────────────────────────────────
const logIdentity = (label, obj = {}) => { /* … exactly as you had it … */ };

// 🧭 Utility: extract valid postcode string
const getValidPostcode = (p) => {
  const m = String(p || "").toUpperCase().match(/[A-Z]{1,2}\d{1,2}[A-Z]?\s*\d[A-Z]{2}/);
  return m ? m[0].replace(/\s+/g, "") : "";
};

// Your travel API function as before
async function getTravelV2(origin, destination, dateISO) { /* … exactly as you had it … */ }

// Pick a musician postcode robustly
const pickMemberPostcode = (m = {}) => {
  const raw =
    m.postCode || m.postcode || m.homePostcode || m.postalCode ||
    m?.address?.postcode || m?.address;
  return getValidPostcode(raw);
};

// Pick a destination string/postcode robustly
const pickDestinationString = (addr) => {
  if (!addr) return "";
  const raw = typeof addr === "string"
    ? addr
    : (addr.postcode || addr.postCode || addr.formattedAddress || addr.address || "");
  // Prefer a clean postcode if present; fall back to the raw string
  return getValidPostcode(raw) || String(raw || "");
};

/* ──────────────────────────────────────────────────────────────────────────────
   NOTE (server call site): make sure you SELECT the fields below when fetching!
   Example:
   const act = await actModel.findById(actId)
     .select("name tscName lineups useCountyTravelFee countyFees travelModel costPerMile")
     .lean();
   ────────────────────────────────────────────────────────────────────────────── */

// ───────────────────────────────────────────────────────────────────────────────
// calculateActPricing (forced county-vs-MU + 33% margin)
// ───────────────────────────────────────────────────────────────────────────────
const calculateActPricing = async (
  act,
  selectedCounty,
  selectedAddress,
  selectedDate,
  selectedLineup = null
) => {
  console.groupCollapsed("💷 calculateActPricing");

  if (!act) {
    console.warn("⚠️ Missing act");
    console.groupEnd();
    return { total: 0, travelCalculated: false };
  }

  // Debug: prove what keys we received
  try { console.log("🔎 act keys seen by pricing:", Object.keys(act)); } catch {}

  const normalizeCounty = (c) => String(c || "").toLowerCase().trim();
  const truthy = (v) =>
    v === true || v === 1 || v === "1" ||
    String(v).toLowerCase() === "true" ||
    String(v).toLowerCase() === "yes" ||
    String(v).toLowerCase() === "on";

  const isManagerLike = (m = {}) => {
    const has = (s = "") => /\b(manager|management)\b/i.test(String(s));
    if (m.isManager === true || m.isNonPerformer === true) return true;
    if (has(m.instrument) || has(m.title)) return true;
    const rolesArr = Array.isArray(m.additionalRoles) ? m.additionalRoles : [];
    return rolesArr.some((r) => has(r?.role) || has(r?.title));
  };

  // Accept Map | object | [{county, fee}] | [{name, price}] for county fees
  const getCountyFeeFromMap = (feesMap, countyName) => {
    if (!feesMap) return undefined;
    const target = normalizeCounty(countyName);

    if (Array.isArray(feesMap)) {
      const hit = feesMap.find(
        (x) => normalizeCounty(x?.county || x?.name || x?.key) === target
      );
      return hit ? Number(hit.fee ?? hit.price ?? hit.value) : undefined;
    }

    if (typeof feesMap.get === "function") {
      // Map
      for (const [k, v] of feesMap.entries()) {
        if (normalizeCounty(k) === target) return Number(v?.fee ?? v?.price ?? v);
      }
      return undefined;
    }

    // Plain object
    for (const [k, v] of Object.entries(feesMap)) {
      if (normalizeCounty(k) === target) return Number(v?.fee ?? v?.price ?? v);
    }
    return undefined;
  };

  const hasAnyCountyFees = (feesMap) => {
    if (!feesMap) return false;
    if (Array.isArray(feesMap)) return feesMap.length > 0;
    if (typeof feesMap.size === "number") return feesMap.size > 0;
    if (typeof feesMap.forEach === "function") {
      let any = false;
      feesMap.forEach(() => { any = true; });
      return any;
    }
    return Object.keys(feesMap || {}).length > 0;
  };

  const extractOutcode = (addr) => {
    const s = typeof addr === "string" ? addr : (addr?.postcode || addr?.address || "");
    const m = String(s || "")
      .toUpperCase()
      .match(/\b([A-Z]{1,2}\d{1,2}[A-Z]?)\s*\d[A-Z]{2}\b|\b([A-Z]{1,2}\d{1,2}[A-Z]?)\b/);
    return (m && (m[1] || m[2])) ? (m[1] || m[2]) : "";
  };

  const countyFromOutcode = (outcode) => {
    if (!outcode) return "";
    const OUT = String(outcode).toUpperCase().trim();
    let db = outcodeToCounty;
    if (Array.isArray(db)) db = db[0] || {};
    // shape: { county: [OUT,...] }
    for (const [county, codes] of Object.entries(db)) {
      if (Array.isArray(codes) && codes.includes(OUT)) return county.replace(/_/g, " ");
    }
    return "";
  };

  // ── lineup pick ─────────────────────────────────────────────────────────────
  let smallestLineup = selectedLineup && Array.isArray(selectedLineup.bandMembers)
    ? selectedLineup
    : (act.lineups || []).reduce((min, lu) =>
        (Array.isArray(lu.bandMembers) && (!min || lu.bandMembers.length < min.bandMembers.length)) ? lu : min
      , null);

  if (!smallestLineup || !Array.isArray(smallestLineup.bandMembers)) {
    console.groupEnd();
    return { total: null, travelCalculated: false };
  }

  // test-act guard
  const looksTrue = (v) => v === true || v === "true" || v === 1 || v === "1";
  const isTestAct = looksTrue(act?.isTest) || looksTrue(act?.actData?.isTest);
  if (isTestAct) {
    console.log("🧪 Test act detected → forcing price £0.50");
    console.groupEnd();
    return { total: 0.5, travelCalculated: false, forcedTestPrice: true };
  }

  console.log("🎸 Using lineup:", smallestLineup?.actSize, smallestLineup?.bandMembers?.length, "members");

  // ── county derivation ───────────────────────────────────────────────────────
  const outcodeFromAddress = extractOutcode(selectedAddress);
  const sanitizeCountyInput = (val) => {
    const s = String(val || "").trim();
    if (!s) return "";
    const oc = extractOutcode(s);
    if (oc) {
      const c = countyFromOutcode(oc);
      if (c) return c;
    }
    if (/\d/.test(s)) return "";
    return s;
  };

  const guessedFromOutcode = countyFromOutcode(outcodeFromAddress);
  const cleanedSelectedCounty = sanitizeCountyInput(selectedCounty);
  const derivedCounty = cleanedSelectedCounty || guessedFromOutcode || "";

  console.log("📍 County inputs/derivation:", {
    selectedCounty: selectedCounty ?? null,
    outcodeFromAddress: outcodeFromAddress || null,
    guessedFromOutcode: guessedFromOutcode || null,
    derivedCounty: derivedCounty || null,
    selectedDate: selectedDate || null,
  });

  // ── travel flags (FORCED: county if flag true, else MU) ─────────────────────
  const TRAVEL = act?.travelModel || {};
  const countyFees = act?.countyFees ?? TRAVEL?.countyFees ?? null;

  // read flag from several places (+ typo fallback)
  const rawUseCounty =
    act?.useCountyTravelFee ??
    act?.actData?.useCountyTravelFee ??
    TRAVEL?.useCountyTravelFee ??
    act?.useCountryTravelFee; // common typo

  const useCounty = truthy(rawUseCounty);

  console.log("🌍 Travel flags (normalized):", {
    useCounty,
    rawUseCounty,
    derivedCountyPresent: !!derivedCounty,
    hasCountyFees: hasAnyCountyFees(countyFees),
  });

  // the only two options we support now
  let decision = useCounty ? "county" : "mu";
  if (useCounty && !derivedCounty) {
    console.warn("⚠️ useCounty=true but no derivedCounty → will fallback to MU if fee can't be applied");
  }

  // ── northern team switch ────────────────────────────────────────────────────
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

  const bandMembers =
    act.useDifferentTeamForNorthernGigs && isNorthernGig
      ? act.northernTeam || []
      : smallestLineup.bandMembers || [];

  const travelEligibleMembers = Array.isArray(bandMembers)
    ? bandMembers.filter((m) => !isManagerLike(m))
    : [];
  const travelEligibleCount = travelEligibleMembers.length;

  console.log("👥 Band members:", { total: bandMembers.length, travelEligible: travelEligibleCount });

  // ── base fees ───────────────────────────────────────────────────────────────
  const perMemberFees = (smallestLineup.bandMembers || []).map((m) => {
    const baseFee = m.isEssential ? Number(m.fee) || 0 : 0;
    const essentialRoles = (m.additionalRoles || [])
      .filter((r) => r?.isEssential)
      .map((r) => ({ role: r?.role, fee: Number(r?.additionalFee) || 0 }));
    const rolesTotal = essentialRoles.reduce((s, r) => s + (r.fee || 0), 0);
    const memberTotal = baseFee + rolesTotal;

    console.log("💰 Member fee:", m.firstName, { baseFee, rolesTotal, memberTotal, essentialRoles });
    return { memberTotal };
  });

  const baseFeeTotal = perMemberFees.reduce((s, m) => s + (m.memberTotal || 0), 0);
  console.log("💸 Total base lineup fee:", baseFeeTotal);

  // ── travel calc ─────────────────────────────────────────────────────────────
  let travelFee = 0;
  let travelCalculated = false;

  // County fees (if chosen)
  if (decision === "county") {
    if (!derivedCounty) {
      console.warn("⚠️ useCounty=true but no derivedCounty → fallback to MU");
      decision = "mu";
    } else {
      const feePerMember = Number(getCountyFeeFromMap(countyFees, derivedCounty)) || 0;
      console.log("📊 County travel fee/member:", feePerMember, "(county:", derivedCounty, ")");
      if (feePerMember > 0 && travelEligibleCount > 0) {
        travelFee = feePerMember * travelEligibleCount;
        travelCalculated = true;
        console.log(`🚗 County travel total: £${travelFee} for ${travelEligibleCount} members`);
      } else {
        console.warn("⚠️ useCounty=true but fee missing/zero or no eligible members → fallback to MU");
        decision = "mu";
      }
    }
  }

  // MU path (fallback or default)
  if (!travelCalculated && decision === "mu") {
    const destination = pickDestinationString(selectedAddress);
    if (!destination || !selectedDate) {
      const finalTotal = Math.round(baseFeeTotal * 1.33); // apply margin even if travel not computed
      console.log("⚠️ No destination/date for MU distance → returning base + margin only:", finalTotal);
      console.groupEnd();
      return {
        total: finalTotal,
        travelCalculated: false,
        decision,
        baseFeeTotal,
        travelFeeTotal: 0,
        marginMultiplier: 1.33,
        beforeMarginSubtotal: baseFeeTotal,
        marginAddedApprox: Math.round(baseFeeTotal * 1.33 - baseFeeTotal),
      };
    }

    for (const m of travelEligibleMembers) {
      const origin = pickMemberPostcode(m);
      if (!origin) {
        console.warn(`⚪ Skipping MU travel for ${m.firstName || "member"} — no postcode`);
        continue;
      }

      try {
        const trip = await getTravelV2(origin, destination, selectedDate);
        if (!trip || (!trip.outbound && !trip.returnTrip)) {
          console.warn("⚠️ travelV2 returned no legs", { origin, destination });
          continue;
        }

        const out = trip.outbound;
        const ret = trip.returnTrip;
        const totalDistanceMiles = ((out?.distance?.value || 0) + (ret?.distance?.value || 0)) / 1609.34;
        const totalDurationHours = ((out?.duration?.value || 0) + (ret?.duration?.value || 0)) / 3600;

        const fuelFee = totalDistanceMiles * 0.56;
        const timeFee = totalDurationHours * 13.23;
        const lateFee = (ret?.duration?.value || 0) / 3600 > 1 ? 136 : 0;
        const tollFee = (out?.fare?.value || 0) + (ret?.fare?.value || 0);
        const cost = fuelFee + timeFee + lateFee + tollFee;

        console.log(`🚕 MU Travel (${m.firstName || "member"})`, {
          origin, destination, totalDistanceMiles, totalDurationHours, fuelFee, timeFee, lateFee, tollFee, cost,
        });

        travelFee += cost;
      } catch (err) {
        console.warn("⚠️ travelV2 failed for", m.firstName || "member", err?.message || err);
      }
    }

    travelCalculated = true;
    console.log(`🚗 MU travel fee total: £${travelFee}`);
  }

  const travelFeeTotal = travelFee;
  console.log(`🚗 Travel fee total: £${travelFeeTotal}`);

  const subtotal = baseFeeTotal + travelFeeTotal;
  console.log(`🧮 Subtotal before margin: £${subtotal}`);

  // 🔖 33% margin (×1.33) — override-able via act.pricing.marginMultiplier / act.marginMultiplier
  const marginMultiplier = Number(act?.pricing?.marginMultiplier ?? act?.marginMultiplier ?? 1.33);
  const withMargin = subtotal * marginMultiplier;

  const finalTotal = Math.round(withMargin);
  console.log("✅ Final total price (with margin, rounded):", finalTotal);

  const payload = {
    total: finalTotal,
    travelCalculated,
    decision,
    baseFeeTotal,
    travelFeeTotal,
    marginMultiplier,
    beforeMarginSubtotal: subtotal,
    marginAddedApprox: Math.round(withMargin - subtotal),
  };
  console.log("✅ Final summary:", payload);
  console.groupEnd();
  return payload;
};

export default calculateActPricing;