import React, { useEffect, useMemo, useState, useContext } from "react";
import { assets } from "../assets/assets";
import { useParams, Link } from "react-router-dom";
import axios from "axios";
import { ShopContext } from "../context/ShopContext";
import debounce from "lodash.debounce";
// ---- Debug helper (safe, no state writes) ----
const esDebug = (...args) => console.debug("[EventSheet]", ...args);


const currencySymbol = (code) => {
  if (!code) return "£";
  const map = { GBP: "£", USD: "$", EUR: "€" };
  return map[code] || "£";
};

// ---- People/role helper (used by diet + lineup logic) ----
const isManagerLike = (m = {}) => {
  const has = (s = "") => /\b(manager|management)\b/i.test(String(s));
  if (m.isManager === true || m.isNonPerformer === true) return true;
  if (has(m.instrument) || has(m.title)) return true;
  const rolesArr = Array.isArray(m.additionalRoles) ? m.additionalRoles : [];
  return rolesArr.some((r) => has(r?.role) || has(r?.title));
};

// ---- Helpers for dietary requirements, DJ detection, performance times & set options ----
const DIET_FALLBACK = "Omnivore / no requirements";

function extractDietaryRequirements(actsList = [], booking) {
  try {
    const src = Array.isArray(booking?.actsSummary) ? booking.actsSummary : Array.isArray(booking?.items) ? booking.items : [];
    const first = src[0] || {};
    const act = (actsList || []).find((a) => String(a._id) === String(first.actId));
    const lineup = act ? (act.lineups || []).find((l) => String(l._id) === String(first.lineupId || first.lineup?.lineupId)) : (first.lineup || null);
    const members = Array.isArray(lineup?.bandMembers) ? lineup.bandMembers : [];

    const clean = (s = "") => String(s || "").trim();
    const mapDiet = (s) => {
      const x = clean(s).toLowerCase();
      if (!x || x === "none" || x === "no" || x === "n/a") return DIET_FALLBACK;
      return s;
    };

    return members
      .filter((m) => !isManagerLike(m))
      .map((m) => ({
        name: [m?.firstName, m?.lastName].filter(Boolean).join(" ") || "Band member",
        instrument: m?.instrument || "",
        diet: mapDiet(m?.dietaryRequirements || m?.dietary || ""),
      }));
  } catch {
    return [];
  }
}

function hasDJBooked(booking) {
  try {
    const src = Array.isArray(booking?.actsSummary) ? booking.actsSummary : Array.isArray(booking?.items) ? booking.items : [];
    const hay = JSON.stringify(src).toLowerCase();
    return /\bdj\b/.test(hay) || Boolean(booking?.bookingDetails?.djServicesBooked);
  } catch { return false; }
}

function getPerformanceTimesFromBooking(booking) {
  // Prefer per-item performance block saved at checkout
  const src = Array.isArray(booking?.actsSummary) ? booking.actsSummary : Array.isArray(booking?.items) ? booking.items : [];
  const perf = src[0]?.performance || {};
  return {
    arrivalTime: perf.arrivalTime || "",
    setupAndSoundcheckedBy: perf.setupAndSoundcheckedBy || "",
    startTime: perf.startTime || "",
    finishTime: perf.finishTime || "",
  };
}

function getSetOptionsFromAct(actsList = [], booking) {
  // Expect: [ { sets, length, minInterval } ]
  const src = Array.isArray(booking?.actsSummary) ? booking.actsSummary : Array.isArray(booking?.items) ? booking.items : [];
  const first = src[0] || {};
  const act = (actsList || []).find((a) => String(a._id) === String(first.actId));
  let options = [];
  const fromAct = act?.performanceOptions || act?.eveningSetOptions || [];
  if (Array.isArray(fromAct) && fromAct.length) {
    options = fromAct.map((o, i) => ({
      key: `opt-${i}`,
      sets: Number(o.sets || o.numberOfSets || 0) || 0,
      length: Number(o.length || o.setLength || 0) || 0,
      minInterval: Number(o.minInterval || o.minimumInterval || o.interval || 15) || 15,
    })).filter((o) => o.sets && o.length);
  }
  if (!options.length) {
    options = [
      { key: "opt-3x40", sets: 3, length: 40, minInterval: 15 },
      { key: "opt-2x60", sets: 2, length: 60, minInterval: 30 },
    ];
  }
  return options;
}


// --- Equipment description helpers (pull from acts in context) ---
const getActEquipmentInfo = (actsList = [], booking) => {
  try {
    const src = Array.isArray(booking?.actsSummary) ? booking.actsSummary : Array.isArray(booking?.items) ? booking.items : [];
    const first = src[0] || {};
    const actId = String(first.actId || "");
    const actData = (actsList || []).find((a) => String(a._id) === actId) || {};
    const tscName = actData.tscName || actData.name || first.actName || "This act";

    // Heuristics to find PA & lighting tiers on the act object
    const paTier =
      actData.paTier ||
      actData.paSize ||
      actData?.equipment?.paSize ||
      actData?.equipment?.paTier ||
      "largePA"; // sensible default

    const lightTier =
      actData.lightsTier ||
      actData.lightingTier ||
      actData.lightSize ||
      actData.lightingSize ||
      actData?.equipment?.lightSize ||
      actData?.equipment?.lightingSize ||
      "largeLight"; // sensible default

    // Descriptions that can be reused in the UI
    const paDescriptions = {
      smallPA: `${tscName} comes with a compact PA system (up to 500 watts), ideal for background music or intimate indoor gatherings of up to 50 guests. Not recommended for dancing or outdoor use.`,
      mediumPA: `${tscName} provides a medium-sized PA system (501–1000 watts), well-suited for indoor events of up to 100 guests or laid-back outdoor performances. A great fit for amplified vocals and acoustic sets.`,
      largePA: `${tscName} delivers a high-powered PA system (1001+ watts), perfect for large indoor venues or outdoor events with 100+ guests. Designed for full band amplification and energetic, dancefloor-filling music.`,
    };

    const lightingDescriptions = {
      smallLight: `${tscName} includes subtle lighting such as uplighters or simple light bars — great for adding soft ambiance in smaller or more relaxed settings.`,
      mediumLight: `${tscName} features a versatile lighting rig with a disco T-bar and ambient light bars — ideal for medium-sized venues and dance floors needing a stylish party glow.`,
      largeLight: `${tscName} brings a full-scale lighting setup, often with two disco T-bars, moving heads, uplighters, and an LED disco ball — perfect for making a big visual impact at large events and weddings.`,
    };

    const paText = paDescriptions[paTier] || paDescriptions.largePA;
    const lightText = lightingDescriptions[lightTier] || lightingDescriptions.largeLight;

    return {
      tscName,
      paTier,
      lightTier,
      paText,
      lightText,
      blurb: `${tscName} has ${paTier === "largePA" ? "a large PA system" : paTier === "mediumPA" ? "a medium PA system" : "a small PA system"} and ${lightTier === "largeLight" ? "a large lighting rig" : lightTier === "mediumLight" ? "a medium lighting rig" : "a small lighting rig"}.`,
    };
  } catch {
    return {
      tscName: "This act",
      paTier: "largePA",
      lightTier: "largeLight",
      paText: "",
      lightText: "",
      blurb: "",
    };
  }
};

const ViewEventSheet = () => {
  const { id: routeId } = useParams(); // bookingId or mongo _id
  const { user, acts } = useContext(ShopContext);

  // Prefer user from context; fallback to localStorage `user` object
  const resolvedUserId =
    user?._id ||
    (() => {
      try {
        const raw = localStorage.getItem("user");
        return raw ? JSON.parse(raw)?._id || null : null;
      } catch {
        return null;
      }
    })();


    
  const [booking, setBooking] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notifying, setNotifying] = useState(false);

  // All answers are stored in one object keyed by section field names
  const [answers, setAnswers] = useState({});
  // Track which sections are complete
  const [complete, setComplete] = useState({});
  // Prevent repeated hydration loops
  const hydratedRef = React.useRef(null);

  const backendUrl = import.meta.env.VITE_BACKEND_URL;

  // --- helpers ---
  const lsKey = (bid) => `eventSheet:${bid || "unknown"}`;


async function notifyBand(payload) {
  try {
    const res = await axios.post(`${backendUrl}/api/booking/notify-band`, payload);
    console.log("✅ Band notified:", res.data);
    return res.data;
  } catch (err) {
    console.error("❌ notifyBand failed:", err);
    throw err;
  }
}
// --- Ensure we only send JSON-serializable, safe data ---
const sanitizeForSave = (obj) => {
  try {
    const seen = new WeakSet();
    const out = JSON.parse(
      JSON.stringify(obj, (key, value) => {
        // Drop functions and React elements/fragments
        if (typeof value === "function") return undefined;
        if (value && typeof value === "object") {
          // React element heuristic (has $$typeof) or cyclic
          if (value.$$typeof) return undefined;
          if (seen.has(value)) return undefined;
          seen.add(value);
        }
        return value;
      })
    );
    return out;
  } catch (e) {
    console.warn("sanitizeForSave failed; falling back to empty object", e);
    return {};
  }
};

// --- Debounced autosave helper (no lodash) ---
const saveTimerRef = React.useRef(null);

const saveEventSheet = (nextAnswers, nextComplete = complete) => {
  if (!booking) return;

  // cancel any pending save
  if (saveTimerRef.current) clearTimeout(saveTimerRef.current);

  const bookingKey = booking.bookingId || booking._id;
esDebug("saveEventSheet called", { bookingKey, nextAnswers, nextComplete });
  // Sanitize to avoid non-serializable values slipping in
  const safeAnswers = sanitizeForSave(nextAnswers);
  const safeComplete = sanitizeForSave(nextComplete);
  const eventSheet = {
    answers: safeAnswers,
    complete: safeComplete,
    submitted: !!booking?.eventSheet?.submitted,
    updatedAt: new Date().toISOString(),
  };
  // Use only bookingId and eventSheet in payload for API
  const payload = { bookingId: bookingKey, eventSheet };


  try {
  // inspect in DevTools: window._eventSheetDebug
  window._eventSheetDebug = { bookingKey, eventSheet };
  esDebug("local snapshot prepared", {
    sizeBytes: new Blob([JSON.stringify(eventSheet)]).size,
  });
} catch {}

  // Local quick-save (always safe JSON)
  try {
    localStorage.setItem(`eventSheet:${bookingKey}`, JSON.stringify(eventSheet));
  } catch (e) {
    console.warn("Local quick-save failed:", e?.message);
  }

  // debounce network save ~600ms with richer diagnostics
  saveTimerRef.current = setTimeout(async () => {
    const url = `${backendUrl}/api/booking/update-event-sheet`;
    try {
      const jsonStr = JSON.stringify(payload);
      const bytes = new Blob([jsonStr]).size;
      if (bytes > 900_000) {
        console.warn("⚠️ Payload is large (", bytes, "bytes). Consider trimming heavy fields.");
      }
      esDebug("POST /api/booking/update-event-sheet", {
  url,
  bookingKey,
  payloadKeys: Object.keys(eventSheet),
});
      const resp = await axios.post(url, payload, { headers: { "X-EventSheet-Client": "frontend", "Content-Type": "application/json" } });
      if (resp?.status >= 200 && resp?.status < 300) {
        // ok
        esDebug("autosave OK", {
  status: resp.status,
  bookingId: resp?.data?.bookingId || bookingKey,
});
      } else {

        console.warn("Autosave non-2xx:", resp?.status, resp?.data);
      }
    } catch (e) {
      const status = e?.response?.status;
      const data = e?.response?.data;
      esDebug("autosave ERROR", {
  status: e?.response?.status,
  data: e?.response?.data,
});
      console.error("Autosave failed →", { url, status, data, message: e?.message });
      console.warn("Autosave failed (kept locally).");
    }
  }, 600);
};

// --- Fix: use `key` param (not `field`) and autosave with the updated object ---
const handleAnswer = (key, value) => {
  setAnswers(prev => {
    if (Object.is(prev[key], value)) return prev; // no-op
    const updated = { ...prev, [key]: value };
    saveEventSheet(updated, complete);
    return updated;
  });
};


// Normalize parking_checkout_status once if a non-string slipped in
useEffect(() => {
  const val = answers?.parking_checkout_status;

  // Only act if it's *not* a string and we can produce a stable string
  if (val && typeof val !== "string") {
    const nextVal = val?.props ? "Paid" : String(val);

    // Only update if it would actually change the value
    if (answers.parking_checkout_status !== nextVal) {
      setAnswers(prev => {
        if (prev.parking_checkout_status === nextVal) return prev;
        const next = { ...prev, parking_checkout_status: nextVal };
        saveEventSheet(next, complete);
        return next;
      });
    }
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [answers?.parking_checkout_status]); // keep deps minimal

const handleGenerateParkingInvoice = async ({ amountPence }) => {
  try {
    const amount = Math.round(Number(amountPence || 0));
    if (!amount) {
      alert("Enter a valid parking amount first.");
      return;
    }

    const resp = await axios.post(`${backendUrl}/api/payments/parking-checkout`, {
      bookingId: booking?.bookingId,
            amount,             // integer pence
      currency: "gbp",
      description: `Parking payment for booking ${booking?.bookingId}`    });

    const url = resp?.data?.url;
    if (!url) {
      console.error("No checkout URL returned:", resp?.data);
      alert("Could not start checkout (no URL).");
      return;
    }

    window.location.href = url; // go straight to Stripe Checkout
  } catch (e) {
    console.error("parking-checkout error", e?.response?.data || e);
    alert(e?.response?.data?.message || e.message || "Stripe error");
  }
};

console.log("Stripe key present:", !!import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY);


const generateDescription = (itemOrLineup) => {
  if (!itemOrLineup) return "";

  // accept either a lineup or an item containing a lineup/bandMembers
  const lineup =
    itemOrLineup.lineup || itemOrLineup;

  const bandMembers = Array.isArray(lineup?.bandMembers)
    ? lineup.bandMembers
    : Array.isArray(itemOrLineup?.bandMembers)
    ? itemOrLineup.bandMembers
    : [];

  // count label: prefer explicit bandMembersCount or actSize -> 5 / "5-Piece"
  const actSizeStr =
    lineup?.actSize ||
    itemOrLineup?.actSize ||
    (itemOrLineup?.bandMembersCount
      ? `${itemOrLineup.bandMembersCount}-Piece`
      : bandMembers.length
      ? `${bandMembers.length}-Piece`
      : "");

  const capWords = (str = "") =>
    String(str).replace(/\b\w/g, (c) => c.toUpperCase());

  // instrument aliases/normalisation
  const alias = {
    "acoustic guitar": "Guitar",
    "electric guitar": "Guitar",
    "acoustic bass guitar": "Bass Guitar",
    "double bass": "Bass Guitar",
    "lead vocal": "Lead Vocal",
    "lead female vocal": "Lead Female Vocal",
    "lead male vocal": "Lead Male Vocal",
    vox: "Vocal",
  };

  // instruments: essentials only, exclude management/non-performers
  const instruments = bandMembers
    .filter((m) => (m?.isEssential ?? true) && !isManagerLike(m))
    .map((m) => {
      const raw = String(m.instrument || "").trim();
      const norm = alias[raw.toLowerCase()] || raw;
      return capWords(norm);
    })
    .filter(Boolean);

  // sort: vocals first, drums last
  instruments.sort((a, b) => {
    const A = a.toLowerCase();
    const B = b.toLowerCase();
    const isVocal = (s) => s.includes("vocal");
    const isDrums = (s) => s === "drums";
    if (isVocal(A) && !isVocal(B)) return -1;
    if (!isVocal(A) && isVocal(B)) return 1;
    if (isDrums(A) && !isDrums(B)) return 1;
    if (!isDrums(A) && isDrums(B)) return -1;
    return 0;
  });

  // unique + nice “A, B & C”
  const uniq = [...new Set(instruments)];
  const withAnd =
    uniq.length <= 1
      ? (uniq[0] || "")
      : uniq.length === 2
      ? `${uniq[0]} & ${uniq[1]}`
      : `${uniq.slice(0, -1).join(", ")} & ${uniq[uniq.length - 1]}`;

  // essential services (e.g. Sound Engineering) – optional tail
  const roles = bandMembers.flatMap((m) =>
    (m.additionalRoles || [])
      .filter((r) => r.isEssential)
      .map((r) => capWords(r.role || "Unnamed Service"))
  );
  const rolesUniq = [...new Set(roles)];
  const rolesTail = rolesUniq.length
    ? ` (including ${rolesUniq.length === 1 ? rolesUniq[0] : rolesUniq.slice(0, -1).join(", ") + " & " + rolesUniq.slice(-1)} services)`
    : "";

  if (!actSizeStr && !withAnd) return "";
  return `${actSizeStr ? `${actSizeStr} ` : ""}${withAnd ? `(${withAnd})` : ""}${rolesTail}`;
};

  // Normalize items from actsSummary/items with best-guess name & price
  const normalizedItems = useMemo(() => {
    if (!booking) return [];
    const src = Array.isArray(booking.actsSummary)
      ? booking.actsSummary
      : Array.isArray(booking.items)
      ? booking.items
      : [];

    return src.map((it) => {
      const label =
        it.name ||
        it.actName ||
        it.tscName ||
        // last resort: build something readable
        [it.actName || it.name, it.lineupName || it.lineupId]
          .filter(Boolean)
          .join(" – ") ||
        "Booking item";

      // Try several price locations
      const price =
        Number(it.price ?? NaN) ||
        Number(it.subtotalWithMargin ?? NaN) ||
        Number(it.adjustedTotal ?? NaN) ||
        Number(it?.prices?.adjustedTotal ?? NaN) ||
        Number(it?.prices?.subtotalWithMargin ?? NaN) ||
        0;

      return {
        label,
        price,
        quantity: Number(it.quantity || 1),
        extras: Array.isArray(it.selectedExtras) ? it.selectedExtras : [],
      };
    });
  }, [booking]);

  const asArray = (v) => (Array.isArray(v) ? v : []);

  // Helper to format richer lineup label for an item
  const formatLineupLabel = (it = {}) => {
    const fromSets =
      Array.isArray(it.selectedAfternoonSets) && it.selectedAfternoonSets.length
        ? it.selectedAfternoonSets.map((s) => s.name).join(" • ")
        : null;
    const countLabel = it.bandMembersCount ? `${it.bandMembersCount}-Piece` : "";
    return fromSets || it.lineupLabel || it.lineupName || countLabel || "";
  };

  // Enrich items with image, extras, and computed totals
  const enrichedItems = useMemo(() => {
    if (!booking) return [];
    const src = Array.isArray(booking.actsSummary)
      ? booking.actsSummary
      : Array.isArray(booking.items)
      ? booking.items
      : [];

    return src.map((it) => {
      const imageUrl = it?.image?.url || it?.image || "";
      const actName =
        it.actName ||
        it.tscName ||
        (typeof it.name === "string"
          ? it.name.replace(/^Booking:\s*/, "").split(" - ")[0]
          : "Act");
      const lineupLabel = it.lineupLabel || it.lineupName || it.actSize || "";

      const basePrice =
        Number(it?.prices?.adjustedTotal ?? NaN) ||
        Number(it?.prices?.subtotalWithMargin ?? NaN) ||
        Number(it?.adjustedTotal ?? NaN) ||
        Number(it?.subtotalWithMargin ?? NaN) ||
        Number(it?.price ?? NaN) ||
        Number(it?.total ?? NaN) ||
        0;

      const extras = Array.isArray(it.selectedExtras) ? it.selectedExtras : [];
      const extrasTotal = extras.reduce((s, ex) => s + (Number(ex.price) || 0), 0);
      const total = basePrice + extrasTotal;

      return {
        actId: it.actId || it._id,
        imageUrl,
        actName,
        lineupLabel,
        basePrice,
        extras,
        extrasTotal,
        total,
        richerLineupLabel: formatLineupLabel(it),
      };
    });
  }, [booking]);

  // Booking-level totals (fallback to sum of items if schema missing)
  const fullAmount = useMemo(() => {
    const modelTotal = Number(booking?.totals?.fullAmount ?? NaN);
    if (Number.isFinite(modelTotal) && modelTotal > 0) return modelTotal;
    return enrichedItems.reduce((s, i) => s + (Number(i.total) || 0), 0);
  }, [booking, enrichedItems]);

  const depositAmount = Number(booking?.totals?.depositAmount ?? 0);
  const remainingAmount = Math.max(0, fullAmount - depositAmount);

  // Pro-rate deposit across items for a per-item view
  const detailedItems = useMemo(() => {
    const fa = fullAmount || 0;
    const dep = depositAmount || 0;
    return enrichedItems.map((it) => {
      const share = fa > 0 ? Math.round((dep * (it.total / fa)) * 100) / 100 : 0;
      const remaining = Math.max(0, it.total - share);
      return { ...it, depositShare: share, remainingShare: remaining };
    });
  }, [enrichedItems, fullAmount, depositAmount]);

  // Act(s) display: dedupe act names from normalized items
const actNames = useMemo(() => {
  const names = normalizedItems
    .map((i) => i.tscName || i.name || i.label)
    .filter(Boolean);
  return [...new Set(names)].join(" + ");
}, [normalizedItems]);

  // Venue string: prefer explicit venue field, fall back to venueAddress
  const venueString = useMemo(() => {
    if (!booking) return "—";
    return booking.venue || booking.venueAddress || "—";
  }, [booking]);

// Make a friendly instrument list from a lineup, including essential service roles
const describeLineup = (lineup = {}) => {
  try {
    const members = Array.isArray(lineup.bandMembers) ? lineup.bandMembers : [];
    if (!members.length) return "";
    const cap = (s = "") => String(s).replace(/\b\w/g, (c) => c.toUpperCase());

    const isEssential = (m = {}) => {
      if (m.isEssential === true) return true;
      const roles = Array.isArray(m.additionalRoles) ? m.additionalRoles : [];
      return roles.some((r) => r?.isEssential === true);
    };

    const formatWithAnd = (arr = []) => {
      const uniq = [...new Set(arr.filter(Boolean))];
      if (uniq.length === 0) return "";
      if (uniq.length === 1) return uniq[0];
      if (uniq.length === 2) return `${uniq[0]} & ${uniq[1]}`;
      return `${uniq.slice(0, -1).join(", ")} & ${uniq[uniq.length - 1]}`;
    };

    // Instruments from essential performers only
    const instruments = members
      .filter(isEssential)
      .map((m) => cap(m.instrument || "").trim())
      .filter(Boolean);

    const weight = (s) => {
      const x = s.toLowerCase();
      if (x.includes("vocal")) return 0;
      if (x === "drums" || x.includes("drum")) return 999;
      return 100;
    };
    const uniqueInstruments = [...new Set(instruments)].sort((a, b) => weight(a) - weight(b));
    if (!uniqueInstruments.length) return "";

    const instrumentsStr = formatWithAnd(uniqueInstruments);

    // Essential service roles (e.g., Sound Engineering, Band Management)
    const roles = members.flatMap((m) =>
      (m.additionalRoles || [])
        .filter((r) => r?.isEssential)
        .map((r) => cap(r.role || r.title || "Unnamed Service"))
    );
    const rolesStr = formatWithAnd(roles);
    const rolesTail = rolesStr ? ` (including ${rolesStr} services)` : "";

    // Return instruments plus roles tail; caller wraps with parentheses
    return `${instrumentsStr}${rolesTail}`;
  } catch {
    return "";
  }
};

// Find the full lineup object for a booking item using acts in context
const resolveLineup = (actsList = [], item = {}) => {
  const act = (actsList || []).find((a) => String(a._id) === String(item.actId));
  if (!act) return null;
  const lid = String(item.lineupId || "");
  return (act.lineups || []).find(
    (l) => String(l._id) === lid || String(l.lineupId) === lid
  );
};

// Resolve lineup and default car count (based on number of band members in lineup)
const { lineup, defaultCars } = useMemo(() => {
  const src = Array.isArray(booking?.actsSummary)
    ? booking.actsSummary
    : Array.isArray(booking?.items)
    ? booking.items
    : [];

  // For parking, default to the TOTAL number of performers across all booked lineups
  // (exclude managers/non‑performers). Fallbacks: bandMembersCount or parsed actSize.
  const totalCars = src.reduce((sum, it) => {
    const ln = resolveLineup(acts, it) || it.lineup || null;

    // 1) Prefer explicit bandMembers on the resolved lineup
    if (Array.isArray(ln?.bandMembers)) {
      const count = ln.bandMembers.filter((m) => !isManagerLike(m)).length;
      return sum + (count || 0);
    }

    // 2) Fallback: bandMembersCount from item
    const byCount = Number(it.bandMembersCount || 0);
    if (Number.isFinite(byCount) && byCount > 0) return sum + byCount;

    // 3) Fallback: parse numeric part of actSize like "4-Piece"
    const sizeStr = ln?.actSize || it.actSize || "";
    const parsed = parseInt(String(sizeStr).match(/\d+/)?.[0] || "", 10);
    if (Number.isFinite(parsed) && parsed > 0) return sum + parsed;

    return sum;
  }, 0);

  // Per-item diagnostics + secondary fallbacks
  const perItemDebug = src.map((it) => {
    const ln = resolveLineup(acts, it) || it.lineup || null;
    const hasMembers = Array.isArray(ln?.bandMembers);
    const membersCount = hasMembers ? ln.bandMembers.length : 0;
    const filteredCount = hasMembers ? ln.bandMembers.filter((m) => !isManagerLike(m)).length : 0;
    const sizeStr = (ln?.actSize || it.actSize || it.lineupLabel || it.lineupName || "").toString();
    const parsed = parseInt(String(sizeStr).match(/\d+/)?.[0] || "", 10);
    const fallbackCount = Number(it.bandMembersCount || 0);
    return { sizeStr, parsed, hasMembers, membersCount, filteredCount, fallbackCount };
  });

  let cars = totalCars;
  if (!cars || cars <= 0) {
    // 4) Fallback to any parsed actSize across items
    const parsedSum = perItemDebug.reduce((s, d) => s + (Number.isFinite(d.parsed) ? d.parsed : 0), 0);
    if (parsedSum > 0) cars = parsedSum;
  }
  if (!cars || cars <= 0) {
    // 5) Fallback to bandMembersCount across items
    const countSum = perItemDebug.reduce((s, d) => s + (Number.isFinite(d.fallbackCount) ? d.fallbackCount : 0), 0);
    if (countSum > 0) cars = countSum;
  }

  // As a last resort, if we still have 0 but header shows something like "4-Piece", try to parse from it
  if ((!cars || cars <= 0) && src.length) {
    const headerLike = src
      .map((it) => (it.lineupLabel || it.lineupName || it.actSize || "").toString())
      .filter(Boolean)
      .join("+");
    const headerParsed = parseInt(String(headerLike).match(/\d+/)?.[0] || "", 10);
    if (Number.isFinite(headerParsed) && headerParsed > 0) cars = headerParsed;
  }

  // Debug logs to help trace why cars might be 0
  console.debug("[Parking] cars compute", {
    itemsCount: src.length,
    totalCars_initial: totalCars,
    cars_after_fallbacks: cars,
    perItemDebug,
  });

  const firstItem = src[0] || {};
  const resolved = resolveLineup(acts, firstItem) || firstItem.lineup || null;

  return { lineup: resolved, defaultCars: cars };
}, [booking, acts]);

useEffect(() => {
  const dc = Number(defaultCars);
  if (!Number.isFinite(dc) || dc <= 0) return;

  const current = Number(answers.parking_num_cars);
  if (!Number.isFinite(current) || current <= 0) {
    if (current !== dc) {
      handleAnswer("parking_num_cars", dc);
    }
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [defaultCars]);


const headerLineup = useMemo(() => {
  const src = Array.isArray(booking?.actsSummary)
    ? booking.actsSummary
    : Array.isArray(booking?.items)
    ? booking.items
    : [];

  const parts = src
    .map((it) => {
      const lineup = resolveLineup(acts, it);
      const label =
        it.lineupLabel ||
        lineup?.actSize ||
        (Array.isArray(lineup?.bandMembers) ? `${lineup.bandMembers.length}-Piece` : "");
      const desc = lineup ? describeLineup(lineup) : "";
      return [label, desc && ` - ${desc}`].filter(Boolean).join(" ");
    })
    .filter(Boolean);

  return [...new Set(parts)].join(" + ");
}, [booking, acts]);

  // Fetch booking(s) for the user, with robust fallbacks by route id/ref.
  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        console.log("👤 ViewEventSheet resolvedUserId:", resolvedUserId, "routeId:", routeId);
        let match = null;

if (routeId) {
  // 0a) Try by human ref first (works for BOTH forms)
  try {
    const byRefResp = await axios.get(`${backendUrl}/api/booking/by-ref/${routeId}`);
    const data = byRefResp?.data;
    const b = data?.booking || (Array.isArray(data) ? data[0] : null) || data;
    if (b?._id || b?.bookingId) {
      match = b;
      console.log("🎯 Loaded booking by-ref:", match);
    }
  } catch (e) {
    console.warn("by-ref lookup failed:", e?.message);
  }

  // 0b) Only try by _id if it *looks* like an ObjectId
  const looksLikeMongoId = /^[0-9a-f]{24}$/i.test(routeId);
  if (!match && looksLikeMongoId) {
    try {
      const byId = await axios.get(`${backendUrl}/api/booking/booking/${routeId}`);
      if (byId?.data?._id) {
        match = byId.data;
        console.log("🎯 Loaded booking by _id:", match);
      }
    } catch (e) {
      console.warn("by-_id lookup failed:", e?.message);
    }
  }
}
        // 1) If not matched yet, and we have a user, try user bookings list
        if (!match && resolvedUserId) {
          console.log("🛰️ Fetching bookings for user:", resolvedUserId, "from", backendUrl);
          let list = [];

          // Try GET user route
          try {
            const getResp = await axios.get(`${backendUrl}/api/booking/user/${resolvedUserId}`);
            const data = getResp?.data;
            list = Array.isArray(data)
              ? data
              : Array.isArray(data?.bookings)
              ? data.bookings
              : Array.isArray(data?.data)
              ? data.data
              : [];
            console.log("📦 GET user bookings:", list.length);
          } catch {}

          // Fallback POST if needed
          if (list.length === 0) {
            try {
              const postResp = await axios.post(`${backendUrl}/api/booking/user`, {
                userId: resolvedUserId,
              });
              const data = postResp?.data;
              list = Array.isArray(data)
                ? data
                : Array.isArray(data?.bookings)
                ? data.bookings
                : Array.isArray(data?.data)
                ? data.data
                : [];
              console.log("📦 POST user bookings:", list.length);
            } catch {}
          }

          // If we have a routeId, try to match within the user list too
          if (routeId && list.length) {
            match =
              list.find((b) => b.bookingId === routeId) ||
              list.find((b) => String(b._id) === String(routeId)) ||
              null;
          }
          // else pick newest
          if (!match && list.length) {
            match = [...list].sort((a, b) => {
              const ta = new Date(a.createdAt || a.updatedAt || a.date || 0).getTime();
              const tb = new Date(b.createdAt || b.updatedAt || b.date || 0).getTime();
              return tb - ta;
            })[0];
          }
        }

        console.log("✅ Selected booking:", match);
        setBooking(match || null);


      } catch (e) {
        console.error("Error fetching booking:", e);
        setBooking(null);
      } finally {
        setLoading(false);
      }
    })();
  }, [routeId, resolvedUserId, backendUrl]);

  useEffect(() => {
  if (!booking) return;

  const key = (booking.bookingId || booking._id) ? `eventSheet:${booking.bookingId || booking._id}` : null;
  esDebug("hydrate start", { key, hasBooking: !!booking });
  if (!key) return;
  if (hydratedRef.current === key) return; // already hydrated this booking

  const raw = localStorage.getItem(key);
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      esDebug("hydrated from localStorage", {
  key,
  answersKeys: Object.keys(parsed.answers || {}).length,
  completeKeys: Object.keys(parsed.complete || {}).length,
});
      setAnswers(parsed.answers || {});
      setComplete(parsed.complete || {});
    } catch {
      // fall back to server sheet
      if (booking.eventSheet) {
        esDebug("hydrated from server eventSheet", {
  key,
  serverSheet: {
    answersKeys: Object.keys(booking.eventSheet?.answers || {}).length,
    completeKeys: Object.keys(booking.eventSheet?.complete || {}).length,
    submitted: !!booking.eventSheet?.submitted,
  },
});
        setAnswers(booking.eventSheet.answers || {});
        setComplete(booking.eventSheet.complete || {});
      }
    }
  } else if (booking.eventSheet) {
    setAnswers(booking.eventSheet.answers || {});
    setComplete(booking.eventSheet.complete || {});
  } else {
    // seed from song suggestions if nothing saved
    const src = Array.isArray(booking.actsSummary)
      ? booking.actsSummary
      : Array.isArray(booking.items)
      ? booking.items
      : [];
    const suggestions = src.flatMap((it) =>
      Array.isArray(it.songSuggestions) ? it.songSuggestions : []
    );
    esDebug("seeding from suggestions", { suggestionsCount: suggestions.length });
    const suggestionsText = suggestions
    
      .map((s) => {
        const t = (s.title || "").trim();
        const a = (s.artist || "").trim();
        if (t && a) return `${t} – ${a}`;
        return t || a;
      })
      .filter(Boolean)
      .join("\n");
    setAnswers(suggestionsText ? { song_suggestions: suggestionsText } : {});
    setComplete({});
  }
esDebug("hydrate done", { key });
  hydratedRef.current = key;
}, [booking]);


// After your other effects:
useEffect(() => {
  const params = new URLSearchParams(window.location.search);
  if (!booking) return;

  if (params.get("parkingPaid") === "1") {
    const updated = { ...answers, parking_checkout_status: "Paid" };
    setAnswers(updated);
    saveEventSheet(updated, complete);
  } else if (params.get("parkingCanceled") === "1") {
    const updated = { ...answers, parking_checkout_status: "canceled" };
    setAnswers(updated);
    saveEventSheet(updated, complete);
  }
}, [booking]); // runs when booking is available

  // --- Equipment help text (memoized) ---
  const equipmentHelp = useMemo(() => {
    const info = getActEquipmentInfo(acts, booking);
    // Prefer the richer, user-friendly descriptions if available.
    const parts = [info.paText, info.lightText].filter(Boolean);
    if (parts.length) return parts.join(" ");
    return info.blurb || "";
  }, [acts, booking]);

  // --- Sections definition (labels + required fields) ---
const sections = useMemo(() => {
  // Derive packdown time (minutes) from the selected lineup; fallback to 60
  const _srcForPackdown = Array.isArray(booking?.actsSummary)
    ? booking.actsSummary
    : Array.isArray(booking?.items)
    ? booking.items
    : [];
  const _firstItemForPackdown = _srcForPackdown[0] || {};
  const _resolvedForPackdown =
    resolveLineup(acts, _firstItemForPackdown) || _firstItemForPackdown?.lineup || null;
  const packdownTime = Number(_resolvedForPackdown?.packdownTime) || 60;

  return [
    
{ 
  id: "client_names",
  title: "Couple's Names",
  help: "Could you kindly confirm your and your partner's name?",
  fields: [
    { key: "partner1_first", label: "First name", type: "text" },
    { key: "partner1_last",  label: "Last name",  type: "text" },
    { key: "partner2_first", label: "First name", type: "text" },
    { key: "partner2_last",  label: "Last name",  type: "text" },
    { 
      key: "introduced_as", 
      label: "How would you like to be introduced to the dancefloor?", 
      type: "text",
      placeholder: "e.g. Mr & Mrs Smith"
    },
  ],
},      {
        id: "attire",
        title: "Attire",
        help: "Would you like the band to dress as per their promomotional videos. Or would you prefer them to be dressed differently?"
,
        fields: [{ key: "attire_notes", placeholder: "Preferred look", type: "textarea" }],
      },
{
  id: "location",
  title: "Location & Load-in",
  help: (
    <>
      For address we have <strong>{booking?.venueAddress || "—"}</strong>. In addition to this please provide:
    </>
  ),
  fields: [
{
  key: "pins_group",
  label: "",
  type: "custom",
  render: () => (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 items-start">
      {/* Left column: Google + W3W pins */}
      <div className="flex flex-col gap-2">
        {/* Google Maps pin */}
        <div>
          <label className="text-sm text-gray-700 mb-1 block">
            A{" "}
            <a
              href="https://www.google.com/maps"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[#ff6667] underline hover:opacity-80"
            >
              GoogleMaps
            </a>{" "}
            pin of the venue location:
          </label>
          <input
            type="text"
            className="border rounded px-2 py-1 text-sm text-gray-800 w-full"
            value={answers.venue_pin || ""}
            onChange={(e) => handleAnswer("venue_pin", e.target.value)}
          />
        </div>

        {/* What3Words pin */}
        <div>
          <label className="text-sm text-gray-700 mb-1 block">
            A{" "}
            <a
              href="https://what3words.com/"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[#ff6667] underline hover:opacity-80"
            >
              What3Words
            </a>{" "}
            pin for loading in:
          </label>
          <input
            type="text"
            className="border rounded px-2 py-1 text-sm text-gray-800 w-full"
            value={answers.load_in_pin || ""}
            onChange={(e) => handleAnswer("load_in_pin", e.target.value)}
          />
        </div>
      </div>

      {/* Right column: special directions */}
      <div>
        <label className="text-sm text-gray-700 mb-1 block">
          Any special instructions in terms of arriving to the venue, or where the band should load in from.
        </label>
        <textarea
          className="border rounded px-2 py-1 text-sm text-gray-800 min-h-[88px] w-full"
          value={answers.load_in_instructions || ""}
          onChange={(e) => handleAnswer("load_in_instructions", e.target.value)}
        />
      </div>
    </div>
  ),
},
   
  ],
},
    {
      id: "points_of_contact",
      title: "Points of Contact",
      help: (() => {
        const info = getActEquipmentInfo(acts, booking);
        const name = info?.tscName || "the act";
        return `Please provide points of contact on the day (name, mobile, and role). For example, ${name}'s point of contact. You can add multiple personal or venue contacts. The band's emergency line and event code are shown below.`;
      })(),
      fields: [
        {
          key: "poc_combined",
          type: "custom",
          render: () => {
            const ensureArray = (v) => (Array.isArray(v) ? v : []);

            const personal = ensureArray(answers.contacts_personal);
            const venue = ensureArray(answers.contacts_venue);

            const updatePersonal = (idx, key, value) => {
              const next = [...(personal.length ? personal : [{ name: "", phone: "", role: "" }])];
              if (!next[idx]) next[idx] = { name: "", phone: "", role: "" };
              next[idx] = { ...next[idx], [key]: value };
              handleAnswer("contacts_personal", next);
            };

            const addPersonal = () => {
              const next = [...personal, { name: "", phone: "", role: "" }];
              handleAnswer("contacts_personal", next);
            };

            const updateVenue = (idx, key, value) => {
              const next = [...(venue.length ? venue : [{ name: "", phone: "", role: "" }])];
              if (!next[idx]) next[idx] = { name: "", phone: "", role: "" };
              next[idx] = { ...next[idx], [key]: value };
              handleAnswer("contacts_venue", next);
            };

            const addVenue = () => {
              const next = [...venue, { name: "", phone: "", role: "" }];
              handleAnswer("contacts_venue", next);
            };

            const renderContactRows = (rows, onUpdate, prefix) => {
              const safeRows = rows.length ? rows : [{ name: "", phone: "", role: "" }];
              return (
                <div className="flex flex-col gap-3">
                  {safeRows.map((row, i) => (
                    <div key={`${prefix}-${i}`} className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                      <input
                        type="text"
                        className="border rounded px-2 py-1 text-sm text-gray-800"
                        placeholder="Name"
                        value={row?.name || ""}
                        onChange={(e) => onUpdate(i, "name", e.target.value)}
                      />
                      <input
                        type="tel"
                        className="border rounded px-2 py-1 text-sm text-gray-800"
                        placeholder="Mobile number"
                        value={row?.phone || ""}
                        onChange={(e) => onUpdate(i, "phone", e.target.value)}
                      />
                      <input
                        type="text"
                        className="border rounded px-2 py-1 text-sm text-gray-800"
                        placeholder="Role (e.g., Bridesmaid, Best Man)"
                        value={row?.role || ""}
                        onChange={(e) => onUpdate(i, "role", e.target.value)}
                      />
                    </div>
                  ))}
                </div>
              );
            };

            // ---- read-only emergency number + code from booking ----
            const ec = booking?.eventSheet?.emergencyContact || {}; // preferred if mirrored there
            const cr = booking?.contactRouting || {};               // backend routing source

            const emergencyNumber = ec.number || cr.proxyNumber || ""; // E.164 (+44...)
            const ivrCode = ec.ivrCode || cr.ivrCode || "";           // 5–6 digits
            const noteText =
              ec.note ||
              "This number rings the band on the day. Enter the event code when prompted. It’s typically active from 5pm the day before and on the event day.";
            const activeSummary =
              ec.activeWindowSummary ||
              ((cr.activeFrom && cr.activeUntil)
                ? `${new Date(cr.activeFrom).toLocaleString("en-GB", { weekday: "short", hour: "2-digit", minute: "2-digit" })} → ${new Date(cr.activeUntil).toLocaleString("en-GB", { weekday: "short", hour: "2-digit", minute: "2-digit" })}`
                : "");

            const copyToClipboard = (text) => {
              try { navigator?.clipboard?.writeText?.(String(text)); } catch {}
            };

            return (
              <div className="space-y-6">
                {/* Top: two columns (personal | venue) */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Personal point of contact column */}
                  <div>
                    <div className="text-sm font-medium text-gray-800 mb-2">Personal point of contact</div>
                    {renderContactRows(personal, updatePersonal, "poc-personal")}
                    <button
                      type="button"
                      className="mt-2 px-3 py-1.5 text-sm rounded border hover:bg-gray-50"
                      onClick={addPersonal}
                    >
                      + Add another personal contact
                    </button>
                  </div>

                  {/* Venue point of contact column */}
                  <div>
                    <div className="text-sm font-medium text-gray-800 mb-2">Venue point of contact</div>
                    {renderContactRows(venue, updateVenue, "poc-venue")}
                    <button
                      type="button"
                      className="mt-2 px-3 py-1.5 text-sm rounded border hover:bg-gray-50"
                      onClick={addVenue}
                    >
                      + Add another venue contact
                    </button>
                  </div>
                </div>

                {/* Bottom: full-width emergency contact (band) */}
                <div className="rounded border p-3 bg-gray-50">
                  <div className="text-sm font-medium text-gray-800">Band emergency line (read-only)</div>
                  <p className="text-xs text-gray-600 -mt-1 mb-2">{noteText}</p>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
                    <div className="md:col-span-2">
                      <label className="text-sm text-gray-700">Emergency phone number</label>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          readOnly
                          className="border rounded px-2 py-1 text-sm text-gray-800 bg-gray-100 flex-1"
                          value={emergencyNumber || "—"}
                        />
                        {emergencyNumber && (
                          <button
                            type="button"
                            onClick={() => copyToClipboard(emergencyNumber)}
                            className="px-2 py-1 text-xs rounded border bg-white hover:bg-gray-50"
                          >
                            Copy
                          </button>
                        )}
                      </div>
                    </div>

                    <div>
                      <label className="text-sm text-gray-700">Event code</label>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          readOnly
                          className="border rounded px-2 py-1 text-sm text-gray-800 bg-gray-100 w-40"
                          value={ivrCode || "—"}
                        />
                        {ivrCode && (
                          <button
                            type="button"
                            onClick={() => copyToClipboard(ivrCode)}
                            className="px-2 py-1 text-xs rounded border bg-white hover:bg-gray-50"
                          >
                            Copy
                          </button>
                        )}
                      </div>
                    </div>
                  </div>

                  {activeSummary && (
                    <p className="text-xs text-gray-600 mt-2">
                      Active: <strong>{activeSummary}</strong>
                    </p>
                  )}

                  {!emergencyNumber && !ivrCode && (
                    <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1 mt-2">
                      No emergency number/code set on this booking yet. An admin can add it by populating
                      <code className="mx-1">booking.contactRouting</code> (proxyNumber, ivrCode, activeFrom/Until, targets).
                    </p>
                  )}
                </div>
              </div>
            );
          },
        },
      ],
    },
    {
  id: "parking",
  title: "Parking",
  help: (
    <>
      Parking is required for all band vehicles. If you need the band’s car
      registrations, tick the box below and we’ll email them to you.
    </>
  ),
  fields: [
    {
      key: "parking_available",
      label: "Is parking available on site for the band?",
      type: "select",
      options: ["Yes", "No", "Unsure"],
    },

    // Everything below is rendered conditionally based on parking_available
    {
      key: "parking_conditional",
      type: "custom",
      render: () => {
        const availability = String(answers.parking_available || "").toLowerCase();
        const isYes = availability === "yes";
        const isNo  = availability === "no";

        // Find a sensible default car count from the selected lineup
        const src =
          Array.isArray(booking?.actsSummary) ? booking.actsSummary :
          Array.isArray(booking?.items)       ? booking.items       : [];
        const firstItem = src[0] || {};
        const lineup = resolveLineup(acts, firstItem) || firstItem.lineup || null;
        

        const costPerCar = Number(answers.parking_cost_per_car ?? 0);
        const numCars = Number(
          answers.parking_num_cars ?? defaultCars
        );
        const totalCost = Number.isFinite(costPerCar) && Number.isFinite(numCars)
          ? Math.max(0, Math.round(costPerCar * numCars * 100) / 100)
          : 0;

        const paid = String(answers.parking_payment_status || "").toLowerCase() === "paid";

        // --- put near the top of render() after you compute `lineup` ---
const normalizePlate = (s = "") =>
  String(s).replace(/\s+/g, "").toUpperCase();

const regSource = Array.isArray(lineup?.bandMembers) ? lineup.bandMembers : [];
const regRows = regSource
  .map((m) => {
    const raw =
      (m?.carRegistrationValue && String(m.carRegistrationValue).trim()) ||
      (m?.carRegistration && String(m.carRegistration).trim()) ||
      "";
    const plate = normalizePlate(raw);
    if (!plate) return null;

    const name =
      [m?.firstName, m?.lastName].filter(Boolean).join(" ").trim() ||
      "Band member";

    return { name, instrument: m?.instrument || "", plate };
  })
  .filter(Boolean);


        return (
          <>
            {/* WHEN PARKING IS AVAILABLE */}
            {isYes && (
              <div className="">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 items-start md:col-span-2">
                {/* Left: What3Words parking pin */}
              <div className="flex flex-col">
  <label className="text-sm text-gray-700 mb-1">
    Please provide a{" "}
    <a
      href="https://what3words.com/"
      target="_blank"
      rel="noopener noreferrer"
      className="text-[#ff6667] underline hover:opacity-80"
    >
      What3Words
    </a>{" "}
    pin for the parking location:
  </label>
  <input
    type="text"
    className="border rounded px-2 py-1 text-sm text-gray-800"
    placeholder="e.g. ///word.word.word"
    value={answers.parking_pin || ""}
    onChange={(e) => handleAnswer("parking_pin", e.target.value)}
  />
</div>

                {/* Right: need registrations + notes */}
                <div className="flex flex-col">
                 
                  <label className="text-sm text-gray-700 mb-1">
                    Please specify any special parking instructions:
                  </label>
                  <textarea
                    className="border rounded px-2 py-1 text-sm text-gray-800 min-h-[60px]"
                    placeholder="Gates, codes, specific bays, ID required, on the grass, etc."
                    value={answers.parking_notes || ""}
                    onChange={(e) => handleAnswer("parking_notes", e.target.value)}
                  />
                </div>
               
              </div>
              <div className="gap-3 mt-3">
  <label className="text-sm text-gray-700 mb-2 flex items-center gap-2">
    <input
      type="checkbox"
      className="accent-[#ff6667]"
      checked={!!answers.need_registrations}
      onChange={(e) => handleAnswer("need_registrations", e.target.checked)}
    />
    Does your venue require the band's vehicle registration numbers?
  </label>

  {answers.need_registrations && (
    <div className="mt-2 rounded border bg-gray-50 p-3">
      <div className="text-sm font-semibold mb-2">Band vehicle registrations</div>

      {(Array.isArray(regRows) && regRows.length > 0) ? (
  <ul className="text-sm text-gray-800 space-y-1">
    {(Array.isArray(regRows) ? regRows : []).map((r, i) => (
    <li key={`${r.plate}-${i}`} className="flex justify-between gap-3">
      <span className="truncate">
        {r.name}
        {r.instrument ? ` — ${r.instrument}` : ""}
      </span>
      <span className="font-mono">
        {r.plate === "NO_CAR" ? "No vehicle" : r.plate}
      </span>
    </li>
  ))}
</ul>
      ) : (
        <div className="text-sm text-gray-600">
          We don’t have registration plates on file for this lineup yet. We’ll email them to you shortly.
        </div>
      )}
    </div>
  )}
</div>
                  </div>
            )}

            {/* WHEN PARKING IS NOT AVAILABLE */}
            {isNo && (

              
              <div className="space-y-4 md:col-span-2">
                <div className="text-sm text-gray-700">
                  Please find nearby parking for the band using{" "}
                  <a
                    href="https://www.parkopedia.com/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[#ff6667] underline hover:opacity-80"
                  >
                    Parkopedia
                  </a>
                  . Enter the event location and set the arrival time to{" "}
                  <strong>30 minutes prior to band arrival</strong> and the finish time to{" "}
                  <strong>1 hour after the band’s contracted finish</strong>. Then complete
                  the details below.
                </div>

                {/* Cost + cars + total */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-start">
                  <div className="flex flex-col">
                    <label className="text-sm text-gray-700 mb-1">
                      Cost per car (£)
                    </label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      className="border rounded px-2 py-1 text-sm text-gray-800"
                      value={answers.parking_cost_per_car ?? ""}
                      onChange={(e) => handleAnswer("parking_cost_per_car", e.target.value)}
                    />
                  </div>

         <div className="flex flex-col">
  <label className="text-sm text-gray-700 mb-1">
    Number of cars
   
  </label>
  <input
    type="number"
    min="1"
    step="1"
    className="border rounded px-2 py-1 text-sm text-gray-800"
    value={(answers.parking_num_cars ?? defaultCars) || 1}
    onChange={(e) => {
      const n = parseInt(e.target.value, 10);
      handleAnswer("parking_num_cars", Number.isFinite(n) ? n : "");
    }}
  />
</div>

                  <div className="flex flex-col">
                    <label className="text-sm text-gray-700 mb-1">
                      Total cost (£)
                    </label>
                    <input
                      type="text"
                      className="border rounded px-2 py-1 text-sm text-gray-800 bg-gray-50"
                      value={totalCost.toFixed(2)}
                      readOnly
                    />
                  </div>
                </div>

                {/* Screenshot upload (simple) */}
                <div className="flex flex-col">
                  <label className="text-sm text-gray-700 mb-1">
                    Upload a screenshot of the parking options as displayed on Parkopedia (or similar):
                  </label>
                  <input
                    type="file"
                    accept="image/*"
                    className="text-sm"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      // Store lightweight, serializable metadata + a temporary preview URL
                      const url = URL.createObjectURL(file);
                      handleAnswer("parking_screenshot_name", file.name);
                      handleAnswer("parking_screenshot_url", url);
                      handleAnswer("parking_checkout_status", "Paid");
                    }}
                  />
                  {answers.parking_screenshot_url && (
                    <img
  src={answers.parking_screenshot_url}
  alt={answers.parking_screenshot_name || "Parking screenshot"}
  className="mt-2 max-h-40 rounded border object-contain"
  style={{ maxWidth: "100%", height: "auto" }}
/>
                  )}
                </div>

{/* Parking payment (Stripe Checkout) */}
<div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-start">
  <div className="md:col-span-2 flex flex-col">
    <label className="text-sm text-gray-700 mb-1">Parking payment</label>

    {/* compute the amount based on your existing values */}
    {(() => {
      const costPerCar = Number(answers.parking_cost_per_car ?? 0);
      // defaultCars should be computed earlier in your render (you already do this)
      const numCars = Number(answers.parking_num_cars ?? defaultCars);
      const total = Math.max(0, Math.round(costPerCar * numCars * 100) / 100);
      const totalPence = Math.round(total * 100);

      return (
        <div className="flex flex-wrap items-center gap-3">
         <button
  type="button"
  onClick={() => handleGenerateParkingInvoice({ amountPence: totalPence })}
  className="px-3 py-1.5 rounded bg-[#ff6667] text-white hover:opacity-90"
  disabled={!totalPence}
  title={!totalPence ? "Enter cost per car and number of cars first" : "Open Stripe Checkout"}
>
  Generate invoice
</button>

          <div className="text-sm text-gray-700">
            Amount:&nbsp;<strong>£{total.toFixed(2)}</strong>
            &nbsp;for {numCars} car{numCars === 1 ? "" : "s"}
          </div>
        </div>
      );
    })()}
  </div>

  {/* Status display (optional) */}
  <div className="flex flex-col">
    <label className="text-sm text-gray-700 mb-1">Status</label>
<div className="text-sm flex items-center gap-1">
  {(() => {
    const raw = answers?.parking_checkout_status;
    const label = typeof raw === "string" ? raw.trim() : "";
    const isPaid = /paid/i.test(label);
    if (isPaid) {
      return (
        <>
          Paid
          <img src={assets.tick} alt="paid" className="inline w-4 h-4 ml-0.5" />
        </>
      );
    }
    return label || "Not paid";
  })()}
</div>
  </div>
</div>
              </div>
            )}
          </>
        );
      },
    },
  ],
},
      {
        id: "room_area",
        title: "Room & Area",
        fields: [
          { key: "performance_room", label: "Room name", type: "text" },
           { key: "room_size", label: "Approx. room size", type: "text" },
           { key: "guest_count", label: "Expected number of guests", type: "number" },
           { key: "outdoor_performance", label: "Is the act performing outdoors?", type: "select", options: ["No", "Yes"] },
           {
             key: "outdoor_ack",
             type: "custom",
             render: () => {
               if (answers.outdoor_performance === "Yes") {
                 return (
                   <label className="text-sm text-gray-700 flex items-start gap-2">
                     <input
                       type="checkbox"
                       className="mt-1 accent-[#ff6667]"
                       checked={!!answers.outdoor_ack}
                       onChange={(e) => handleAnswer("outdoor_ack", e.target.checked)}
                     />
                     <span>
                       I understand that overhead cover must be supplied for musicians and their equipment, and a dry, flat, and level surface must be provided for the musicians to perform from.
                     </span>
                   </label>
                 );
               }
               return null;
             },
           },
          { key: "performance_area", label: "Where should the band set up in the space described above?", type: "textarea", placeholder: "E.g. corner of room, stage, in front of fireplace etc" },
         
          
          
        ],
      },
      {
        id: "pa_lights",
        title: "PA & Lighting",
        help: [
          equipmentHelp,
          "However some venues require the band to use their own system. Please let us know what to expect on the day."
        ].filter(Boolean).join(" "),
        fields: [
          {
            key: "pa_lights_columns",
            type: "custom",
            render: () => (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* PA column */}
                <div className="flex flex-col gap-3">
                  <div className="flex flex-col">
                    <label className="text-sm text-gray-700 mb-1">
                      Is there an in-house PA system that the band is required to use?
                    </label>
                    <select
                      className="border rounded px-2 py-1 text-sm text-gray-800"
                      value={answers.use_inhouse_pa || ""}
                      onChange={(e) => handleAnswer("use_inhouse_pa", e.target.value)}
                    >
                      <option value="">Select…</option>
                      <option value="No">No</option>
                      <option value="Yes">Yes</option>
                    </select>
                  </div>

                  {answers.use_inhouse_pa === "Yes" && (
                    <div className="flex flex-col">
                      <label className="text-sm text-gray-700 mb-1">
                        Is there an in-house sound engineer present?
                      </label>
                      <select
                        className="border rounded px-2 py-1 text-sm text-gray-800"
                        value={answers.pa_engineer_present || ""}
                        onChange={(e) => handleAnswer("pa_engineer_present", e.target.value)}
                      >
                        <option value="">Select…</option>
                        <option value="No">No</option>
                        <option value="Yes">Yes</option>
                      </select>
                    </div>
                  )}

                  {answers.use_inhouse_pa === "Yes" && answers.pa_engineer_present === "No" && (
                    <div className="flex flex-col">
                      <label className="text-sm text-gray-700 mb-1">
                        Please provide the make, model and specs of the PA system
                      </label>
                      <textarea
                        className="border rounded px-2 py-1 text-sm text-gray-800 min-h-[88px]"
                        value={answers.pa_inhouse_specs || ""}
                        onChange={(e) => handleAnswer("pa_inhouse_specs", e.target.value)}
                      />
                    </div>
                  )}
                </div>

                {/* Lighting column */}
                <div className="flex flex-col gap-3">
                  <div className="flex flex-col">
                    <label className="text-sm text-gray-700 mb-1">
                      Is there an in-house lighting system that the band is required to use?
                    </label>
                    <select
                      className="border rounded px-2 py-1 text-sm text-gray-800"
                      value={answers.use_inhouse_lights || ""}
                      onChange={(e) => handleAnswer("use_inhouse_lights", e.target.value)}
                    >
                      <option value="">Select…</option>
                      <option value="No">No</option>
                      <option value="Yes">Yes</option>
                    </select>
                  </div>

                  {answers.use_inhouse_lights === "Yes" && (
                    <div className="flex flex-col">
                      <label className="text-sm text-gray-700 mb-1">
                        Is there an in-house lighting engineer present?
                      </label>
                      <select
                        className="border rounded px-2 py-1 text-sm text-gray-800"
                        value={answers.lights_engineer_present || ""}
                        onChange={(e) => handleAnswer("lights_engineer_present", e.target.value)}
                      >
                        <option value="">Select…</option>
                        <option value="No">No</option>
                        <option value="Yes">Yes</option>
                      </select>
                    </div>
                  )}

                  {answers.use_inhouse_lights === "Yes" && answers.lights_engineer_present === "No" && (
                    <div className="flex flex-col">
                      <label className="text-sm text-gray-700 mb-1">
                        Please provide the make, model and specs of the lighting system
                      </label>
                      <textarea
                        className="border rounded px-2 py-1 text-sm text-gray-800 min-h-[88px]"
                        value={answers.lights_inhouse_specs || ""}
                        onChange={(e) => handleAnswer("lights_inhouse_specs", e.target.value)}
                      />
                    </div>
                  )}
                </div>
              </div>
            ),
          },
        ],
      },
{
  id: "sound_limits",
  title: "Sound Limitations",
  help: <>If there is a limiter, please confirm the dB cap with the venue and share any paperwork.</>,
  fields: [
    {
      key: "sound_limits_present",
      label: "Are there any sound limitations at the venue?",
      type: "select",
      options: ["Yes", "No"],
    },
    {
      key: "sound_limits_conditional",
      type: "custom",
      render: () => {
        const hasLimits =
          String(answers.sound_limits_present || "").toLowerCase() === "yes";
        if (!hasLimits) return null;

        const isTrafficLight =
          String(answers.sound_limits_is_traffic_light || "").toLowerCase() === "yes";

        return (
          <div className="space-y-4">
            {/* Traffic light limiter? */}
            <div className="flex flex-col">
              <label className="text-sm text-gray-700 mb-1">
                Is it a traffic light limiter?
              </label>
              <select
                className="border rounded px-2 py-1 text-sm text-gray-800 w-full md:w-64"
                value={answers.sound_limits_is_traffic_light || ""}
                onChange={(e) =>
                  handleAnswer("sound_limits_is_traffic_light", e.target.value)
                }
              >
                <option value="">Select…</option>
                <option value="Yes">Yes</option>
                <option value="No">No</option>
              </select>

            </div>

            {/* dB limit */}
            <div className="flex flex-col">
              <label className="text-sm text-gray-700 mb-1">What is the dB limit?</label>
              <input
                type="text"
                placeholder="e.g. 92 dB"
                className="border rounded px-2 py-1 text-sm text-gray-800 w-full md:w-64"
                value={answers.sound_limits_db_cap || ""}
                onChange={(e) => handleAnswer("sound_limits_db_cap", e.target.value)}
              />
            </div>

            {/* Further information */}
            <div className="flex flex-col">
              <label className="text-sm text-gray-700 mb-1">
                Any further information on the sound limitation
              </label>
              <textarea
                className="border rounded px-2 py-1 text-sm text-gray-800 min-h-[88px] w-full"
                placeholder="Placement of meter, who monitors it, automatic cut-off behavior, previous band feedback, etc."
                value={answers.sound_limits_notes || ""}
                onChange={(e) => handleAnswer("sound_limits_notes", e.target.value)}
              />
            </div>

            {/* Venue documentation upload */}
            <div className="flex flex-col">
              <label className="text-sm text-gray-700 mb-1">
                Please attach any venue documentation on the sound limitations
              </label>
              
              <input
                type="file"
                className="text-sm"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  const url = URL.createObjectURL(file);
                  handleAnswer("sound_limits_doc_name", file.name);
                  handleAnswer("sound_limits_doc_url", url);
                  handleAnswer("sound_limits_doc_size", file.size);
                  handleAnswer("sound_limits_doc_type", file.type);
                }}
              />
              {/* Checkbox for doc signing */}
   <div className="mt-2 flex items-center gap-2">
  <input
    type="checkbox"
    className="accent-[#ff6667]"
    checked={!!answers.sound_limits_doc_needs_signing}
    onChange={async (e) => {
      const checked = e.target.checked;
      handleAnswer("sound_limits_doc_needs_signing", checked);
      if (checked && booking) {
        const body = {
          _id: booking._id || null,
          bookingId: booking.bookingId || null,
          to: "hellp@thesupremecollective.co.uk",
          subject: "Doc signing requested for sound limiter",
          docName: answers.sound_limits_doc_name,
          docUrl: answers.sound_limits_doc_url,
        };
        try {
          await axios.post(`${backendUrl}/api/notifications/doc-signing-request`, body);
          alert("We’ve notified the team to send this for signing.");
        } catch (err1) {
          if (err1?.response?.status === 404) {
            try {
              await axios.post(`${backendUrl}/api/booking/notify-doc-signing`, body);
              alert("We’ve notified the team to send this for signing.");
            } catch (err2) {
              console.warn("Doc notify failed (both endpoints)", err2);
              alert("Couldn’t auto-notify just now. We’ve flagged this in your sheet.");
              handleAnswer("sound_limits_doc_needs_signing_request_at", new Date().toISOString());
            }
          } else {
            console.warn("Doc notify failed", err1);
            alert("Couldn’t auto-notify just now. We’ve flagged this in your sheet.");
            handleAnswer("sound_limits_doc_needs_signing_request_at", new Date().toISOString());
          }
        }
      }
    }}
  />
  <label className="text-sm text-gray-700">
    If this document needs to be signed by the band please check this box
  </label>
</div>
<p className="text-xs text-gray-600 mt-1">
  This will notify hello@thesupremecollective.co.uk with your booking reference so we can arrange signatures.
</p>
              {answers.sound_limits_doc_url && (
                <div className="mt-2 text-sm text-gray-700 flex items-center gap-2">
                  <a
                    href={answers.sound_limits_doc_url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[#ff6667] underline hover:opacity-80"
                  >
                    {answers.sound_limits_doc_name || "View document"}
                  </a>
                  <span className="text-xs text-gray-500">
                    {answers.sound_limits_doc_type || ""}
                  </span>
                </div>
              )}
            </div>
          </div>
        );
      },
    },
  ],
},
     {
  id: "venue_close",
  title: "Venue Close & Access",
  help: (
    <>
      The band needs <strong>{packdownTime}</strong> minutes to pack down everything and
      leave the site from the moment the music is turned off. Is there a hard venue close
      time <em>for the band</em> to pack down and offload by? For example, are there any
      gates that shut at 12:30am, or does the venue require the band to be off-site by
      midnight?
    </>
  ),
  fields: [
    {
      key: "hard_close_time",
      label: "Hard venue close time (band off-site by)",
      type: "text",
      placeholder: "e.g. 00:30",
    },
    {
      key: "access_constraints",
      label: "Any gates or access constraints?",
      type: "textarea",
      placeholder:
        "E.g. gates locked at 00:30, security sign-out, loading bay closes at 23:00, etc.",
    },
  ],
},


      {
        id: "changing_room",
        title: "Changing Room",
        fields: [
          { key: "changing_room", label: "Is there a secure changing room?", type: "select", options: ["Yes", "No"] },
        {
  key: "changing_room_details",
  label: "Where is the changing room? (name, directions, where to get key)",
  type: "textarea",
  placeholder: "e.g., Green Room behind the bar; key at reception",
}
        ],
      },
{
  id: "food_refreshments",
  title: "Food & Refreshments",
  help: "As part of the booking, the band should be provided with a hot meal and refreshments while on site. Please outline the meal arrangements and note any dietary requirements of the band below.",
  fields: [
    {
      key: "dietary_table",
      type: "custom",
      render: () => {
        const rows = extractDietaryRequirements(acts, booking);
        const hasMenuAny =
          !!answers.dietary_menu_url ||
          !!answers.dietary_menu_text ||
          !!answers.dietary_menu_file; // this will be a URL after upload

        return (
          <div className="space-y-6">
            {/* Table of requirements */}
            {rows.length ? (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left border-b">
                    <th className="py-1 pr-2">Name</th>
                    <th className="py-1 pr-2">Instrument</th>
                    <th className="py-1">Dietary requirement</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={i} className="border-b last:border-0">
                      <td className="py-1 pr-2">{r.name}</td>
                      <td className="py-1 pr-2 text-gray-600">{r.instrument}</td>
                      <td className="py-1">{r.diet || DIET_FALLBACK}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="text-sm text-gray-600">
                We’ll populate this once the lineup is confirmed.
              </div>
            )}

            {/* Caterer email */}
            <div>
              <label className="text-sm text-gray-700 mb-1 block">
                Caterer’s email (to receive dietary requirements & service notes)
              </label>
              <input
                type="email"
                className="border rounded px-2 py-1 text-sm text-gray-800 w-full md:w-96"
                placeholder="catering@venue.co.uk"
                value={answers.caterer_email || ""}
                onChange={(e) => handleAnswer("caterer_email", e.target.value)}
              />
              <p className="text-xs text-gray-500 mt-1">
                We’ll include a note that the band may need to be fast-tracked during a short performance break and, if food is initially served while performing, to keep plates aside.
              </p>
            </div>

            {/* Free-text notes */}
            <div>
              <label className="text-sm text-gray-700 mb-1 block">
                Please confirm arrangements
              </label>
              <textarea
                className="border rounded px-2 py-1 text-sm text-gray-800 w-full min-h-[70px]"
                value={answers.dietary_notes || ""}
                onChange={(e) => handleAnswer("dietary_notes", e.target.value)}
                placeholder="E.g., meals served in staff canteen at 20:15; water/soft drinks available at the bar."
              />
            </div>

            {/* Hosted menu link */}
            <div>
              <label className="text-sm text-gray-700 mb-1 block">
                Menu link (optional)
              </label>
              <input
                type="url"
                className="border rounded px-2 py-1 text-sm text-gray-800 w-full"
                placeholder="https://… (Google Drive, Dropbox, venue PDF)"
                value={answers.dietary_menu_url || ""}
                onChange={(e) => handleAnswer("dietary_menu_url", e.target.value)}
              />
            </div>

            {/* Paste menu text */}
            <div>
              <label className="text-sm text-gray-700 mb-1 block">
                Paste the menu (optional)
              </label>
              <textarea
                className="border rounded px-2 py-1 text-sm text-gray-800 w-full min-h-[100px]"
                value={answers.dietary_menu_text || ""}
                onChange={(e) => handleAnswer("dietary_menu_text", e.target.value)}
                placeholder="Starter: …\nMain: …\nDessert: …"
              />
            </div>

            {/* Upload menu PDF/DOC/Image → store returned URL */}
            <div>
              <label className="text-sm text-gray-700 mb-1 block">
                Upload a menu (PDF, DOCX, or image)
              </label>
              <input
                type="file"
                accept=".pdf,.doc,.docx,.jpg,.jpeg,.png"
                className="block text-sm"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  try {
                    const fd = new FormData();
                    fd.append("file", file);
                    const res = await axios.post("/api/upload/menu", fd, {
                      headers: { "Content-Type": "multipart/form-data" },
                    });
                    const url = res?.data?.url;
                    if (url) {
                      handleAnswer("dietary_menu_file", url); // store URL, not File object
                    } else {
                      alert("Upload failed — no URL returned.");
                    }
                  } catch (err) {
                    console.error("Menu upload failed", err);
                    alert("Menu upload failed — please try again.");
                  }
                }}
              />
              {answers.dietary_menu_file && (
                <p className="mt-1 text-xs text-gray-600">
                  Uploaded:&nbsp;
                  <a
                    className="underline text-[#ff6667]"
                    href={answers.dietary_menu_file}
                    target="_blank"
                    rel="noreferrer"
                  >
                    View file
                  </a>
                </p>
              )}
            </div>

            {/* Notify Band & Caterer */}
            <div className="pt-2">
              <button
                type="button"
                className={`px-3 py-1.5 text-sm rounded ${
                  hasMenuAny && !notifying
                    ? "bg-emerald-600 text-white hover:bg-emerald-700"
                    : "bg-gray-300 text-gray-600 cursor-not-allowed"
                }`}
                disabled={notifying || !hasMenuAny}
                title={
                  hasMenuAny
                    ? "Send menu and dietary requirements to band (and caterer if provided)"
                    : "Add a menu link, paste text, or upload a file first"
                }
                onClick={async () => {
                  try {
                    setNotifying(true);
                    const dietaryRows = extractDietaryRequirements(acts, booking);

                    // Build a message note we’ll include to caterer as well
                    const fastTrackHint =
                      String(answers.meal_fasttrack_ok || "").toLowerCase() === "yes"
                        ? "The band may need to be fast-tracked during a short performance break."
                        : "The band may need to be fast-tracked during a short performance break.";
                    const plateAsideHint =
                      "If food is initially served while the band is performing, please keep plates aside for them.";

                    const payload = {
                      bookingId: booking?.bookingId || booking?._id,
                      kind: "menu_notification",
                      catererEmail: (answers.caterer_email || "").trim(),
                      menu: {
                        url: answers.dietary_menu_url || "",
                        text: answers.dietary_menu_text || "",
                        fileUrl: answers.dietary_menu_file || "",
                        notes: answers.dietary_notes || "",
                        dietarySummary: dietaryRows,
                        serviceNotes: `${fastTrackHint} ${plateAsideHint}`,
                      },
                    };

                    await notifyBand(payload);
                    alert("Menu sent to the band and caterer (if provided) ✅");
                  } catch (e) {
                    console.error("Notify band/caterer (menu) failed:", e);
                    alert("Sorry—couldn’t send the menu just now.");
                  } finally {
                    setNotifying(false);
                  }
                }}
              >
                {notifying ? "Notifying…" : "Notify Band & Caterer"}
              </button>
              <p className="text-xs text-gray-600 mt-1">
                We’ll send the menu (link/text/file), dietary requirements, and service notes to the band, and to your caterer if an email is provided.
              </p>
            </div>
          </div>
        );
      },
    },
  ],
},

{
  id: "schedule",
  title: "Schedule",
  help:
    "Arrival & finish are taken from your booking. Choose a set configuration and what you’d like between sets. Drag to reorder (with rules).",
  fields: [
    {
      key: "schedule_custom",
      type: "custom",
      render: () => {
        // ---- derive static bits ----
        const perf = getPerformanceTimesFromBooking(booking);
        const options = getSetOptionsFromAct(acts, booking);
        const djBooked = hasDJBooked(booking);

        // Setup/soundcheck from lineup
        const src = Array.isArray(booking?.actsSummary)
          ? booking.actsSummary
          : Array.isArray(booking?.items)
          ? booking.items
          : [];
        const first = src[0] || {};
        const lineupObj = resolveLineup(acts, first) || first.lineup || null;
        const setupMins = Number(lineupObj?.setupTime || 60);
        const soundcheckMins = Number(lineupObj?.soundcheckTime || 30);
        const changeMins = 15; // fixed

        // ---- chosen set option ----
        const setKey = answers.schedule_set_option || options[0]?.key;
        const chosen = options.find((o) => o.key === setKey) || options[0];
        const setCount = Math.max(1, Number(chosen?.sets || 2));
        const setLength = Number(chosen?.length || 45);

        // ---- select choices ----
        const intermissionChoices = [
          { value: "spotify", label: "Spotify playlist (complimentary)" },
          { value: "manned", label: "Manned playlist" },
          ...(djBooked ? [{ value: "dj", label: "DJ" }] : []),
        ];
        const postLiveChoices = [{ value: "", label: "None" }, ...intermissionChoices];

        // ---- build canonical keys in the default order ----
        const canonical = ["arrival", "setup", "soundcheck", "change"];
        for (let i = 1; i <= setCount; i++) {
          canonical.push(`set_${i}`);
          if (i < setCount) canonical.push(`between_${i}`); // Intermission i
        }
        canonical.push("finish");
        canonical.push("after_final"); // Post Live Music

        // ---- order state ----
        const currentOrder = Array.isArray(answers.schedule_order)
          ? answers.schedule_order
          : [];

        const enforceRules = (orderIn) => {
          let order = orderIn.filter((k) => canonical.includes(k));
          for (const k of canonical) if (!order.includes(k)) order.push(k);

          // 1) arrival fixed first
          order = ["arrival", ...order.filter((k) => k !== "arrival")];

          // 2) finish fixed last
          order = order.filter((k) => k !== "finish");
          order.push("finish");

          // 3) trio must be before the first performance block
          const firstPerfIdx = order.findIndex(
            (k) => k.startsWith("set_") || k.startsWith("between_") || k === "after_final"
          );
          const insertAt = firstPerfIdx === -1 ? order.length : firstPerfIdx;
          const trio = ["setup", "soundcheck", "change"];
          order = order.filter((k) => !trio.includes(k));
          order.splice(insertAt, 0, ...trio);

          // 4) put Post Live Music last (after Finish)
          order = order.filter((k) => k !== "after_final");
          order.push("after_final");

          // ensure uniqueness (defensive)
          return Array.from(new Set(order));
        };

        const normalizedOrder = enforceRules(currentOrder.length ? currentOrder : canonical);
        if (JSON.stringify(currentOrder) !== JSON.stringify(normalizedOrder)) {
          handleAnswer("schedule_order", normalizedOrder);
        }

        // ---- drag & drop (Arrival/Finish not draggable; others are) ----
        let dragIndex = null;
        const isFixed = (k) => k === "arrival" || k === "finish";

        const onDragStart = (idx, key) => (e) => {
          if (isFixed(key)) return;
          dragIndex = idx;
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/plain", String(idx));
        };
        const onDragOver = (idx) => (e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
        };
        const onDrop = (idx) => (e) => {
          e.preventDefault();
          const from = dragIndex ?? Number(e.dataTransfer.getData("text/plain"));
          const to = idx;
          if (Number.isFinite(from) && Number.isFinite(to) && from !== to) {
            const next = [...normalizedOrder];
            const [moved] = next.splice(from, 1);
            next.splice(to, 0, moved);
            const enforced = enforceRules(next);
            handleAnswer("schedule_order", enforced);
          }
          dragIndex = null;
        };

        // ---- per-row fields: time dropdown + notes ----
        const timeKey = (k) => `schedule_time_${k}`;
        const notesKey = (k) => `schedule_notes_${k}`;

        const timeOptions = (() => {
          // 15-minute grid 10:00–02:00
          const out = [""];
          const pad = (n) => String(n).padStart(2, "0");
          const push = (h, m) => out.push(`${pad(h)}:${pad(m)}`);
          for (let h = 10; h <= 23; h++) for (let m = 0; m < 60; m += 15) push(h, m);
          for (let h = 0; h <= 2; h++) for (let m = 0; m < 60; m += 15) push(h, m);
          return out;
        })();

        const Row = ({ title, k, readOnlyValue }) => (
          <div
            className={`border rounded px-3 py-2 bg-white shadow-sm grid grid-cols-1 md:grid-cols-12 gap-2 items-center ${
              isFixed(k) ? "opacity-95" : ""
            }`}
            draggable={!isFixed(k)}
            onDragStart={onDragStart(normalizedOrder.indexOf(k), k)}
            onDragOver={onDragOver(normalizedOrder.indexOf(k))}
            onDrop={onDrop(normalizedOrder.indexOf(k))}
          >
            {/* drag handle + label */}
            <div className="md:col-span-5 flex items-center gap-2">
              <div
                className={`select-none text-gray-400 ${
                  isFixed(k) ? "cursor-not-allowed" : "cursor-grab"
                }`}
              >
                ⋮⋮
              </div>
              <div className="text-sm font-medium text-gray-800">{title}</div>
            </div>

            {/* time select */}
            <div className="md:col-span-3">
              <select
                className="border rounded px-2 py-1 text-sm w-full"
                value={answers[timeKey(k)] || ""}
                onChange={(e) => handleAnswer(timeKey(k), e.target.value)}
              >
                {timeOptions.map((t) => (
                  <option key={t || "blank"} value={t}>
                    {t || "Time…"}
                  </option>
                ))}
              </select>
            </div>

            {/* notes / links */}
            <div className="md:col-span-4">
              <input
                type="text"
                className="border rounded px-2 py-1 text-sm w-full"
                placeholder="Notes, requests, Spotify/DJ links…"
                value={answers[notesKey(k)] || ""}
                onChange={(e) => handleAnswer(notesKey(k), e.target.value)}
              />
            </div>

            {/* read-only duration bubble, when provided */}
            {readOnlyValue && (
              <div className="md:col-span-12 text-xs text-gray-500 pl-6">
                {readOnlyValue}
              </div>
            )}
          </div>
        );

        const labelFor = (k) => {
          if (k === "arrival") return "Arrival (from booking)";
          if (k === "setup") return "Setup";
          if (k === "soundcheck") return "Soundcheck";
          if (k === "change") return "Change time";
          if (k === "finish") return "Finish (from booking)";
          if (k === "after_final") return "Post Live Music";
          if (k.startsWith("set_")) return `Live set ${k.split("_")[1]} (${setLength} mins)`;
          if (k.startsWith("between_")) return `Intermission ${k.split("_")[1]}`;
          return k;
        };

        return (
          <div className="space-y-4">
            {/* Live set configuration (TOP) */}
            <div>
              <label className="text-sm text-gray-700 mb-1 block">
                Live set configuration
              </label>
              <select
                className="border rounded px-2 py-1 text-sm"
                value={setKey}
                onChange={(e) => handleAnswer("schedule_set_option", e.target.value)}
              >
                {options.map((o) => (
                  <option key={o.key} value={o.key}>
                    {o.sets} × {o.length}-minute sets (min {o.minInterval}-minute interval)
                  </option>
                ))}
              </select>
            </div>

            {/* Rules note */}
            <p className="text-xs text-gray-600">
              Arrival is fixed first; Finish fixed last. Setup, Soundcheck & Change will
              always stay before the first live performance.
            </p>

            {/* Ordered, draggable list */}
            <div className="flex flex-col gap-2">
              {normalizedOrder.map((k) => {
                if (k === "arrival")
                  return <Row key={k} title={labelFor(k)} k={k} />;
                if (k === "setup")
                  return (
                    <Row key={k} title={labelFor(k)} k={k} readOnlyValue={`${setupMins} minutes`} />
                  );
                if (k === "soundcheck")
                  return (
                    <Row
                      key={k}
                      title={labelFor(k)}
                      k={k}
                      readOnlyValue={`${soundcheckMins} minutes`}
                    />
                  );
                if (k === "change")
                  return (
                    <Row key={k} title={labelFor(k)} k={k} readOnlyValue={`${changeMins} minutes`} />
                  );
                if (k.startsWith("set_"))
                  return <Row key={k} title={labelFor(k)} k={k} />;
                if (k.startsWith("between_"))
                  return <Row key={k} title={labelFor(k)} k={k} />;
                if (k === "finish")
                  return <Row key={k} title={labelFor(k)} k={k} />;
                if (k === "after_final")
                  return (
                    <div key={k} className="mt-2">
                      <div className="text-sm font-medium text-gray-800 mb-1">
                        {labelFor(k)}
                      </div>
                      <select
                        className="border rounded px-2 py-1 text-sm w-full md:w-72"
                        value={answers.schedule_after_final || ""}
                        onChange={(e) =>
                          handleAnswer("schedule_after_final", e.target.value)
                        }
                      >
                        {postLiveChoices.map((c) => (
                          <option key={c.value || "none"} value={c.value}>
                            {c.label || "None"}
                          </option>
                        ))}
                      </select>
                    </div>
                  );
                return null;
              })}
            </div>
          </div>
        );
      },
    },
  ],
},
      {
        id: "spotify",
        title: "Spotify Playlists",
        help: "Paste playlist links for background music while DJ eats. Please finalize 1 week before the performance.",
        fields: [{ key: "spotify_links", label: "Playlist links", type: "textarea", placeholder: "One per line" }],
      },
      {
        id: "dj_requests",
        title: "Advanced DJ Requests",
        help: "Optionally paste a Spotify playlist of requests (DJ needs ~2× duration in material). Or list DOs/DON’Ts/genres.",
        fields: [{ key: "dj_requests", label: "Playlist link or notes", type: "textarea" }],
      },
      {
        id: "first_dance",
        title: "First Dance & Song List",
        fields: [
          { key: "first_dance_song", label: "First dance song", type: "text" },
          { key: "first_dance_performed_by", label: "Band or MP3?", type: "select", options: ["Band", "MP3", "Unsure"] },
          { key: "song_suggestions", label: "Song suggestions (up to ~32, from the band’s repertoire)", type: "textarea", placeholder: "One per line" },
        ],
      },
      { id: "socials", title: "Socials (optional)", fields: [{ key: "social_handles", label: "Handles / hashtags", type: "textarea" }] },
      { id: "suppliers", title: "Other Suppliers (optional)", fields: [{ key: "supplier_list", label: "Names / Instagram handles", type: "textarea" }] },
      { id: "notes", title: "Notes", fields: [{ key: "free_notes", label: "Anything else useful for the band to know", type: "textarea" }] },
    ];
}, [answers, booking, acts]);

  const totalSections = sections.length;
  const completedCount = useMemo(
    () => Object.values(complete).filter(Boolean).length,
    [complete]
  );


  const toggleComplete = (sectionId, val) => {
    setComplete((prev) => ({ ...prev, [sectionId]: val }));
  };

const persist = async (markSubmitted = false) => {
  if (!booking) return;

  const bookingRef = booking.bookingId || booking.reference || null; // human-readable
  const mongoId = booking._id || null; // 24-char ObjectId

  // Sanitize current state (assumes sanitizeForSave is in scope)
  const safeAnswers = sanitizeForSave(answers);
  const safeComplete = sanitizeForSave(complete);

  const eventSheet = {
    answers: safeAnswers,
    complete: safeComplete,
    submitted: markSubmitted ? true : !!booking?.eventSheet?.submitted,
    updatedAt: new Date().toISOString(),
  };

  // Server expects _id as ObjectId; include both ids
  const payload = { _id: mongoId, bookingId: bookingRef, eventSheet };

  // Local fallback save
  try {
    localStorage.setItem(lsKey(payload.bookingId || "unknown"), JSON.stringify(payload.eventSheet));
  } catch (e) {
    console.warn("Local save failed:", e?.message);
  }

if (!payload._id && !payload.bookingId) {
  console.warn("Skipping autosave: missing both Mongo _id and bookingId", { bookingRef });
  return;
}

  try {
    setSaving(true);
    await axios.post(`${backendUrl}/api/booking/update-event-sheet`, payload);
  } catch (e) {
    console.warn("Event sheet saved locally (backend route not available yet).", e?.message);
  } finally {
    setSaving(false);
  }
};



  if (loading) return <div className="p-4">Loading event sheet...</div>;
  if (!booking)
    return (
      <div className="p-4 text-red-600">
        Booking not found.
        <div className="text-gray-600 text-sm mt-1">
          Tip: Make sure you’re logged in, or open from your confirmation link.
        </div>
      </div>
    );

  const eventDate = booking.date ? new Date(booking.date) : null;
  const cur = currencySymbol(booking?.totals?.currency || booking?.cartMeta?.currency || "GBP");

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold mb-1">🎤 Event Sheet</h1>
          <p className="text-gray-700">
            <strong>Booking:</strong> {booking.bookingId || booking._id}
          </p>
       <p className="text-gray-700">
            <strong>Act(s):</strong> {actNames || "—"}
          </p>


           <p className="text-gray-700">
            <strong>Lineup:</strong> {headerLineup || "—"}
          </p>
          <p className="text-gray-700">
            <strong>Venue:</strong> {venueString}
          </p>
          <p className="text-gray-700">
            <strong>Date:</strong>{" "}
            {eventDate ? eventDate.toLocaleDateString("en-GB") : "—"}
          </p>
          <p className="text-gray-700">
            <strong>Event Type:</strong> {booking.eventType || "—"}
          </p>
        </div>

        <div className="min-w-[220px]">
          <div className="rounded border p-3 bg-white shadow-sm">
            <div className="text-sm text-gray-600 mb-1">
              Progress: {completedCount}/{totalSections} sections
            </div>
            <div className="w-full h-2 bg-gray-200 rounded">
              <div
                className="h-2 bg-[#ff6667] rounded"
                style={{
                  width: `${Math.round((completedCount / totalSections) * 100)}%`,
                  transition: "width 200ms ease",
                }}
              />
            </div>
            <div className="flex gap-2 mt-3">
              <button
                onClick={() => persist(false)}
                disabled={saving}
                className="px-3 py-1.5 text-sm rounded bg-black text-white hover:bg-[#ff6667]"
              >
                {saving ? "Saving…" : "Save Draft"}
              </button>
              <button
                onClick={notifyBand}
                disabled={notifying || completedCount !== totalSections}
                className={`px-3 py-1.5 text-sm rounded ${
                  completedCount === totalSections
                    ? "bg-emerald-600 text-white hover:bg-emerald-700"
                    : "bg-gray-300 text-gray-600 cursor-not-allowed"
                }`}
                title={
                  completedCount === totalSections
                    ? "Notify the band"
                    : "Mark all sections complete to notify the band"
                }
              >
                {notifying ? "Notifying…" : "Notify Band"}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Booking Details */}
      <div className="mt-6 bg-white rounded border p-4 shadow-sm">
        <h2 className="text-lg font-semibold mb-3">Booking Details</h2>

        {detailedItems.length === 0 ? (
          <div className="text-gray-600">—</div>
        ) : (
          <div className="space-y-4">
            {detailedItems.map((it, i) => (
              <div key={i} className="flex gap-3 items-start">
                {it.imageUrl ? (
                  <Link to={`/act/${it.actId}`} className="shrink-0">
                    <img
                      src={it.imageUrl}
                      alt={it.actName}
                      className="w-20 h-20 object-cover rounded"
                      onError={(e) => (e.currentTarget.style.display = "none")}
                    />
                  </Link>
                ) : null}

                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-2 flex-wrap">
                    <Link to={`/act/${it.actId}`} className="font-semibold text-gray-900 hover:underline">
                      {it.actName}
                    </Link>
                 {(it.richerLineupLabel || it.lineupLabel) && (
  <span className="text-sm text-gray-600">
    — {generateDescription(it)}
  </span>
)}
                  </div>

                  {/* Extras list */}
                  {Array.isArray(it.extras) && it.extras.length > 0 && (
                    <div className="mt-1">
                      <div className="text-xs text-gray-600">Extras:</div>
                      <ul className="text-sm text-gray-700 list-disc ml-5">
                        {it.extras.map((ex, idx) => (
                          <li key={idx} className="flex justify-between gap-3">
                            <span className="truncate">
                              {ex.name || ex.key}
                              {ex.quantity && Number(ex.quantity) > 1 ? ` × ${ex.quantity}` : ""}
                            </span>
                           
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                
                </div>
              </div>
            ))}

            <hr className="my-2" />
            {/* Booking-level totals */}
            <div className="text-sm">
              <div className="flex justify-between">
                <span>Booking total</span>
                <span>
                  {cur}
                  {Number(fullAmount || 0).toFixed(2)}
                </span>
              </div>
              <div className="flex justify-between">
                <span>Deposit paid</span>
                <span>
                  {cur}
                  {Number(depositAmount || 0).toFixed(2)}
                </span>
              </div>
              <div className="flex justify-between font-semibold">
                <span>Outstanding balance</span>
                <span>
                  {cur}
                  {Number(remainingAmount || 0).toFixed(2)}
                </span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Sections */}
      <div className="mt-6 space-y-6">
        {sections.map((sec) => (
          <div key={sec.id} className="bg-white rounded border p-4 shadow-sm">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-lg font-semibold">{sec.title}</h3>
                {sec.help && <p className="text-sm text-gray-600 mt-1">{sec.help}</p>}
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="accent-[#ff6667]"
                  checked={!!complete[sec.id]}
                  onChange={(e) => toggleComplete(sec.id, e.target.checked)}
                />
                <span className="text-gray-700">Mark complete</span>
              </label>
            </div>

<div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-3 items-start">
  {(Array.isArray(sec.fields) ? sec.fields : []).map((f, idx) => {
    // Custom renderer
    if (f?.type === "custom" && typeof f.render === "function") {
      const k = f.key || `${sec.id || "sec"}-custom-${idx}`;
      return (
        <div key={k} className="md:col-span-2">
          {f.render()}
        </div>
      );
    }

    const key = f?.key || `${sec.id || "sec"}-field-${idx}`;
    return (
      <div key={key} className="flex flex-col">
        {f?.label && (
          <label className="text-sm text-gray-700 mb-1">{f.label}</label>
        )}

        {f?.type === "textarea" ? (
          <textarea
            className="border rounded px-2 py-1 text-sm text-gray-800 min-h-[88px]"
            placeholder={f?.placeholder || ""}
            value={(f && answers[f.key]) || ""}
            onChange={(e) => f && handleAnswer(f.key, e.target.value)}
          />
        ) : f?.type === "select" ? (
          <select
            className="border rounded px-2 py-1 text-sm text-gray-800"
            value={(f && answers[f.key]) || ""}
            onChange={(e) => f && handleAnswer(f.key, e.target.value)}
          >
            <option value="">Select…</option>
            {(Array.isArray(f?.options) ? f.options : []).map((opt) => (
              <option key={String(opt)} value={String(opt)}>
                {String(opt)}
              </option>
            ))}
          </select>
        ) : f?.type === "number" ? (
          <input
            type="number"
            className="border rounded px-2 py-1 text-sm text-gray-800"
            value={(f && (answers[f.key] ?? ""))}
            onChange={(e) => f && handleAnswer(f.key, e.target.value)}
          />
        ) : (
          <input
            type="text"
            className="border rounded px-2 py-1 text-sm text-gray-800"
            placeholder={f?.placeholder || ""}
            value={(f && answers[f.key]) || ""}
            onChange={(e) => f && handleAnswer(f.key, e.target.value)}
          />
        )}
      </div>
    );
  })}
</div>
          </div>
        ))}
      </div>

      <div className="flex gap-3 mt-6">
        <button
          onClick={() => persist(false)}
          disabled={saving}
          className="px-4 py-2 rounded bg-black text-white hover:bg-[#ff6667]"
        >
          {saving ? "Saving…" : "Save Draft"}
        </button>
        <button
          onClick={notifyBand}
          disabled={notifying || completedCount !== totalSections}
          className={`px-4 py-2 rounded ${
            completedCount === totalSections
              ? "bg-emerald-600 text-white hover:bg-emerald-700"
              : "bg-gray-300 text-gray-600 cursor-not-allowed"
          }`}
        >
          {notifying ? "Notifying…" : "Notify Band"}
        </button>
      </div>
    </div>
  );
};

export default ViewEventSheet;