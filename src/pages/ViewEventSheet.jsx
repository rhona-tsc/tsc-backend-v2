import React, {
  useEffect,
  useMemo,
  useState,
  useContext,
  useCallback,
  useRef,
} from "react";
import { assets } from "../assets/assets";
import { useParams, Link } from "react-router-dom";
import axios from "axios";
import { ShopContext } from "../context/ShopContext";
import debounce from "lodash.debounce";
import CustomTimePicker from "../components/CustomTimePicker";

const esDebug = (...args) => console.log("🧾[EventSheet]", ...args);

const currencySymbol = (code) => {
  if (!code) return "£";
  const map = { GBP: "£", USD: "$", EUR: "€" };
  return map[code] || "£";
};

// --- Equipment description helpers (pull from acts in context) ---
const getActEquipmentInfo = (actsList = [], booking) => {
  try {
    const src = Array.isArray(booking?.actsSummary)
      ? booking.actsSummary
      : Array.isArray(booking?.items)
        ? booking.items
        : [];
    const first = src[0] || {};
    const actId = String(first.actId || "");
    const actData = (actsList || []).find((a) => String(a._id) === actId) || {};
    const tscName =
      actData.tscName || actData.name || first.actName || "This act";

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
    const lightText =
      lightingDescriptions[lightTier] || lightingDescriptions.largeLight;

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
  const suppressAutosaveRef = React.useRef(false);
  const hydratedRef = React.useRef(null);
  const params = useParams();
  const routeId = params.bookingId || params.id || null;
  const { user, acts } = useContext(ShopContext);
  const [booking, setBooking] = useState(null);
  // Derive act info once and reuse (must be inside the component)
  const actInfo = useMemo(
    () => getActEquipmentInfo(acts, booking),
    [acts, booking]
  );
  const tscName = actInfo.tscName || "the band";

  // Equipment help text
  const equipmentHelp = useMemo(() => {
    const parts = [actInfo.paText, actInfo.lightText].filter(Boolean);
    return parts.length ? parts.join(" ") : actInfo.blurb || "";
  }, [actInfo]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notifying, setNotifying] = useState(false);
  const [answers, setAnswers] = useState({});
  const [complete, setComplete] = useState({});
const searchParams = new URLSearchParams(window.location.search);
const isReadOnlyParam = searchParams.get("ro") === "1" || searchParams.get("readonly") === "1";
const isReadOnlyRoute = /readonly/i.test(String(params?.mode || params?.view || ""));
const READ_ONLY = isReadOnlyParam || isReadOnlyRoute;
  const backendUrl = import.meta.env.VITE_BACKEND_URL;

  React.useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        let b = null;

        if (routeId) {
          try {
            const r = await axios.get(
              `${backendUrl}/api/booking/by-ref/${routeId}`
            );
            b =
              r?.data?.booking ||
              (Array.isArray(r?.data) ? r.data[0] : r?.data) ||
              null;
          } catch {}

          if (!b && /^[0-9a-f]{24}$/i.test(routeId)) {
            try {
              const r = await axios.get(
                `${backendUrl}/api/booking/booking/${routeId}`
              );
              b = r?.data || null;
            } catch {}
          }

          setBooking(b || null);
          setLoading(false);
          return;
        }

        let newest = null;
        const raw = localStorage.getItem("user");
        const uid = raw ? JSON.parse(raw)?._id : null;
        if (uid) {
          try {
            const r = await axios.get(`${backendUrl}/api/booking/user/${uid}`);
            const list = Array.isArray(r?.data) ? r.data : [];
            newest = list[0] || null;
          } catch {}
        }
        setBooking(newest || null);
      } catch (e) {
        console.error("[EventSheet] fetch booking failed", e);
        setBooking(null);
      } finally {
        setLoading(false);
      }
    })();
  }, [routeId, backendUrl]);

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

  // --- helpers ---
  const lsKey = (bid) => `eventSheet:${bid || "unknown"}`;

  async function notifyBand(payload) {
    try {
      const res = await axios.post(
        `${backendUrl}/api/booking/notify-band`,
        payload
      );
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

  // --- Debounced autosave helper ---
  const saveTimerRef = React.useRef(null);

  const saveEventSheet = (nextAnswers, nextComplete = complete) => {

    if (READ_ONLY) {
  esDebug("saveEventSheet skipped (read-only mode)");
  return;
}


    if (!booking) {
      esDebug("saveEventSheet skipped (no booking)");
      return;
    }

    if (saveTimerRef.current) {
      esDebug("clearing pending debounce");
      clearTimeout(saveTimerRef.current);
    }

    const bookingKey = booking.bookingId || booking._id;

    // 1) Merge with whatever's already in localStorage to avoid shrinking payloads.
    let disk = null;
    try {
      const rawDisk = localStorage.getItem(`eventSheet:${bookingKey}`);
      disk = rawDisk ? JSON.parse(rawDisk) : null;
    } catch {}

    const mergedAnswers = {
      ...(disk?.answers || {}),
      ...(answers || {}), // current state
      ...(nextAnswers || {}), // latest changes
    };
    const mergedComplete = {
      ...(disk?.complete || {}),
      ...(complete || {}),
      ...(nextComplete || {}),
    };

    // 2) Sanitize
    const safeAnswers = sanitizeForSave(mergedAnswers);
    const safeComplete = sanitizeForSave(mergedComplete);

    const eventSheet = {
      answers: safeAnswers,
      complete: safeComplete,
      submitted: !!booking?.eventSheet?.submitted,
      updatedAt: new Date().toISOString(),
    };
    const payload = { bookingId: bookingKey, eventSheet };

    // 3) Persist locally
    try {
      const str = JSON.stringify(eventSheet);
      localStorage.setItem(`eventSheet:${bookingKey}`, str);
      esDebug("💾 local quick-save", {
        key: `eventSheet:${bookingKey}`,
        bytes: str.length,
        answersKeys: Object.keys(safeAnswers).length,
        completeKeys: Object.keys(safeComplete).length,
        submitted: !!eventSheet.submitted,
      });
    } catch (e) {
      console.warn("Local quick-save failed:", e?.message);
    }

    // 4) Debounced network save
    saveTimerRef.current = setTimeout(async () => {
      const url = `${backendUrl}/api/booking/update-event-sheet`;
      const jsonStr = JSON.stringify(payload);
      const bytes = new Blob([jsonStr]).size;
      if (bytes > 900_000) {
        console.warn(
          "⚠️ Payload is large (",
          bytes,
          "bytes). Consider trimming heavy fields."
        );
      }
      esDebug("🌐 POST begin", { url, payloadBytes: bytes });

      try {
        const resp = await axios.post(url, payload, {
          headers: {
            "X-EventSheet-Client": "frontend",
            "Content-Type": "application/json",
          },
        });

        if (resp?.status >= 200 && resp?.status < 300) {
          esDebug("✅ POST ok", { status: resp.status, bookingId: bookingKey });
        } else {
          console.warn("Autosave non-2xx:", resp?.status, resp?.data);
          esDebug("⚠️ POST non-2xx", { status: resp?.status });
        }
      } catch (e) {
        const status = e?.response?.status;
        const data = e?.response?.data;
        console.error("Autosave failed →", {
          url,
          status,
          data,
          message: e?.message,
        });
        esDebug("❌ POST failed; kept locally", {
          status,
          message: e?.message,
        });
      }
    }, 600);
  };

  // Optional: clear debounce on unmount
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) {
        esDebug("cleanup: clearing pending debounce");
        clearTimeout(saveTimerRef.current);
      }
    };
  }, []);

  // --- Fix: use `key` param and autosave with the updated object ---
  const handleAnswer = (key, value) => {

    // inside handleAnswer(key, value)
if (READ_ONLY) {
  esDebug("handleAnswer ignored (read-only mode)", { key });
  return;
}
    setAnswers((prev) => {
      const updated = { ...prev, [key]: value };
      esDebug("✏️ handleAnswer", {
        key,
        previewValue: typeof value === "string" ? value.slice(0, 80) : value,
      });

      if (!suppressAutosaveRef.current) {
        saveEventSheet(updated, complete);
      } else {
        esDebug("✏️ handleAnswer (autosave suppressed)");
      }

      return updated;
    });
  };

  useEffect(() => {
    const val = answers?.parking_checkout_status;
    if (val && typeof val !== "string") {
      // If an element slipped in previously, normalize to a string
      const label = val?.props ? "Paid" : String(val);
      const next = { ...answers, parking_checkout_status: label };
      setAnswers(next);
      saveEventSheet(next, complete);
    }
  }, [answers?.parking_checkout_status]);

  const handleGenerateParkingInvoice = async ({ amountPence }) => {
    if (!booking || !amountPence) return;

    // ensure current state is saved before leaving the site
    saveEventSheet(answers, complete);

    try {
      const resp = await axios.post(
        `${backendUrl}/api/payments/parking-checkout`,
        {
          amount: amountPence, // integer pence
          currency: "gbp",
          bookingId: booking.bookingId, // human ref used in success_url
          description: `Parking for ${booking.bookingId}`,
          metadata: {
            category: "parking",
            bookingId: booking.bookingId,
            amount_pence: String(amountPence),
          },
        }
      );
      if (resp?.data?.url) {
        esDebug("➡️ redirecting to Stripe", { url: resp.data.url });
        window.location.href = resp.data.url;
      }
    } catch (e) {
      console.warn("parking checkout error:", e?.message);
    }
  };

  console.log(
    "Stripe key present:",
    !!import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY
  );

  // Put this near the top of ViewEventSheet.jsx (outside the component is fine)
  const isManagerLike = (m = {}) => {
    const has = (s = "") => /\b(manager|management)\b/i.test(String(s));
    if (m.isManager === true || m.isNonPerformer === true) return true;
    if (has(m.instrument) || has(m.title)) return true;
    const rolesArr = Array.isArray(m.additionalRoles) ? m.additionalRoles : [];
    return rolesArr.some((r) => has(r?.role) || has(r?.title));
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

  // Helper to format richer lineup label for an item
  const formatLineupLabel = (it = {}) => {
    const fromSets =
      Array.isArray(it.selectedAfternoonSets) && it.selectedAfternoonSets.length
        ? it.selectedAfternoonSets.map((s) => s.name).join(" • ")
        : null;
    const countLabel = it.bandMembersCount
      ? `${it.bandMembersCount}-Piece`
      : "";
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
      const extrasTotal = extras.reduce(
        (s, ex) => s + (Number(ex.price) || 0),
        0
      );
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
      const share = fa > 0 ? Math.round(dep * (it.total / fa) * 100) / 100 : 0;
      const remaining = Math.max(0, it.total - share);
      return { ...it, depositShare: share, remainingShare: remaining };
    });
  }, [enrichedItems, fullAmount, depositAmount]);

  // Act(s) display: dedupe act names from normalized items
  const actNames = useMemo(() => {
    const names = normalizedItems
      .map((i) => {
        // if label looks like "Disco Devotion – 5-Piece", keep the left part
        const left = String(i.label).split("–")[0].trim();
        return left || i.label;
      })
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
      const members = Array.isArray(lineup.bandMembers)
        ? lineup.bandMembers
        : [];
      if (!members.length) return "";
      const cap = (s = "") =>
        String(s).replace(/\b\w/g, (c) => c.toUpperCase());

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
      const uniqueInstruments = [...new Set(instruments)].sort(
        (a, b) => weight(a) - weight(b)
      );
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
    const act = (actsList || []).find(
      (a) => String(a._id) === String(item.actId)
    );
    if (!act) return null;
    const lid = String(item.lineupId || "");
    return (act.lineups || []).find(
      (l) => String(l._id) === lid || String(l.lineupId) === lid
    );
  };

  // Resolve lineup and default car count (based on members who have real plates)
  const { lineup, defaultCars } = useMemo(() => {
    if (!booking) return { lineup: null, defaultCars: 0 };

    // local helpers (kept here so this block is self-contained)
    const normalizePlate = (s = "") =>
      String(s).replace(/\s+/g, "").toUpperCase();
    const isRealPlate = (plate) => {
      const p = normalizePlate(plate);
      if (!p) return false;
      // Treat these as "no vehicle"
      const banned = new Set([
        "NO_CAR",
        "NOCAR",
        "NO VEHIClE", // guard typo
        "NOVEHICLE",
        "NO VEHICLE",
        "NONE",
        "NA",
        "N/A",
        "NOREG",
        "NOREGISTRATION",
      ]);
      return !banned.has(p);
    };

    const src = Array.isArray(booking?.actsSummary)
      ? booking.actsSummary
      : Array.isArray(booking?.items)
        ? booking.items
        : [];

    // Count cars = members with a real plate across all booked lineups
    const carsFromPlates = src.reduce((sum, it) => {
      const ln = resolveLineup(acts, it) || it.lineup || null;
      const members = Array.isArray(ln?.bandMembers) ? ln.bandMembers : [];
      const count = members.reduce((c, m) => {
        const raw = (m.carRegistrationValue || m.carRegistration || "").trim();
        return c + (isRealPlate(raw) ? 1 : 0);
      }, 0);
      return sum + count;
    }, 0);

    // Keep your previous fallbacks as a safety net, but prefer the plate count
    const totalCars_byMembers =
      src.reduce((sum, it) => {
        const ln = resolveLineup(acts, it) || it.lineup || null;
        if (Array.isArray(ln?.bandMembers)) {
          const essential = ln.bandMembers.filter(
            (m) => !isManagerLike(m)
          ).length;
          return sum + (essential || 0);
        }
        const byCount = Number(it.bandMembersCount || 0);
        if (Number.isFinite(byCount) && byCount > 0) return sum + byCount;
        const sizeStr = ln?.actSize || it.actSize || "";
        const parsed = parseInt(String(sizeStr).match(/\d+/)?.[0] || "", 10);
        if (Number.isFinite(parsed) && parsed > 0) return sum + parsed;
        return sum;
      }, 0) || 0;

    let cars = carsFromPlates || totalCars_byMembers;

    // If still 0, keep your header/fallback logic
    if ((!cars || cars <= 0) && src.length) {
      const headerLike = src
        .map((it) =>
          (it.lineupLabel || it.lineupName || it.actSize || "").toString()
        )
        .filter(Boolean)
        .join("+");
      const headerParsed = parseInt(
        String(headerLike).match(/\d+/)?.[0] || "",
        10
      );
      if (Number.isFinite(headerParsed) && headerParsed > 0)
        cars = headerParsed;
    }

    // Debug (handy while validating)
    console.debug("[Parking] cars compute (plates first)", {
      itemsCount: src.length,
      carsFromPlates,
      totalCars_byMembers,
      cars_after_fallbacks: cars,
    });

    const firstItem = src[0] || {};
    const resolved = resolveLineup(acts, firstItem) || firstItem.lineup || null;

    return { lineup: resolved, defaultCars: Number(cars) || 0 };
  }, [booking, acts]);

  // Always mirror computed defaultCars into the answers (sheet + autosave)
  useEffect(() => {
    if (!Number.isFinite(Number(defaultCars))) return;
    // don’t auto-write while suppressed (during hydration/stripe merge)
    if (suppressAutosaveRef.current) return;

    if (Number(answers.parking_num_cars) !== Number(defaultCars)) {
      handleAnswer("parking_num_cars", Number(defaultCars));
    }
  }, [defaultCars, answers.parking_num_cars]);

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
          (Array.isArray(lineup?.bandMembers)
            ? `${lineup.bandMembers.length}-Piece`
            : "");
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
        console.log(
          "👤 ViewEventSheet resolvedUserId:",
          resolvedUserId,
          "routeId:",
          routeId
        );
        let match = null;

        // 0) If we have a routeId, try direct lookups first (works even w/o user)
        if (routeId) {
          // try Mongo _id route
          try {
            const byId = await axios.get(
              `${backendUrl}/api/booking/booking/${routeId}`
            );
            if (byId?.data?._id) {
              match = byId.data;
              console.log("🎯 Loaded booking by _id:", match);
            }
          } catch {}

          // try booking ref route if still not found
          if (!match) {
            try {
              const byRefResp = await axios.get(
                `${backendUrl}/api/booking/by-ref/${routeId}`
              );
              const data = byRefResp?.data;
              const b =
                data?.booking || (Array.isArray(data) ? data[0] : null) || data;
              if (b?._id || b?.bookingId) {
                match = b;
                console.log("🎯 Loaded booking by-ref:", match);
              }
            } catch (e) {
              console.warn(
                "by-ref lookup failed (will try user list):",
                e?.message
              );
            }
          }
        }

        // 1) If not matched yet, and we have a user, try user bookings list
        if (!match && resolvedUserId) {
          console.log(
            "🛰️ Fetching bookings for user:",
            resolvedUserId,
            "from",
            backendUrl
          );
          let list = [];

          // Try GET user route
          try {
            const getResp = await axios.get(
              `${backendUrl}/api/booking/user/${resolvedUserId}`
            );
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
              const postResp = await axios.post(
                `${backendUrl}/api/booking/user`,
                {
                  userId: resolvedUserId,
                }
              );
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
              const ta = new Date(
                a.createdAt || a.updatedAt || a.date || 0
              ).getTime();
              const tb = new Date(
                b.createdAt || b.updatedAt || b.date || 0
              ).getTime();
              return tb - ta;
            })[0];
          }
        }

        console.log("✅ Selected booking:", match);
        setBooking(match || null);

        if (match) {
          const key = lsKey(match.bookingId || match._id);
          const raw = localStorage.getItem(key);
          if (raw) {
            const parsed = JSON.parse(raw);
            setAnswers(parsed.answers || {});
            setComplete(parsed.complete || {});
          } else if (match.eventSheet) {
            setAnswers(match.eventSheet.answers || {});
            setComplete(match.eventSheet.complete || {});
          } else {
            const src = Array.isArray(match.actsSummary)
              ? match.actsSummary
              : Array.isArray(match.items)
                ? match.items
                : [];

            const suggestions = src.flatMap((it) =>
              Array.isArray(it.songSuggestions) ? it.songSuggestions : []
            );

            const suggestionsText = suggestions
              .map((s) => {
                const t = (s.title || "").trim();
                const a = (s.artist || "").trim();
                if (t && a) return `${t} – ${a}`;
                return t || a;
              })
              .filter(Boolean)
              .join("\n");

            const seeded = suggestionsText
              ? { song_suggestions: suggestionsText }
              : {};

            setAnswers(seeded);
            setComplete({});
          }
        }
      } catch (e) {
        console.error("Error fetching booking:", e);
        setBooking(null);
      } finally {
        setLoading(false);
      }
    })();
  }, [routeId, resolvedUserId, backendUrl]);

  // after `setBooking(match || null);` (i.e., once a booking is in state)
  // add a new effect:
  useEffect(() => {
    if (!booking) return;

    const hasNum = !!(
      booking.eventSheet?.emergencyContact?.number ||
      booking.contactRouting?.proxyNumber
    );
    const hasCode = !!(
      booking.eventSheet?.emergencyContact?.ivrCode ||
      booking.contactRouting?.ivrCode
    );
    if (hasNum && hasCode) return;

    const idOrRef = booking.bookingId || booking._id;
    if (!idOrRef) return;

    (async () => {
      try {
        const resp = await axios.post(
          `${backendUrl}/api/booking/${encodeURIComponent(idOrRef)}/ensure-emergency-contact`
        );
        const updated = resp?.data?.booking;
        if (updated?._id) {
          setBooking(updated); // refresh local copy so the read-only inputs fill in
        }
      } catch (e) {
        console.warn("ensure-emergency-contact failed:", e?.message || e);
      }
    })();
  }, [booking, backendUrl]);

  // On return from Stripe (?parkingPaid=1 or ?parkingCanceled=1),
  // merge status into whatever was last saved (localStorage or state)
  // and immediately persist.
  useEffect(() => {
    if (!booking) return;
    const params = new URLSearchParams(window.location.search);
    const paid = params.get("parkingPaid") === "1";
    const canceled = params.get("parkingCanceled") === "1";
    if (!paid && !canceled) return;

    esDebug("↩️ Returned from Stripe", {
      bookingKey: booking.bookingId || booking._id,
      paid,
      canceled,
    });

    suppressAutosaveRef.current = true; // 👈 block autosaves temporarily

    // read last-saved answers for this booking directly from localStorage
    const key = lsKey(booking.bookingId || booking._id);
    let storedAnswers = {};
    let storedComplete = {};
    try {
      const raw = localStorage.getItem(key);
      esDebug("localStorage.getItem", {
        key,
        present: !!raw,
        bytes: raw ? raw.length : 0,
      });
      if (raw) {
        const parsed = JSON.parse(raw);
        storedAnswers = parsed?.answers || {};
        storedComplete = parsed?.complete || {};
        esDebug("parsed local copy", {
          answersKeys: Object.keys(storedAnswers).length,
          completeKeys: Object.keys(storedComplete).length,
          submitted: !!parsed?.submitted,
        });
      }
    } catch (e) {
      console.warn("localStorage parse failed:", e?.message);
    }

    // merge: stored → current state → new status
    const mergedAnswers = {
      ...storedAnswers,
      ...answers,
      parking_checkout_status: paid ? "Paid" : "canceled",
    };

    esDebug("merge-and-apply", {
      mergedAnswersKeys: Object.keys(mergedAnswers).length,
      hadCompleteFromLS: Object.keys(storedComplete).length,
    });

    setAnswers(mergedAnswers);
    if (Object.keys(storedComplete).length && storedComplete !== complete) {
      setComplete(storedComplete);
    }

    esDebug("saveEventSheet (post-Stripe)");
    saveEventSheet(mergedAnswers, storedComplete || complete);

    // release suppression on next tick so later user edits save normally
    setTimeout(() => {
      suppressAutosaveRef.current = false;
    }, 0);
  }, [booking]);

  const handleOpenBalanceInvoice = async () => {
    if (!booking) return;
    try {
      const r = await axios.get(
        `${backendUrl}/api/invoices/balance-link/${booking.bookingId || booking._id}`
      );
      const url = r?.data?.url;
      if (url) {
        window.open(url, "_blank", "noopener,noreferrer");
      } else {
        alert("Couldn’t get a payment link right now.");
      }
    } catch (e) {
      console.warn("balance-link error:", e?.response?.data || e?.message);
      alert("Couldn’t get a payment link right now.");
    }
  };

  // ⛔ Block completion if lineup requires a changing room but client selects "No"
  useEffect(() => {
    if (!booking) return;

    // resolve the selected lineup
    const src = Array.isArray(booking?.actsSummary)
      ? booking.actsSummary
      : Array.isArray(booking?.items)
        ? booking.items
        : [];
    const firstItem = src[0] || {};
    const ln =
      (typeof resolveLineup === "function"
        ? resolveLineup(acts, firstItem)
        : null) ||
      firstItem.lineup ||
      null;

    const requiresRoom = !!ln?.changingRoom; // ← from your lineup data
    const selection = String(answers?.changing_room || "");

    if (requiresRoom && selection === "No") {
      // ensure this section cannot be treated as complete
      setComplete((prev) => ({ ...prev, changing_room: false }));
    }
  }, [booking, acts, answers?.changing_room]);

  function extractDietaryRequirements(actsList = [], booking) {
    try {
      const src = Array.isArray(booking?.actsSummary)
        ? booking.actsSummary
        : Array.isArray(booking?.items)
          ? booking.items
          : [];
      const first = src[0] || {};
      const act = (actsList || []).find(
        (a) => String(a._id) === String(first.actId)
      );
      const lineup = act
        ? (act.lineups || []).find(
            (l) =>
              String(l._id) === String(first.lineupId || first.lineup?.lineupId)
          )
        : first.lineup || null;
      const members = Array.isArray(lineup?.bandMembers)
        ? lineup.bandMembers
        : [];

      const clean = (s = "") => String(s || "").trim();
      const mapDiet = (s) => {
        const x = clean(s).toLowerCase();
        if (!x || x === "none" || x === "no" || x === "n/a")
          return DIET_FALLBACK;
        return s;
      };

      return members
        .filter((m) => !isManagerLike(m))
        .map((m) => ({
          name:
            [m?.firstName, m?.lastName].filter(Boolean).join(" ") ||
            "Band member",
          instrument: m?.instrument || "",
          diet: mapDiet(m?.dietaryRequirements || m?.dietary || ""),
        }));
    } catch {
      return [];
    }
  }

  function getHotMealRequirement(actsList = [], booking) {
    try {
      // Find the first booked lineup (same approach as your other helpers)
      const src = Array.isArray(booking?.actsSummary)
        ? booking.actsSummary
        : Array.isArray(booking?.items)
          ? booking.items
          : [];
      const first = src[0] || {};
      const act = (actsList || []).find(
        (a) => String(a._id) === String(first.actId)
      );
      const lineup = act
        ? (act.lineups || []).find(
            (l) =>
              String(l._id) === String(first.lineupId || first.lineup?.lineupId)
          )
        : first.lineup || null;

      // Count performers (exclude managers/non-performers)
      const members = Array.isArray(lineup?.bandMembers)
        ? lineup.bandMembers
        : [];
      const performerCount = members.filter((m) => !isManagerLike(m)).length;

      // Hot meal can come as a number or boolean. We’ll handle both.
      const raw = lineup?.hotMeal ?? lineup?.hotMeals ?? lineup?.meals ?? null;

      let count = 0;
      if (typeof raw === "number") {
        count = Math.max(0, raw);
      } else if (raw === true) {
        // If it’s a boolean requirement, fall back to number of performers
        count = performerCount || 1; // at least 1 if we don’t know
      }

      return {
        required: count > 0,
        count,
      };
    } catch {
      return { required: false, count: 0 };
    }
  }

  function getPerformanceTimesFromBooking(booking) {
    try {
      const src = Array.isArray(booking?.actsSummary)
        ? booking.actsSummary
        : Array.isArray(booking?.items)
          ? booking.items
          : [];
      const first = src[0] || {};

      // Prefer explicit performanceTimes at top-level
      const perfTop = booking?.performanceTimes || {};
      const perfFirst = first?.performance || {};

      const finishTime =
        perfTop.finishTime ||
        perfFirst.finishTime ||
        booking?.finishTime ||
        first?.endTime ||
        "";

      // Day offset can come from a number or string; coerce to int if present
      const finishDayOffsetRaw =
        perfTop.finishDayOffset ??
        perfFirst.finishDayOffset ??
        booking?.finishDayOffset ??
        first?.finishDayOffset;
      const finishDayOffset = Number.isFinite(Number(finishDayOffsetRaw))
        ? Number(finishDayOffsetRaw)
        : 0;

      return {
        arrivalTime: perfTop.arrivalTime || perfFirst.arrivalTime || "",
        setupAndSoundcheckedBy:
          perfTop.setupAndSoundcheckedBy ||
          perfFirst.setupAndSoundcheckedBy ||
          "",
        startTime: perfTop.startTime || perfFirst.startTime || "",
        finishTime,
        finishDayOffset,
      };
    } catch {
      return {
        arrivalTime: "",
        setupAndSoundcheckedBy: "",
        startTime: "",
        finishTime: "",
        finishDayOffset: 0,
      };
    }
  }

  function getSetOptionsFromAct(actsList = [], booking) {
    // Expect: [ { sets, length, minInterval } ]
    const src = Array.isArray(booking?.actsSummary)
      ? booking.actsSummary
      : Array.isArray(booking?.items)
        ? booking.items
        : [];
    const first = src[0] || {};
    const act = (actsList || []).find(
      (a) => String(a._id) === String(first.actId)
    );
    let options = [];
    const fromAct = act?.performanceOptions || act?.eveningSetOptions || [];
    if (Array.isArray(fromAct) && fromAct.length) {
      options = fromAct
        .map((o, i) => ({
          key: `opt-${i}`,
          sets: Number(o.sets || o.numberOfSets || 0) || 0,
          length: Number(o.length || o.setLength || 0) || 0,
          minInterval:
            Number(o.minInterval || o.minimumInterval || o.interval || 15) ||
            15,
        }))
        .filter((o) => o.sets && o.length);
    }
    if (!options.length) {
      options = [
        { key: "opt-3x40", sets: 3, length: 40, minInterval: 15 },
        { key: "opt-2x60", sets: 2, length: 60, minInterval: 30 },
      ];
    }
    return options;
  }

  // A row time input that uses CustomTimePicker (5-min steps)
  function TimePickerCell({ k, answers, handleAnswer, enableOffset }) {
    const value = answers[timeKey(k)] || ""; // "HH:MM" or ""
    const dayOffset = Number(answers[offsetKey(k)] || 0); // 0/1 for next day (optional)

    return (
      <CustomTimePicker
        value={value}
        enableDayOffset={!!enableOffset}
        dayOffset={enableOffset ? dayOffset : 0}
        onDayOffsetChange={(v) => enableOffset && handleAnswer(offsetKey(k), v)}
        minuteStep={5}
        onChange={(newHHMM) => handleAnswer(timeKey(k), newHHMM)}
      />
    );
  }

  // Seed schedule finish from booking once (if empty)
  useEffect(() => {
    if (!booking) return;

    // prefer top-level performanceTimes, else first actsSummary.performance
    const perf =
      booking?.performanceTimes ||
      (Array.isArray(booking?.actsSummary) &&
        booking.actsSummary[0]?.performance) ||
      {};

    const finishHHMM = (perf?.finishTime || "").trim();
    const finishOffset = Number.isFinite(Number(perf?.finishDayOffset))
      ? Number(perf.finishDayOffset)
      : 0;

    if (finishHHMM && !answers["schedule_time_finish"]) {
      handleAnswer("schedule_time_finish", finishHHMM);
    }
    if (answers["schedule_dayOffset_finish"] == null) {
      handleAnswer("schedule_dayOffset_finish", finishOffset);
    }
  }, [booking?._id, booking?.updatedAt]); // run again if the booking changes

  function ScheduleEditor({ booking, acts, answers, handleAnswer, readOnly = false }) {
    // --- key helpers ---
    const timeKey = (k) => `schedule_time_${k}`;
    const notesKey = (k) => `schedule_notes_${k}`;
    const offKey = (k) => `schedule_dayOffset_${k}`;

    const addMinutes = (hhmm, mins) => {
      if (!hhmm || !hhmm.includes(":")) return "";
      const [h, m] = hhmm.split(":").map(Number);
      let t = h * 60 + m + (mins || 0);
      while (t < 0) t += 1440;
      t %= 1440;
      const H = String(Math.floor(t / 60)).padStart(2, "0");
      const M = String(t % 60).padStart(2, "0");
      return `${H}:${M}`;
    };

    // --- time parsing helpers ---
    const toHHMM = (h24, m) =>
      `${String(h24).padStart(2, "0")}:${String(m).padStart(2, "0")}`;

    /** Accepts "19:30", "7:30pm", "730pm", "19.30", "7pm", "0030", etc.
     *  Returns {hhmm:"HH:MM", dayOffset:0|1} or null if unusable. */
    const normalizeFinishLike = (raw) => {
      if (!raw) return null;
      let s = String(raw).trim().toLowerCase();

      // Common words
      if (s === "midnight") return { hhmm: "00:00", dayOffset: 1 };
      if (s === "noon") return { hhmm: "12:00", dayOffset: 0 };

      // Replace separators and strip spaces
      s = s.replace(/[\.\-]/g, ":").replace(/\s+/g, "");

      // Capture am/pm
      const ampmMatch = s.match(/(am|pm)$/);
      const ampm = ampmMatch ? ampmMatch[1] : null;
      if (ampm) s = s.replace(/(am|pm)$/, "");

      // Now s should be something like "19:30", "730", "7:30", "19"
      let h = 0,
        m = 0;
      if (/^\d{1,2}:\d{2}$/.test(s)) {
        const [hh, mm] = s.split(":").map(Number);
        h = hh;
        m = mm;
      } else if (/^\d{3,4}$/.test(s)) {
        // "730" => 7:30, "0030" => 0:30
        const mm = s.slice(-2);
        const hh = s.slice(0, s.length - 2) || "0";
        h = Number(hh);
        m = Number(mm);
      } else if (/^\d{1,2}$/.test(s)) {
        h = Number(s);
        m = 0;
      } else {
        return null;
      }

      // Apply am/pm if present
      if (ampm) {
        const isPM = ampm === "pm";
        const h12 = h % 12;
        h = isPM ? h12 + 12 : h12;
      }

      // Clamp
      h = Math.max(0, Math.min(23, h));
      m = Math.max(0, Math.min(59, m));

      return { hhmm: toHHMM(h, m), dayOffset: 0 };
    };

    /** Find a finish-like time across several likely booking fields. */
    const findFinishFromBooking = (booking, perf, first) => {
      const candidates = [
        booking?.performanceTimes?.finishTime,
        perf?.finishTime,
        first?.performance?.finishTime,
        first?.finishTime,
        booking?.finishTime,
        first?.endTime,
        booking?.endTime,
        first?.times?.finish,
        booking?.times?.finish,
        first?.times?.end,
        booking?.times?.end,
      ].filter(Boolean);

      for (const c of candidates) {
        const norm = normalizeFinishLike(c);
        if (norm) return norm;
      }
      return null;
    };

    const ordinal = (n) =>
      n === 1 ? "1st" : n === 2 ? "2nd" : n === 3 ? "3rd" : `${n}th`;

    const perf = getPerformanceTimesFromBooking(booking) || {};
    const src = Array.isArray(booking?.actsSummary)
      ? booking.actsSummary
      : Array.isArray(booking?.items)
        ? booking.items
        : [];
    const first = src[0] || {};
    const lineupObj = resolveLineup(acts, first) || first.lineup || null;
    const extras = Array.isArray(first?.selectedExtras)
      ? first.selectedExtras
      : [];

    // Speedy setup (evening)
    const hasSpeedy = extras.some((e) =>
      /speedy\s*setup/i.test(String(e?.name || e?.key || ""))
    );
    let setupMins = Number(lineupObj?.setupTime || 60);
    let soundcheckMins = Number(lineupObj?.soundcheckTime || 30);
    const changeMins = 15;
    if (hasSpeedy) {
      setupMins = 30;
      soundcheckMins = 30;
    }

    // Ceremony time (e.g., “Ceremony @ 12:00”)
    const ceremonyExtra = extras.find(
      (ex) =>
        /ceremony/i.test(ex?.key || "") || /ceremony/i.test(ex?.name || "")
    );
    const ceremonyTime = (() => {
      const s = ceremonyExtra?.name || ceremonyExtra?.key || "";
      const m = s.match(/@\s*([0-2]?\d:[0-5]\d)/);
      return m ? m[1] : "";
    })();

    // Afternoon performance (ignore “Amplified” in label)
    const afternoonExtra = extras.find(
      (ex) =>
        /afternoon/i.test(ex?.key || "") || /afternoon/i.test(ex?.name || "")
    );
    const afternoonInfo = (() => {
      if (!afternoonExtra) return null;
      const s = String(afternoonExtra.name || afternoonExtra.key || "");
      const t = s.match(/@\s*([0-2]?\d:[0-5]\d)/);
      const d = s.match(/([0-9]+(?:\.[0-9])?)\s*h/i);
      const hhmm = t ? t[1] : "";
      const minutes = Math.round((d ? parseFloat(d[1]) : 1.5) * 60);
      return { hhmm, minutes };
    })();

    // Afternoon set options (1×60 or 2×45 for ~90m; 1×60 for ~60m)
    const afternoonOptions = React.useMemo(() => {
      if (!afternoonInfo) return [];
      const mins = afternoonInfo.minutes || 90;
      if (mins >= 55 && mins <= 65)
        return [{ key: "aft_1x60", sets: 1, length: 60 }];
      return [
        { key: "aft_1x60", sets: 1, length: 60 },
        { key: "aft_2x45", sets: 2, length: 45 },
      ];
    }, [afternoonInfo]);

    const afternoonSetKey =
      answers.schedule_afternoon_set_option ||
      (afternoonOptions[0] && afternoonOptions[0].key);
    React.useEffect(() => {
      if (afternoonOptions.length && !answers.schedule_afternoon_set_option) {
        handleAnswer("schedule_afternoon_set_option", afternoonSetKey);
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [afternoonOptions.length]);

    const afternoonChosen =
      afternoonOptions.find(
        (o) =>
          o.key === (answers.schedule_afternoon_set_option || afternoonSetKey)
      ) || afternoonOptions[0];

    const aftSetCount = afternoonChosen?.sets || 0;
    const aftSetLen = afternoonChosen?.length || 60;
    const aftSetKeys = Array.from(
      { length: aftSetCount },
      (_, i) => `afternoon_set_${i + 1}`
    );
    const aftIntermissionKeys = Array.from(
      { length: Math.max(0, aftSetCount - 1) },
      (_, i) => `afternoon_between_${i + 1}`
    );


    // Seed finish directly from the card we display (only if empty)
// ✅ Extra-safe seeding from the booking card's performance block
React.useEffect(() => {
  if (!booking) return;
  if (answers[timeKey("finish")]) {
    console.debug("[ScheduleEditor] finish already set →", answers[timeKey("finish")]);
    return; // already set
  }

  const perfCard = (Array.isArray(booking?.actsSummary) && booking.actsSummary[0]?.performance) || {};
  console.debug("[ScheduleEditor] perfCard.finishTime raw:", perfCard?.finishTime, "offset:", perfCard?.finishDayOffset);

  const raw = perfCard?.finishTime;
  if (!raw) {
    console.debug("[ScheduleEditor] no raw finishTime in perfCard");
    return;
  }

  const norm = normalizeFinishLike(raw);
  console.debug("[ScheduleEditor] normalizeFinishLike(raw) →", norm);

  if (!norm?.hhmm) {
    console.debug("[ScheduleEditor] normalizeFinishLike failed for", raw);
    return;
  }

  // Write HH:MM
  handleAnswer(timeKey("finish"), norm.hhmm);
  console.debug("[ScheduleEditor] seeded finish →", norm.hhmm);

  // Day offset: prefer the card value if present, else 0
  if (answers[offKey("finish")] == null) {
    const off = Number.isFinite(Number(perfCard?.finishDayOffset))
      ? Number(perfCard.finishDayOffset)
      : 0;
    handleAnswer(offKey("finish"), off);
    console.debug("[ScheduleEditor] seeded finish offset →", off);
  }
}, [booking, answers[timeKey("finish")]]);

// If finish is an AM time that should be next-day (00:00–03:59), flip the day offset to 1
React.useEffect(() => {
  const v = answers[`schedule_time_finish`];
  if (!v || !v.includes(":")) return;

  const [hStr] = v.split(":");
  const h = parseInt(hStr, 10);
  const off = Number(answers[`schedule_dayOffset_finish`] || 0);

  // 00:00–03:59 must be "Next day" for our picker to show valid AM hours
  if (off === 0 && h >= 0 && h <= 3) {
    handleAnswer(`schedule_dayOffset_finish`, 1);
  }

  // (Optional) if someone later changes to a PM/late evening hour, snap back to Event day
  if (off === 1 && h >= 9) {
    handleAnswer(`schedule_dayOffset_finish`, 0);
  }
}, [answers[`schedule_time_finish`], answers[`schedule_dayOffset_finish`]]);

    // ===== Evening Live set options =====
    const optionsRaw = getSetOptionsFromAct(acts, booking) || [];
    const options = optionsRaw.length
      ? optionsRaw
      : [
          { key: "2x45", sets: 2, length: 45, minInterval: 15 },
          { key: "2x60", sets: 2, length: 60, minInterval: 30 },
          { key: "3x40", sets: 3, length: 40, minInterval: 15 },
        ];
    const setKey = answers.schedule_set_option || options[0]?.key;
    const chosen = options.find((o) => o.key === setKey) || options[0];
    const setCount = Math.max(1, Number(chosen?.sets || 2));
    const setLength = Number(chosen?.length || 45);

    // Extra performance (e.g., "Extra 40min Performance")
    const extraPerf = extras.find((e) =>
      /(extra|additional)\s*\d+\s*min/i.test(String(e?.name || e?.key || ""))
    );
    const extraMinutes = (() => {
      if (!extraPerf) return 0;
      const m = String(extraPerf.name || extraPerf.key).match(/(\d+)\s*min/i);
      return m ? parseInt(m[1], 10) : 0;
    })();
    const hasExtraSet = extraMinutes > 0;

    // Speeches
    const hasSpeeches = extras.some((e) =>
      /mic.*speech|speeches/i.test(String(e?.name || e?.key || ""))
    );

    // Post-live choices (+ PA for external act if booked)
    const hasBandMemberDJ = extras.some((e) =>
      /band\s*member\s*dj/i.test(String(e?.name || e?.key || ""))
    );
    const hasManned = extras.some((e) =>
      /manned\s*playlist/i.test(String(e?.name || e?.key || ""))
    );
    const hasExternalPA = extras.some((e) =>
      /pa.*external|external.*pa/i.test(String(e?.name || e?.key || ""))
    );

    const postLiveChoices = [
      { value: "", label: "None" },
      { value: "spotify", label: "Complimentary playlist" },
      ...(hasManned ? [{ value: "manned", label: "Manned playlist" }] : []),
      ...(hasBandMemberDJ
        ? [{ value: "dj_member", label: "Band Member DJ" }]
        : []),
      ...(hasExternalPA
        ? [{ value: "pa_external", label: "PA Use For an External Act" }]
        : []),
    ];

    // Sax blocks (always 3)
    const saxKeys = ["sax_1", "sax_2", "sax_3"];

    // ✅ Extra-safe seeding from the booking card's performance block
    React.useEffect(() => {
      // Only act if the scheduler doesn't already have a finish time
      if (answers[timeKey("finish")]) return;

      const perfCard = (Array.isArray(booking?.actsSummary) && booking.actsSummary[0]?.performance) || {};
      const raw = perfCard?.finishTime;
      if (!raw) return;

      const norm = normalizeFinishLike(raw);
      if (!norm?.hhmm) return;

      // Write HH:MM
      handleAnswer(timeKey("finish"), norm.hhmm);

      // Day offset: prefer the card value if present, else 0
      if (answers[offKey("finish")] == null) {
        const off = Number.isFinite(Number(perfCard?.finishDayOffset))
          ? Number(perfCard.finishDayOffset)
          : 0;
        handleAnswer(offKey("finish"), off);
      }
    }, [booking, answers[timeKey("finish")]]);

    // ====== Seeding times (robust) ======
    React.useEffect(() => {
      // Pull the exact card source first (what the booking card shows)
      const perfCard = (Array.isArray(booking?.actsSummary) && booking.actsSummary[0]?.performance) || {};

      // ARRIVAL (unchanged from your logic)
      if (perf.arrivalTime && !answers[timeKey("arrival")]) {
        const normArr = normalizeFinishLike(perf.arrivalTime);
        if (normArr?.hhmm) handleAnswer(timeKey("arrival"), normArr.hhmm);
      }

      // FINISH — try the card source first, then the other finders
      const ensureFinish = (hhmmRaw, offsetRaw) => {
        if (!hhmmRaw) return false;
        const norm = normalizeFinishLike(hhmmRaw);
        if (!norm?.hhmm) return false;
        handleAnswer(timeKey("finish"), norm.hhmm);
        const dbOffset = Number.isFinite(Number(offsetRaw))
          ? Number(offsetRaw)
          : Number.isFinite(Number(perf?.finishDayOffset))
            ? Number(perf.finishDayOffset)
            : answers[offKey("finish")];
        handleAnswer(
          offKey("finish"),
          Number.isFinite(dbOffset) ? Number(dbOffset) : norm.dayOffset || 0
        );
        return true;
      };

      // 1) If scheduler has no finish yet, seed from the card’s performance block
      if (!answers[timeKey("finish")]) {
        const fromCard = ensureFinish(perfCard.finishTime, perfCard.finishDayOffset);

        // 2) If card didn’t have it, use the wider search across booking shapes
        if (!fromCard) {
          const found = findFinishFromBooking(booking, perf, first);
          if (found?.hhmm) {
            handleAnswer(timeKey("finish"), found.hhmm);
            const dbOffset = Number.isFinite(Number(perf?.finishDayOffset))
              ? Number(perf.finishDayOffset)
              : answers[offKey("finish")];
            handleAnswer(
              offKey("finish"),
              Number.isFinite(dbOffset) ? Number(dbOffset) : found.dayOffset || 0
            );
          }
        }
      } else if (
        answers[offKey("finish")] == null &&
        Number.isFinite(Number(perf?.finishDayOffset))
      ) {
        handleAnswer(offKey("finish"), Number(perf.finishDayOffset));
      }

      // 3) Final fallback: top-level booking.performanceTimes (if still blank)
      if (!answers[timeKey("finish")] && booking?.performanceTimes?.finishTime) {
        ensureFinish(
          booking.performanceTimes.finishTime,
          booking.performanceTimes.finishDayOffset
        );
      }

      // Helpful debug while we iron this out
      console.debug("[ScheduleEditor] seed finish", {
        fromCard: perfCard.finishTime,
        fromPerf: perf.finishTime,
        fromTop: booking?.performanceTimes?.finishTime,
        result: answers[timeKey("finish")],
        offset: answers[offKey("finish")],
      });
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [
      perf.arrivalTime,
      perf.finishTime,
      perf.finishDayOffset,
      booking,
      first,
    ]);

    React.useEffect(() => {
      const arrival = answers[timeKey("arrival")] || perf.arrivalTime;
      const candidate =
        perf.startTime ||
        (arrival
          ? addMinutes(arrival, setupMins + soundcheckMins + changeMins)
          : "");
      if (!answers[timeKey("set_1")] && candidate) {
        handleAnswer(timeKey("set_1"), candidate);
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [
      answers[timeKey("arrival")],
      setupMins,
      soundcheckMins,
      perf.startTime,
    ]);

    React.useEffect(() => {
      if (!ceremonyTime) return;
      if (!answers[timeKey("ceremony_setup")])
        handleAnswer(timeKey("ceremony_setup"), addMinutes(ceremonyTime, -60));
      if (!answers[timeKey("ceremony_soundcheck")])
        handleAnswer(
          timeKey("ceremony_soundcheck"),
          addMinutes(ceremonyTime, -30)
        );
      if (!answers[timeKey("ceremony")])
        handleAnswer(timeKey("ceremony"), ceremonyTime);
      // ceremony lunch only if no afternoon cluster
      if (!afternoonInfo && !answers[timeKey("ceremony_lunch")]) {
        handleAnswer(timeKey("ceremony_lunch"), addMinutes(ceremonyTime, 60));
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [ceremonyTime, afternoonInfo]);

    React.useEffect(() => {
      if (afternoonInfo?.hhmm && !answers[timeKey("afternoon_set_1")]) {
        handleAnswer(timeKey("afternoon_set_1"), afternoonInfo.hhmm);
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [afternoonInfo?.hhmm]);

    // ===== Canonical base (initial layout only) =====
    const base = [];
    if (ceremonyTime) {
      base.push("ceremony_setup", "ceremony_soundcheck", "ceremony");
      if (!afternoonInfo) base.push("ceremony_lunch");
    }
    if (afternoonInfo) {
      base.push("afternoon_setup", "afternoon_soundcheck", "afternoon_lunch");
      aftSetKeys.forEach((key, i) => {
        base.push(key);
        if (i < aftSetKeys.length - 1) base.push(`afternoon_between_${i + 1}`);
      });
    }
    base.push("arrival", "setup", "soundcheck", "change");
    if (hasSpeeches) base.push("speeches"); // before 1st evening set
    for (let i = 1; i <= setCount; i++) base.push(`set_${i}`);
    if (hasExtraSet) base.push("extra_set"); // after the last set

    // add evening intermissions based on TOTAL number of sets (incl. extra_set)
    const totalSets = setCount + (hasExtraSet ? 1 : 0);
    if (totalSets >= 2) base.push("between_1");
    if (totalSets >= 3) base.push("between_2");
    if (totalSets >= 4) base.push("between_3");

    // Sax blocks & selector + finish
    base.push(...saxKeys, "after_final", "finish");

    // User-created extra intermissions (persisted as array)
    const customBetween = Array.isArray(answers.schedule_between_custom)
      ? answers.schedule_between_custom
      : [];
    for (const k of customBetween) if (!base.includes(k)) base.push(k);

    // ===== Order and constraints =====
    const currentOrder = Array.isArray(answers.schedule_order)
      ? answers.schedule_order
      : [];
    const ensureUnique = (arr) => Array.from(new Set(arr));

  const enforceRules = (orderIn) => {
  let order = (orderIn || []).filter((k) => base.includes(k));
  // add any missing keys in base order
  for (const k of base) if (!order.includes(k)) order.push(k);
  order = ensureUnique(order);

  // Keep after_final then finish as the last two
  order = order.filter((k) => k !== "after_final" && k !== "finish");
  order.push("after_final", "finish");

  // --- NEW: keep the whole afternoon cluster together and before evening prep ---
  if (afternoonInfo) {
    const afternoonCluster = [];
    afternoonCluster.push("afternoon_setup", "afternoon_soundcheck", "afternoon_lunch");
    aftSetKeys.forEach((key, i) => {
      afternoonCluster.push(key);
      if (i < aftSetKeys.length - 1) afternoonCluster.push(`afternoon_between_${i + 1}`);
    });

    // Remove any existing occurrences so we can reinsert as a block
    order = order.filter((k) => !afternoonCluster.includes(k));

    // Insert the whole cluster just before the evening prep (arrival)
    const arrivalIdx = order.indexOf("arrival");
    const insertAt = arrivalIdx !== -1 ? arrivalIdx : 0;
    order.splice(insertAt, 0, ...afternoonCluster);
  }
  // --- end NEW block ---

  // Afternoon intermissions must sit BETWEEN afternoon sets (kept)
  for (let i = 0; i < aftSetKeys.length - 1; i++) {
    const setKey = aftSetKeys[i];
    const nextSet = aftSetKeys[i + 1];
    const betweenKey = `afternoon_between_${i + 1}`;
    if (order.includes(betweenKey)) {
      order = order.filter((k) => k !== betweenKey);
      const idxSet = order.indexOf(setKey);
      const idxNext = order.indexOf(nextSet);
      if (idxSet !== -1 && idxNext !== -1 && idxSet < idxNext) {
        order.splice(idxSet + 1, 0, betweenKey);
      }
    }
  }

  // Speeches sits AFTER change and BEFORE first evening set (kept)
  if (order.includes("speeches")) {
    order = order.filter((k) => k !== "speeches");
    const firstSetIdx = order.findIndex((k) => /^set_\d+$/.test(k));
    const changeIdx = order.indexOf("change");
    const insertAt = firstSetIdx !== -1 ? firstSetIdx : order.indexOf("after_final");
    if (changeIdx !== -1 && (firstSetIdx === -1 || changeIdx < firstSetIdx)) {
      order.splice(changeIdx + 1, 0, "speeches");
    } else {
      order.splice(insertAt === -1 ? order.length - 2 : insertAt, 0, "speeches");
    }
  }

  // Extra set must be AFTER the last evening set (kept)
  if (hasExtraSet && order.includes("extra_set")) {
    order = order.filter((k) => k !== "extra_set");
    const eveningSetIdxs = order.map((k, i) => (/^set_\d+$/.test(k) ? i : -1)).filter((i) => i !== -1);
    const lastSetIdx = eveningSetIdxs.length ? eveningSetIdxs[eveningSetIdxs.length - 1] : -1;
    const insertAt = lastSetIdx !== -1 ? lastSetIdx + 1 : order.indexOf("after_final");
    order.splice(insertAt === -1 ? order.length - 1 : insertAt, 0, "extra_set");
  }

  // Evening intermissions + sax placement (kept)
  const eveningSetsOrdered = [];
  for (let i = 1; i <= setCount; i++) if (order.includes(`set_${i}`)) eveningSetsOrdered.push(`set_${i}`);
  if (hasExtraSet && order.includes("extra_set")) eveningSetsOrdered.push("extra_set");

  order = order.filter((k) => !/^between_[123]$/.test(k) && !/^sax_[1-3]$/.test(k));

  const insertAfter = (arr, anchor, item) => {
    const idx = arr.indexOf(anchor);
    if (idx !== -1) arr.splice(idx + 1, 0, item);
  };

  if (eveningSetsOrdered.length >= 2 && order.includes(eveningSetsOrdered[0])) {
    insertAfter(order, eveningSetsOrdered[0], "between_1");
    insertAfter(order, "between_1", "sax_1");
  }
  if (eveningSetsOrdered.length >= 3 && order.includes(eveningSetsOrdered[1])) {
    insertAfter(order, eveningSetsOrdered[1], "between_2");
    insertAfter(order, "between_2", "sax_2");
  }
  if (eveningSetsOrdered.length >= 4 && order.includes(eveningSetsOrdered[2])) {
    insertAfter(order, eveningSetsOrdered[2], "between_3");
  }

  const afIdx = order.indexOf("after_final");
  if (afIdx !== -1) order.splice(afIdx, 0, "sax_3");

  return ensureUnique(order);
};

    const initialOrder = React.useMemo(() => enforceRules(base), []); // seed once
    React.useEffect(() => {
      const curr = Array.isArray(answers.schedule_order)
        ? answers.schedule_order
        : [];
      if (!curr.length) {
        handleAnswer("schedule_order", initialOrder);
      } else {
        const merged = enforceRules(curr);
        if (JSON.stringify(merged) !== JSON.stringify(curr)) {
          handleAnswer("schedule_order", merged);
        }
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [JSON.stringify(base), setCount, aftSetCount, hasExtraSet]);

    const order =
      Array.isArray(answers.schedule_order) && answers.schedule_order.length
        ? answers.schedule_order
        : initialOrder;

    // ----- Drag & arrow reorder -----
    const dragIndexRef = React.useRef(null);
 const onDragOver = (idx) => (e) => {
  if (readOnly) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = "move";
};
    const onDrop = (idx) => (e) => {
      if (readOnly) return;
      e.preventDefault();
      const from =
        dragIndexRef.current ?? Number(e.dataTransfer.getData("text/plain"));
      const to = idx;
      if (Number.isFinite(from) && Number.isFinite(to) && from !== to) {
        const next = [...order];
        const [moved] = next.splice(from, 1);
        next.splice(to, 0, moved);
        handleAnswer("schedule_order", enforceRules(next));
      }
      dragIndexRef.current = null;
    };
    const moveBy = (idx, delta) => {
        if (readOnly) return;
      const to = idx + delta;
      if (to < 0 || to >= order.length) return;
      const next = [...order];
      const [moved] = next.splice(idx, 1);
      next.splice(to, 0, moved);
      handleAnswer("schedule_order", enforceRules(next));
    };
const isFixed = (k) => readOnly || k === "finish";

    // Add / remove custom intermissions
    const nextBetweenKey = () => {
      let n = 1;
      while (
        customBetween.includes(`between_extra_${n}`) ||
        order.includes(`between_extra_${n}`)
      )
        n++;
      return `between_extra_${n}`;
    };
    const addIntermission = () => {
      const key = nextBetweenKey();
      const list = [...customBetween, key];
      handleAnswer("schedule_between_custom", list);
      const next = [...order];
      const anchor = next.indexOf("after_final");
      next.splice(anchor === -1 ? next.length - 1 : anchor, 0, key);
      handleAnswer("schedule_order", enforceRules(next));
    };
    const removeRow = (k) => {
      if (!/^between_extra_/.test(k)) return;
      const list = customBetween.filter((x) => x !== k);
      handleAnswer("schedule_between_custom", list);
      const next = order.filter((x) => x !== k);
      handleAnswer("schedule_order", enforceRules(next));
      if (answers[timeKey(k)]) handleAnswer(timeKey(k), "");
      if (answers[notesKey(k)]) handleAnswer(notesKey(k), "");
    };

    // ---- labels ----
    const labelFor = (k) => {
      if (k === "ceremony_setup") return "Ceremony Setup";
      if (k === "ceremony_soundcheck") return "Ceremony Soundcheck";
      if (k === "ceremony") return "Ceremony Performance";
      if (k === "ceremony_lunch") return "Ceremony Team Lunch Break";

      if (k === "afternoon_setup") return "Afternoon Setup";
      if (k === "afternoon_soundcheck") return "Afternoon Soundcheck";
      if (k === "afternoon_lunch") return "Lunch Break";
      if (k.startsWith("afternoon_set_")) {
        const n = Number(k.split("_").pop());
        return aftSetCount <= 1
          ? `Afternoon Set (${aftSetLen}mins)`
          : `${ordinal(n)} Afternoon Set (${aftSetLen}mins)`;
      }
      if (k.startsWith("afternoon_between_")) return "Afternoon Intermission";

      if (k === "arrival") return "Band Arrival";
      if (k === "setup") return "Band Setup";
      if (k === "soundcheck") return "Band Soundcheck";
      if (k === "change") return "Band Change Time";
      if (k === "speeches") return "Speeches (Mic Provided)";
      if (k.startsWith("set_")) {
        const n = Number(k.split("_")[1]);
        return `${ordinal(n)} Live Band Set (${setLength}mins)`;
      }
      if (k === "extra_set") {
        const baseIdx = setCount + 1;
        return `${ordinal(baseIdx)} Live Band Set (${extraMinutes}mins)`;
      }
      if (
        k === "between_1" ||
        k === "between_2" ||
        k === "between_3" ||
        /^between_extra_/.test(k)
      )
        return "Intermission";
      if (/^sax_[1-3]$/.test(k)) {
        const n = Number(k.split("_")[1]);
        return `${ordinal(n)} DJ Live Sax Set`;
      }
      if (k === "finish") return "Finish (from booking)";
      return k;
    };

    // rows that show Select/--/PM placeholders
    const placeholderRows = new Set([
      "setup",
      "soundcheck",
      "change",
      "between_1",
      "between_2",
      "between_3",
      ...aftIntermissionKeys,
      ...customBetween,
    ]);

    const Row = ({
      title,
      k,
      readOnlyValue,
      placeholderOverride,
      rightExtras,
    }) => {
      const idx = order.indexOf(k);
      return (
        <div
          className={`border rounded px-3 py-2 bg-white shadow-sm grid grid-cols-1 md:grid-cols-12 gap-2 items-center ${isFixed(k) ? "opacity-95" : ""}`}
          onDragOver={onDragOver(idx)}
          onDrop={onDrop(idx)}
        >
          {/* left: drag + label + arrows + (optional delete) */}
          <div className="md:col-span-4 flex items-center gap-2 min-w-0">
            <div
              role="button"
              aria-label="Drag to reorder"
              draggable={!isFixed(k) && !readOnly}
className={`select-none text-gray-400 ${(isFixed(k) || readOnly) ? "cursor-not-allowed" : "cursor-grab"}`}
              onDragStart={(e) => {
                if (isFixed(k)) return;
                dragIndexRef.current = idx;
                e.dataTransfer.effectAllowed = "move";
                e.dataTransfer.setData("text/plain", String(idx));
              }}
              title={isFixed(k) ? "Fixed" : "Drag to reorder"}
            >
              ⋮⋮
            </div>
            <div className="text-sm font-medium text-gray-800 truncate">
              {title}
            </div>
            {!isFixed(k) && !readOnly && (
              <div className="ml-auto flex items-center gap-1">
                <button
                  type="button"
                  className="border rounded px-1 text-xs"
                  onClick={() => moveBy(idx, -1)}
                  title="Move up"
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="border rounded px-1 text-xs"
                  onClick={() => moveBy(idx, +1)}
                  title="Move down"
                >
                  ↓
                </button>
                {/^between_extra_/.test(k) && (
                  <button
                    type="button"
                    className="border rounded px-1 text-xs"
                    onClick={() => removeRow(k)}
                    title="Remove this intermission"
                  >
                    ✕
                  </button>
                )}
              </div>
            )}
          </div>

          {/* middle: time */}
          <div className="md:col-span-4">
            <CustomTimePicker
              value={answers[timeKey(k)] || ""}
              minuteStep={5}
              enableDayOffset={k === "finish"}
              dayOffset={
                k === "finish" ? Number(answers[offKey("finish")] || 0) : 0
              }
              onDayOffsetChange={(v) =>
                k === "finish" && handleAnswer(offKey("finish"), v)
              }
              onChange={(newHHMM) => handleAnswer(timeKey(k), newHHMM)}
              {...(placeholderRows.has(k)
                ? {
                    hourPlaceholder: "Select",
                    minutePlaceholder: "--",
                    defaultPeriod: "PM",
                  }
                : {})}
            />
          </div>

          {/* right: notes (and extras if provided) */}
          <div className="md:col-span-4">
            <textarea
              rows={2}
              className="border rounded px-2 py-1 text-sm w-full resize-y text-gray-800"
              placeholder={
                placeholderOverride || "Notes, requests, Spotify/DJ links…"
              }
              value={answers[notesKey(k)] || ""}
              onChange={(e) => handleAnswer(notesKey(k), e.target.value)}
            />
            {rightExtras}
          </div>

          {/* duration bubble */}
          {readOnlyValue && (
            <div className="md:col-span-12 text-xs text-gray-500 pl-6">
              {readOnlyValue}
            </div>
          )}
        </div>
      );
    };

    return (
      <div className="space-y-4">
        {/* Afternoon config */}
        {afternoonInfo && (
          <div>
            <label className="text-sm text-gray-700 mb-1 block">
              Afternoon Performance Set Configuration
            </label>
            <select
              className="border rounded px-2 py-1 text-sm"
              value={answers.schedule_afternoon_set_option || afternoonSetKey}
              onChange={(e) =>
                handleAnswer("schedule_afternoon_set_option", e.target.value)
              }
            >
              {afternoonOptions.map((o) => (
                <option key={o.key} value={o.key}>
                  {o.sets} × {o.length}-minute sets
                </option>
              ))}
            </select>
            <p className="text-xs text-gray-600 mt-1">
              Includes 30 min setup, 30 min soundcheck and a 30 min lunch break
              before performance.
            </p>
          </div>
        )}

        {/* Evening config + add-intermission control */}
        <div className="flex items-center gap-3">
          <div>
            <label className="text-sm text-gray-700 mb-1 block">
              Main Performance Set Configuration
            </label>
            <select
              className="border rounded px-2 py-1 text-sm"
              value={setKey}
              onChange={(e) =>
                handleAnswer("schedule_set_option", e.target.value)
              }
            >
              {options.map((o) => (
                <option key={o.key} value={o.key}>
                  {o.sets} × {o.length}-minute sets (min {o.minInterval}-minute
                  interval)
                </option>
              ))}
            </select>
          </div>

         {!readOnly && ( <button
            type="button"
            className="ml-auto border rounded px-2 py-1 text-sm"
            onClick={addIntermission}
            title="Add an extra intermission bar"
          >
            + Add Intermission
          </button>)}
        </div> 

        {/* The schedule list */}
        <div className="flex flex-col gap-2">
          {order.map((k) => {
            // ceremony
            if (k === "ceremony_setup")
              return (
                <Row
                  key={k}
                  k={k}
                  title="Ceremony Setup"
                  readOnlyValue="30 minutes"
                />
              );
            if (k === "ceremony_soundcheck")
              return (
                <Row
                  key={k}
                  k={k}
                  title="Ceremony Soundcheck"
                  readOnlyValue="30 minutes"
                />
              );
            if (k === "ceremony")
              return (
                <Row
                  key={k}
                  k={k}
                  title="Ceremony Performance"
                  placeholderOverride="Please specify the specific timings you’d like live music performed at."
                />
              );
            if (k === "ceremony_lunch")
              return (
                <Row
                  key={k}
                  k={k}
                  title="Ceremony Team Lunch Break"
                  readOnlyValue="30 minutes"
                />
              );

            // afternoon cluster
            if (k === "afternoon_setup")
              return (
                <Row
                  key={k}
                  k={k}
                  title="Afternoon Setup"
                  readOnlyValue="30 minutes"
                />
              );
            if (k === "afternoon_soundcheck")
              return (
                <Row
                  key={k}
                  k={k}
                  title="Afternoon Soundcheck"
                  readOnlyValue="30 minutes"
                />
              );
            if (k === "afternoon_lunch")
              return (
                <Row
                  key={k}
                  k={k}
                  title="Lunch Break"
                  readOnlyValue="30 minutes"
                />
              );
            if (k.startsWith("afternoon_set_")) {
              const n = Number(k.split("_").pop());
              const title =
                aftSetCount <= 1
                  ? `Afternoon Set`
                  : `${ordinal(n)} Afternoon Set`;
              return (
                <Row
                  key={k}
                  k={k}
                  title={title}
                  readOnlyValue={`${aftSetLen} minutes`}
                />
              );
            }
            if (k.startsWith("afternoon_between_")) {
              return <Row key={k} k={k} title="Afternoon Intermission" />;
            }

            // speeches
            if (k === "speeches")
              return <Row key={k} k={k} title="Speeches (Mic Provided)" />;

            // evening prep
            if (k === "arrival")
              return <Row key={k} k={k} title="Band Arrival" />;
            if (k === "setup")
              return (
                <Row
                  key={k}
                  k={k}
                  title="Band Setup"
                  readOnlyValue={`${setupMins} minutes`}
                />
              );
            if (k === "soundcheck")
              return (
                <Row
                  key={k}
                  k={k}
                  title="Band Soundcheck"
                  readOnlyValue={`${soundcheckMins} minutes`}
                />
              );
            if (k === "change")
              return (
                <Row
                  key={k}
                  k={k}
                  title="Band Change Time"
                  readOnlyValue={`${changeMins} minutes`}
                />
              );

            // evening sets + optional extra
            if (/^set_\d+$/.test(k)) {
              const n = Number(k.split("_")[1]);
              return (
                <Row
                  key={k}
                  k={k}
                  title={`${ordinal(n)} Live Band Set`}
                  readOnlyValue={`${setLength} minutes`}
                />
              );
            }
            if (k === "extra_set") {
              const baseIdx = setCount + 1;
              return (
                <Row
                  key={k}
                  k={k}
                  title={`${ordinal(baseIdx)} Live Band Set`}
                  readOnlyValue={`${extraMinutes} minutes`}
                />
              );
            }

            // evening intermission (SPECIAL — do not change this block)
            if (k === "between_1") {
              const idx = order.indexOf(k);
              return (
                <div
                  key={k}
                  className="border rounded px-3 py-2 bg-white shadow-sm grid grid-cols-1 md:grid-cols-12 gap-2 items-center"
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "move";
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    const from =
                      dragIndexRef.current ??
                      Number(e.dataTransfer.getData("text/plain"));
                    const to = idx;
                    if (
                      Number.isFinite(from) &&
                      Number.isFinite(to) &&
                      from !== to
                    ) {
                      const next = [...order];
                      const [moved] = next.splice(from, 1);
                      next.splice(to, 0, moved);
                      handleAnswer("schedule_order", enforceRules(next));
                    }
                    dragIndexRef.current = null;
                  }}
                >
                  {/* left third: drag + dropdown + arrows */}
                  <div className="md:col-span-4 flex items-center gap-2 min-w-0">
                    <div
                      role="button"
                      aria-label="Drag to reorder"
                      className="select-none text-gray-400 cursor-grab"
                      draggable
                      onDragStart={(e) => {
                        dragIndexRef.current = idx;
                        e.dataTransfer.effectAllowed = "move";
                        e.dataTransfer.setData("text/plain", String(idx));
                      }}
                      title="Drag to reorder"
                    >
                      ⋮⋮
                    </div>
                    <select
                      className="border rounded px-2 py-1 text-sm w-full"
                      value={answers.schedule_after_final || ""}
                      onChange={(e) =>
                        handleAnswer("schedule_after_final", e.target.value)
                      }
                    >
                      {postLiveChoices.map((c) => (
                        <option key={c.value || "none"} value={c.value}>
                          {c.label}
                        </option>
                      ))}
                    </select>
                    <div className="ml-auto flex items-center gap-1">
                      <button
                        type="button"
                        className="border rounded px-1 text-xs"
                        onClick={() => moveBy(idx, -1)}
                        title="Move up"
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        className="border rounded px-1 text-xs"
                        onClick={() => moveBy(idx, +1)}
                        title="Move down"
                      >
                        ↓
                      </button>
                    </div>
                  </div>

                  {/* middle: time */}
                  <div className="md:col-span-4">
                    <CustomTimePicker
                      value={answers[timeKey(k)] || ""}
                      minuteStep={5}
                      enableDayOffset={false}
                      dayOffset={0}
                      onChange={(newHHMM) => handleAnswer(timeKey(k), newHHMM)}
                      hourPlaceholder="Select"
                      minutePlaceholder="--"
                      defaultPeriod="PM"
                    />
                  </div>

                  {/* right: notes */}
                  <div className="md:col-span-4">
                    <textarea
                      rows={2}
                      className="border rounded px-2 py-1 text-sm w-full resize-y text-gray-800"
                      placeholder="Notes, requests, Spotify/DJ links…"
                      value={answers[notesKey(k)] || ""}
                      onChange={(e) =>
                        handleAnswer(notesKey(k), e.target.value)
                      }
                    />
                  </div>
                </div>
              );
            }

            // additional evening intermissions (simple row)
            if (
              k === "between_2" ||
              k === "between_3" ||
              /^between_extra_/.test(k)
            ) {
              const idx = order.indexOf(k);
              return (
                <div
                  key={k}
                  className="border rounded px-3 py-2 bg-white shadow-sm grid grid-cols-1 md:grid-cols-12 gap-2 items-center"
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "move";
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    const from =
                      dragIndexRef.current ??
                      Number(e.dataTransfer.getData("text/plain"));
                    const to = idx;
                    if (
                      Number.isFinite(from) &&
                      Number.isFinite(to) &&
                      from !== to
                    ) {
                      const next = [...order];
                      const [moved] = next.splice(from, 1);
                      next.splice(to, 0, moved);
                      handleAnswer("schedule_order", enforceRules(next));
                    }
                    dragIndexRef.current = null;
                  }}
                >
                  {/* left third: drag + dropdown + arrows */}
                  <div className="md:col-span-4 flex items-center gap-2 min-w-0">
                    <div
                      role="button"
                      aria-label="Drag to reorder"
                      className="select-none text-gray-400 cursor-grab"
                      draggable
                      onDragStart={(e) => {
                        dragIndexRef.current = idx;
                        e.dataTransfer.effectAllowed = "move";
                        e.dataTransfer.setData("text/plain", String(idx));
                      }}
                      title="Drag to reorder"
                    >
                      ⋮⋮
                    </div>
                    <select
                      className="border rounded px-2 py-1 text-sm w-full"
                      value={answers.schedule_after_final || ""}
                      onChange={(e) =>
                        handleAnswer("schedule_after_final", e.target.value)
                      }
                    >
                      {postLiveChoices.map((c) => (
                        <option key={c.value || "none"} value={c.value}>
                          {c.label}
                        </option>
                      ))}
                    </select>
                    <div className="ml-auto flex items-center gap-1">
                      <button
                        type="button"
                        className="border rounded px-1 text-xs"
                        onClick={() => moveBy(idx, -1)}
                        title="Move up"
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        className="border rounded px-1 text-xs"
                        onClick={() => moveBy(idx, +1)}
                        title="Move down"
                      >
                        ↓
                      </button>
                    </div>
                  </div>

                  {/* middle: time */}
                  <div className="md:col-span-4">
                    <CustomTimePicker
                      value={answers[timeKey(k)] || ""}
                      minuteStep={5}
                      enableDayOffset={false}
                      dayOffset={0}
                      onChange={(newHHMM) => handleAnswer(timeKey(k), newHHMM)}
                      hourPlaceholder="Select"
                      minutePlaceholder="--"
                      defaultPeriod="PM"
                    />
                  </div>

                  {/* right: notes */}
                  <div className="md:col-span-4">
                    <textarea
                      rows={2}
                      className="border rounded px-2 py-1 text-sm w-full resize-y text-gray-800"
                      placeholder="Notes, requests, Spotify/DJ links…"
                      value={answers[notesKey(k)] || ""}
                      onChange={(e) =>
                        handleAnswer(notesKey(k), e.target.value)
                      }
                    />
                  </div>
                </div>
              );
            }

            // Sax
            if (/^sax_[1-3]$/.test(k)) {
              const n = Number(k.split("_")[1]);
              return (
                <Row
                  key={k}
                  k={k}
                  title={`${ordinal(n)} DJ Live Sax Set`}
                  readOnlyValue="30 minutes"
                />
              );
            }

            // After final: draggable, 1/3 dropdown + time + notes
            if (k === "after_final") {
              const idx = order.indexOf(k);
              return (
                <div
                  key={k}
                  className="border rounded px-3 py-2 bg-white shadow-sm grid grid-cols-1 md:grid-cols-12 gap-2 items-center"
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "move";
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    const from =
                      dragIndexRef.current ??
                      Number(e.dataTransfer.getData("text/plain"));
                    const to = idx;
                    if (
                      Number.isFinite(from) &&
                      Number.isFinite(to) &&
                      from !== to
                    ) {
                      const next = [...order];
                      const [moved] = next.splice(from, 1);
                      next.splice(to, 0, moved);
                      handleAnswer("schedule_order", enforceRules(next));
                    }
                    dragIndexRef.current = null;
                  }}
                >
                  {/* left third: drag + dropdown + arrows */}
                  <div className="md:col-span-4 flex items-center gap-2 min-w-0">
                    <div
                      role="button"
                      aria-label="Drag to reorder"
                      className="select-none text-gray-400 cursor-grab"
                      draggable
                      onDragStart={(e) => {
                        dragIndexRef.current = idx;
                        e.dataTransfer.effectAllowed = "move";
                        e.dataTransfer.setData("text/plain", String(idx));
                      }}
                      title="Drag to reorder"
                    >
                      ⋮⋮
                    </div>
                    <select
                      className="border rounded px-2 py-1 text-sm w-full"
                      value={answers.schedule_after_final || ""}
                      onChange={(e) =>
                        handleAnswer("schedule_after_final", e.target.value)
                      }
                    >
                      {postLiveChoices.map((c) => (
                        <option key={c.value || "none"} value={c.value}>
                          {c.label}
                        </option>
                      ))}
                    </select>
                    <div className="ml-auto flex items-center gap-1">
                      <button
                        type="button"
                        className="border rounded px-1 text-xs"
                        onClick={() => moveBy(idx, -1)}
                        title="Move up"
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        className="border rounded px-1 text-xs"
                        onClick={() => moveBy(idx, +1)}
                        title="Move down"
                      >
                        ↓
                      </button>
                    </div>
                  </div>

                  {/* middle: time */}
                  <div className="md:col-span-4">
                    <CustomTimePicker
                      value={answers[timeKey(k)] || ""}
                      minuteStep={5}
                      enableDayOffset={false}
                      dayOffset={0}
                      onChange={(newHHMM) => handleAnswer(timeKey(k), newHHMM)}
                      hourPlaceholder="Select"
                      minutePlaceholder="--"
                      defaultPeriod="PM"
                    />
                  </div>

                  {/* right: notes */}
                  <div className="md:col-span-4">
                    <textarea
                      rows={2}
                      className="border rounded px-2 py-1 text-sm w-full resize-y text-gray-800"
                      placeholder="Notes, requests, Spotify/DJ links…"
                      value={answers[notesKey(k)] || ""}
                      onChange={(e) =>
                        handleAnswer(notesKey(k), e.target.value)
                      }
                    />
                  </div>
                </div>
              );
            }

            // finish
            if (k === "finish")
              return <Row key={k} k={k} title="Band Finish" />;

            return null;
          })}
        </div>
      </div>
    );
  }

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
      resolveLineup(acts, _firstItemForPackdown) ||
      _firstItemForPackdown?.lineup ||
      null;
    const packdownTime = Number(_resolvedForPackdown?.packdownTime) || 60;

    // --- Changing/Green room blocker ---
    const crRequiredByLineup = !!lineup?.changingRoom;

    const crAnswerNo =
      String(answers.changing_room || "").toLowerCase() === "no";
    const changingRoomBlocksComplete = crRequiredByLineup && crAnswerNo;

    // derive event type safely (covers multiple shapes)
const eventTypeRaw =
  String(
    answers.event_type ||
      booking?.eventType ||
      booking?.event_type ||
      ""
  ).toLowerCase();

const isWedding  = /wedding/.test(eventTypeRaw);
const isBirthday = /birthday/.test(eventTypeRaw);

// Build the people section based on event type
const peopleSection = isWedding
  ? {
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
          placeholder: "e.g. Mr & Mrs Smith",
        },
      ],
    }
  : isBirthday
  ? {
      id: "birthday_details",
      title: "Birthday Details",
      help:
        "Please confirm who made the booking and the birthday person’s details.",
      fields: [
        { key: "booker_first",   label: "Booker's first name", type: "text" },
        { key: "booker_last",    label: "Booker's last name",  type: "text" },
        { key: "honouree_first", label: "Birthday person's first name", type: "text" },
        { key: "honouree_last",  label: "Birthday person's last name",  type: "text" },
        { key: "honouree_age",   label: "Age (on the day)", type: "number", placeholder: "e.g. 30" },
        {
          key: "introduced_as",
          label: "Any special announcement wording?",
          type: "text",
          placeholder: 'e.g. "Happy 30th, Jamie!"',
        },
      ],
    }
  : {
      id: "booker_details",
      title: "Booker Details",
      help: "Who is our main point of contact for this booking?",
      fields: [
        { key: "booker_first", label: "First name", type: "text" },
        { key: "booker_last",  label: "Last name",  type: "text" },
        { key: "booker_company", label: "Company (optional)", type: "text" },
        {
          key: "introduced_as",
          label: "Announcement wording (optional)",
          type: "text",
          placeholder: "e.g. Awards host to announce...",
        },
      ],
    };


    return [
     peopleSection,
      {
        id: "attire",
        title: "Attire",
        help: "Would you like the band to dress as per their promomotional videos. Or would you prefer them to be dressed differently?",
        fields: [
          {
            key: "attire_notes",
            placeholder: "Preferred look",
            type: "textarea",
          },
        ],
      },
      {
        id: "location",
        title: "Location & Load-in",
        help: (
          <>
            For address we have <strong>{booking?.venueAddress || "—"}</strong>.
            In addition to this please provide:
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
                      onChange={(e) =>
                        handleAnswer("venue_pin", e.target.value)
                      }
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
                      onChange={(e) =>
                        handleAnswer("load_in_pin", e.target.value)
                      }
                    />
                  </div>
                </div>

                {/* Right column: special directions */}
                <div>
                  <label className="text-sm text-gray-700 mb-1 block">
                    Any special instructions in terms of arriving to the venue,
                    or where the band should load in from.
                  </label>
                  <textarea
                    className="border rounded px-2 py-1 text-sm text-gray-800 min-h-[88px] w-full"
                    value={answers.load_in_instructions || ""}
                    onChange={(e) =>
                      handleAnswer("load_in_instructions", e.target.value)
                    }
                  />
                </div>
              </div>
            ),
          },
        ],
      },
      {
        id: "parking",
        title: "Parking",
        help: (
          <>
            Parking is required for all band vehicles. If you need the band’s
            car registrations, tick the box below and we’ll email them to you.
          </>
        ),
        fields: [
          {
            key: "parking_available",
            label: "Is parking available on site for the band?",
            type: "select",
            options: ["Yes", "No"],
          },

          // Everything below is rendered conditionally based on parking_available
          {
            key: "parking_conditional",
            type: "custom",
            render: () => {
              const availability = String(
                answers.parking_available || ""
              ).toLowerCase();
              const isYes = availability === "yes";
              const isNo = availability === "no";

              // Find a sensible default car count from the selected lineup
              const src = Array.isArray(booking?.actsSummary)
                ? booking.actsSummary
                : Array.isArray(booking?.items)
                  ? booking.items
                  : [];
              const firstItem = src[0] || {};
              const lineup =
                resolveLineup(acts, firstItem) || firstItem.lineup || null;

              const costPerCar = Number(answers.parking_cost_per_car ?? 0);
              const numCars = Number(answers.parking_num_cars ?? defaultCars);
              const totalCost =
                Number.isFinite(costPerCar) && Number.isFinite(numCars)
                  ? Math.max(0, Math.round(costPerCar * numCars * 100) / 100)
                  : 0;

              const paid =
                String(answers.parking_payment_status || "").toLowerCase() ===
                "paid";

              // --- put near the top of render() after you compute `lineup` ---
              const normalizePlate = (s = "") =>
                String(s).replace(/\s+/g, "").toUpperCase();

              const regRows = Array.isArray(lineup?.bandMembers)
                ? lineup.bandMembers
                    .map((m) => {
                      // Prefer the actual plate value if present, else whatever is in carRegistration
                      const raw =
                        (m.carRegistrationValue &&
                          m.carRegistrationValue.trim()) ||
                        (m.carRegistration && m.carRegistration.trim()) ||
                        "";

                      const plate = normalizePlate(raw);
                      if (!plate) return null;

                      const name =
                        [m.firstName, m.lastName]
                          .filter(Boolean)
                          .join(" ")
                          .trim() || "Band member";

                      return {
                        name,
                        instrument: m.instrument || "",
                        plate,
                      };
                    })
                    .filter(Boolean)
                : [];

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
                            onChange={(e) =>
                              handleAnswer("parking_pin", e.target.value)
                            }
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
                            onChange={(e) =>
                              handleAnswer("parking_notes", e.target.value)
                            }
                          />
                        </div>
                      </div>
                      <div className="gap-3 mt-3">
                        <label className="text-sm text-gray-700 mb-2 flex items-center gap-2">
                          <input
                            type="checkbox"
                            className="accent-[#ff6667]"
                            checked={!!answers.need_registrations}
                            onChange={(e) =>
                              handleAnswer(
                                "need_registrations",
                                e.target.checked
                              )
                            }
                          />
                          Does your venue require the band's vehicle
                          registration numbers?
                        </label>

                        {answers.need_registrations && (
                          <div className="mt-2 rounded border bg-gray-50 p-3">
                            <div className="text-sm font-semibold mb-2">
                              Band vehicle registrations
                            </div>

                            {regRows.length > 0 ? (
                              <ul className="text-sm text-gray-800 space-y-1">
                                {regRows.map((r, i) => (
                                  <li
                                    key={`${r.plate}-${i}`}
                                    className="flex justify-between gap-3"
                                  >
                                    <span className="truncate">
                                      {r.name}
                                      {r.instrument ? ` — ${r.instrument}` : ""}
                                    </span>
                                    <span className="font-mono">
                                      {r.plate === "NO_CAR"
                                        ? "No vehicle"
                                        : r.plate}
                                    </span>
                                  </li>
                                ))}
                              </ul>
                            ) : (
                              <div className="text-sm text-gray-600">
                                We don’t have registration plates on file for
                                this lineup yet. We’ll email them to you
                                shortly.
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
                        <strong>30 minutes prior to band arrival</strong> and
                        the finish time to{" "}
                        <strong>
                          1 hour after the band’s contracted finish
                        </strong>
                        . Then complete the details below.
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
                            onChange={(e) =>
                              handleAnswer(
                                "parking_cost_per_car",
                                e.target.value
                              )
                            }
                          />
                        </div>

                        <div className="flex flex-col">
                          <label className="text-sm text-gray-700 mb-1">
                            Number of cars
                          </label>
                          <input
                            type="number"
                            className="border rounded px-2 py-1 text-sm text-gray-800 bg-gray-50"
                            value={defaultCars || 0}
                            readOnly
                            disabled
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
                          Upload a screenshot of the parking options as
                          displayed on Parkopedia (or similar):
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
                            alt={
                              answers.parking_screenshot_name ||
                              "Parking screenshot"
                            }
                            className="mt-2 max-h-40 rounded border object-contain"
                            style={{ maxWidth: "100%", height: "auto" }}
                          />
                        )}
                      </div>

                      {/* Parking payment (Stripe Checkout) */}
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-start">
                        <div className="md:col-span-2 flex flex-col">
                          <label className="text-sm text-gray-700 mb-1">
                            Parking payment
                          </label>

                          {/* compute the amount based on your existing values */}
                          {(() => {
                            const costPerCar = Number(
                              answers.parking_cost_per_car ?? 0
                            );
                            const numCars = Number(defaultCars || 0); // <- lock to computed cars
                            const total = Math.max(
                              0,
                              Math.round(costPerCar * numCars * 100) / 100
                            );
                            const totalPence = Math.round(total * 100);

                            return (
                              <div className="flex flex-wrap items-center gap-3">
                                <button
                                  type="button"
                                  onClick={() =>
                                    handleGenerateParkingInvoice({
                                      amountPence: totalPence,
                                    })
                                  }
                                  className="px-3 py-1.5 rounded bg-[#ff6667] text-white hover:opacity-90"
                                  disabled={!totalPence}
                                  title={
                                    !totalPence
                                      ? "Enter cost per car and number of cars first"
                                      : "Open Stripe Checkout"
                                  }
                                >
                                  Generate invoice
                                </button>

                                <div className="text-sm text-gray-700">
                                  Amount:&nbsp;
                                  <strong>£{total.toFixed(2)}</strong>
                                  &nbsp;for {numCars} car
                                  {numCars === 1 ? "" : "s"}
                                </div>
                              </div>
                            );
                          })()}
                        </div>

                        {/* Status display (optional) */}
                        <div className="flex flex-col">
                          <label className="text-sm text-gray-700 mb-1">
                            Status
                          </label>
                          <div className="text-sm flex items-center gap-1">
                            {(() => {
                              const raw = answers?.parking_checkout_status;
                              const label =
                                typeof raw === "string" ? raw.trim() : "";
                              const isPaid = /paid/i.test(label);
                              if (isPaid) {
                                return (
                                  <>
                                    Paid
                                    <img
                                      src={assets.tick}
                                      alt="paid"
                                      className="inline w-4 h-4 ml-0.5"
                                    />
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
          {
            key: "guest_count",
            label: "Expected number of guests",
            type: "number",
          },
          {
            key: "outdoor_performance",
            label: "Is the act performing outdoors?",
            type: "select",
            options: ["No", "Yes"],
          },
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
                      onChange={(e) =>
                        handleAnswer("outdoor_ack", e.target.checked)
                      }
                    />
                    <span>
                      I understand that overhead cover must be supplied for
                      musicians and their equipment, and a dry, flat, and level
                      surface must be provided for the musicians to perform
                      from.
                    </span>
                  </label>
                );
              }
              return null;
            },
          },
          {
            key: "performance_area",
            label: "Where should the band set up in the space described above?",
            type: "textarea",
            placeholder:
              "E.g. corner of room, stage, in front of fireplace etc",
          },
        ],
      },
      {
        id: "pa_lights",
        title: "PA & Lighting",
        help: [
          equipmentHelp,
          "However some venues require the band to use their own system. Please let us know what to expect on the day.",
        ]
          .filter(Boolean)
          .join(" "),
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
                      Is there an in-house PA system that the band is required
                      to use?
                    </label>
                    <select
                      className="border rounded px-2 py-1 text-sm text-gray-800"
                      value={answers.use_inhouse_pa || ""}
                      onChange={(e) =>
                        handleAnswer("use_inhouse_pa", e.target.value)
                      }
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
                        onChange={(e) =>
                          handleAnswer("pa_engineer_present", e.target.value)
                        }
                      >
                        <option value="">Select…</option>
                        <option value="No">No</option>
                        <option value="Yes">Yes</option>
                      </select>
                    </div>
                  )}

                  {answers.use_inhouse_pa === "Yes" &&
                    answers.pa_engineer_present === "No" && (
                      <div className="flex flex-col">
                        <label className="text-sm text-gray-700 mb-1">
                          Please provide the make, model and specs of the PA
                          system
                        </label>
                        <textarea
                          className="border rounded px-2 py-1 text-sm text-gray-800 min-h-[88px]"
                          value={answers.pa_inhouse_specs || ""}
                          onChange={(e) =>
                            handleAnswer("pa_inhouse_specs", e.target.value)
                          }
                        />
                      </div>
                    )}
                </div>

                {/* Lighting column */}
                <div className="flex flex-col gap-3">
                  <div className="flex flex-col">
                    <label className="text-sm text-gray-700 mb-1">
                      Is there an in-house lighting system that the band is
                      required to use?
                    </label>
                    <select
                      className="border rounded px-2 py-1 text-sm text-gray-800"
                      value={answers.use_inhouse_lights || ""}
                      onChange={(e) =>
                        handleAnswer("use_inhouse_lights", e.target.value)
                      }
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
                        onChange={(e) =>
                          handleAnswer(
                            "lights_engineer_present",
                            e.target.value
                          )
                        }
                      >
                        <option value="">Select…</option>
                        <option value="No">No</option>
                        <option value="Yes">Yes</option>
                      </select>
                    </div>
                  )}

                  {answers.use_inhouse_lights === "Yes" &&
                    answers.lights_engineer_present === "No" && (
                      <div className="flex flex-col">
                        <label className="text-sm text-gray-700 mb-1">
                          Please provide the make, model and specs of the
                          lighting system
                        </label>
                        <textarea
                          className="border rounded px-2 py-1 text-sm text-gray-800 min-h-[88px]"
                          value={answers.lights_inhouse_specs || ""}
                          onChange={(e) =>
                            handleAnswer("lights_inhouse_specs", e.target.value)
                          }
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
        help: (
          <>
            If there is a limiter, please confirm the dB cap with the venue and
            share any paperwork.
          </>
        ),
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
                String(answers.sound_limits_present || "").toLowerCase() ===
                "yes";
              if (!hasLimits) return null;

              const isTrafficLight =
                String(
                  answers.sound_limits_is_traffic_light || ""
                ).toLowerCase() === "yes";

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
                        handleAnswer(
                          "sound_limits_is_traffic_light",
                          e.target.value
                        )
                      }
                    >
                      <option value="">Select…</option>
                      <option value="Yes">Yes</option>
                      <option value="No">No</option>
                    </select>
                  </div>

                  {/* dB limit */}
                  <div className="flex flex-col">
                    <label className="text-sm text-gray-700 mb-1">
                      What is the dB limit?
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. 92 dB"
                      className="border rounded px-2 py-1 text-sm text-gray-800 w-full md:w-64"
                      value={answers.sound_limits_db_cap || ""}
                      onChange={(e) =>
                        handleAnswer("sound_limits_db_cap", e.target.value)
                      }
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
                      onChange={(e) =>
                        handleAnswer("sound_limits_notes", e.target.value)
                      }
                    />
                  </div>

                  {/* Venue documentation upload */}
                  <div className="flex flex-col">
                    <label className="text-sm text-gray-700 mb-1">
                      Please attach any venue documentation on the sound
                      limitations
                    </label>

                    {/* Venue documentation upload */}
                    <input
                      type="file"
                      accept=".pdf,.doc,.docx,.jpg,.jpeg,.png"
                      className="text-sm"
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;

                        try {
                          const fd = new FormData();
                          fd.append("file", file);
                          const res = await axios.post(
                            `${backendUrl}/api/upload/doc`,
                            fd,
                            {
                              headers: {
                                "Content-Type": "multipart/form-data",
                              },
                            }
                          );

                          const url = res?.data?.url;
                          if (!url) throw new Error("No URL returned");

                          // Save lightweight metadata + the hosted URL (not a blob)
                          handleAnswer("sound_limits_doc_name", file.name);
                          handleAnswer("sound_limits_doc_url", url);
                          handleAnswer("sound_limits_doc_size", file.size);
                          handleAnswer("sound_limits_doc_type", file.type);
                        } catch (err) {
                          console.error("Upload failed", err);
                          alert("Upload failed — please try again.");
                        }
                      }}
                    />

                    {/* Checkbox for doc signing */}
                    <input
                      type="checkbox"
                      className="accent-[#ff6667]"
                      checked={!!answers.sound_limits_doc_needs_signing}
                      onChange={async (e) => {
                        const checked = e.target.checked;
                        handleAnswer("sound_limits_doc_needs_signing", checked);
                        if (!checked || !booking) return;

                        const body = {
                          _id: booking._id || null,
                          bookingId: booking.bookingId || null,
                          to: "hello@thesupremecollective.co.uk",
                          subject: `Doc signing requested – ${booking.bookingId || booking._id}`,
                          docName: answers.sound_limits_doc_name,
                          docUrl: answers.sound_limits_doc_url, // should now be HTTPS (from /api/upload/doc)
                          venueEmail: (
                            answers.sound_limits_doc_venue_email || ""
                          ).trim(),
                        };

                        try {
                          await axios.post(
                            `${backendUrl}/api/notifications/doc-signing-request`,
                            body
                          );
                          alert(
                            "We’ve emailed the team (and your venue if provided) to arrange signatures. ✅"
                          );
                          handleAnswer(
                            "sound_limits_doc_needs_signing_request_at",
                            new Date().toISOString()
                          );
                        } catch (err) {
                          console.warn("Doc notify failed", err);
                          alert(
                            "Couldn’t auto-notify just now. We’ve flagged this in your sheet."
                          );
                          handleAnswer(
                            "sound_limits_doc_needs_signing_request_at",
                            new Date().toISOString()
                          );
                        }
                      }}
                    />
                    <p className="text-xs text-gray-600 mt-1">
                      Checking this will email{" "}
                      <strong>hello@thesupremecollective.co.uk</strong> with
                      your document so The Supreme Collective can arrange
                      signatures from {tscName}. We'll send you a signed copy
                      back to you once complete. If you'd like us to send it to
                      your venue as well, please pop their email address below.
                    </p>

                    <div className="mt-2">
                      <label className="text-sm text-gray-700 mb-1 block">
                        Venue email (optional)
                      </label>
                      <input
                        type="email"
                        className="border rounded px-2 py-1 text-sm w-full md:w-96"
                        placeholder="events@venue.co.uk"
                        value={answers.sound_limits_doc_venue_email || ""}
                        onChange={(e) =>
                          handleAnswer(
                            "sound_limits_doc_venue_email",
                            e.target.value
                          )
                        }
                      />
                    </div>
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
            The band needs <strong>{packdownTime}</strong> minutes to pack down
            everything and leave the site from the moment the music is turned
            off. Is there a hard venue close time <em>for the band</em> to pack
            down and offload by? For example, are there any gates that shut at
            12:30am, or does the venue require the band to be off-site by
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
                const next = [
                  ...(personal.length
                    ? personal
                    : [{ name: "", phone: "", role: "" }]),
                ];
                if (!next[idx]) next[idx] = { name: "", phone: "", role: "" };
                next[idx] = { ...next[idx], [key]: value };
                handleAnswer("contacts_personal", next);
              };

              const addPersonal = () => {
                const next = [...personal, { name: "", phone: "", role: "" }];
                handleAnswer("contacts_personal", next);
              };

              const updateVenue = (idx, key, value) => {
                const next = [
                  ...(venue.length
                    ? venue
                    : [{ name: "", phone: "", role: "" }]),
                ];
                if (!next[idx]) next[idx] = { name: "", phone: "", role: "" };
                next[idx] = { ...next[idx], [key]: value };
                handleAnswer("contacts_venue", next);
              };

              const addVenue = () => {
                const next = [...venue, { name: "", phone: "", role: "" }];
                handleAnswer("contacts_venue", next);
              };

              const renderContactRows = (rows, onUpdate, prefix) => {
                const safeRows = rows.length
                  ? rows
                  : [{ name: "", phone: "", role: "" }];
                return (
                  <div className="flex flex-col gap-3">
                    {safeRows.map((row, i) => (
                      <div
                        key={`${prefix}-${i}`}
                        className="grid grid-cols-1 sm:grid-cols-3 gap-2"
                      >
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
                          placeholder="Role"
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
              const cr = booking?.contactRouting || {}; // backend routing source

              const emergencyNumber = ec.number || cr.proxyNumber || ""; // E.164 (+44...)
              const ivrCode = ec.ivrCode || cr.ivrCode || ""; // 5–6 digits
              const noteText =
                ec.note ||
                "This number rings the band on the day. Enter the event code when prompted. It’s typically active from 5pm the day before and on the event day.";
              const activeSummary =
                ec.activeWindowSummary ||
                (cr.activeFrom && cr.activeUntil
                  ? `${new Date(cr.activeFrom).toLocaleString("en-GB", { weekday: "short", hour: "2-digit", minute: "2-digit" })} → ${new Date(cr.activeUntil).toLocaleString("en-GB", { weekday: "short", hour: "2-digit", minute: "2-digit" })}`
                  : "");

              const copyToClipboard = (text) => {
                try {
                  navigator?.clipboard?.writeText?.(String(text));
                } catch {}
              };

              return (
                <div className="space-y-6">
                  {/* Top: two columns (personal | venue) */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* Personal point of contact column */}
                    <div>
                      <div className="text-sm font-medium text-gray-800 mb-2">
                        Personal point of contact
                      </div>
                      {renderContactRows(
                        personal,
                        updatePersonal,
                        "poc-personal"
                      )}
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
                      <div className="text-sm font-medium text-gray-800 mb-2">
                        Venue point of contact
                      </div>
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
                    <div className="text-sm font-medium text-gray-800">
                      Band emergency line
                    </div>
                    <p className="text-xs text-gray-600 -mt-1 mb-2">
                      {noteText}
                    </p>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
                      <div className="md:col-span-2">
                        <label className="text-sm text-gray-700">
                          Emergency phone number
                        </label>
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
                        <label className="text-sm text-gray-700">
                          Event code
                        </label>
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
                        No emergency number/code set on this booking yet. An
                        admin can add it by populating
                        <code className="mx-1">
                          booking.contactRouting
                        </code>{" "}
                        (proxyNumber, ivrCode, activeFrom/Until, targets).
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
        id: "changing_room",
        title: "Changing Room & Green Room",
        blockComplete: changingRoomBlocksComplete,
        blockReason:
          "This lineup requires a secure changing/green room. Please arrange one and set the dropdown above to Yes before you can mark this section complete.",
        fields: [
          {
            key: "changing_room",
            label:
              "Is there a secure changing/green room available exclusively for the band?",
            type: "select",
            options: ["Yes", "No"],
          },
          {
            key: "changing_room_hint",
            type: "custom",
            render: () => (
              <p className="text-sm text-gray-700">
                Please note: toilets (including accessible/disabled toilets) are
                not a suitable changing or green room space.
              </p>
            ),
          },
          {
            key: "changing_room_notes",
            label: "Please provide any details",
            type: "textarea",
            placeholder:
              "E.g. location, access, security, keyholder, how to collect the key, etc.",
          },
        ].filter(Boolean),
      },
      {
        id: "food_refreshments",
        title: "Food & Refreshments",
        help: "Please outline the food arrangements and find the dietary requirements of the act below.",
        fields: [
          {
            key: "dietary_table",
            type: "custom",
            render: () => {
              const rows = extractDietaryRequirements(acts, booking);
              const hotMeals = getHotMealRequirement(acts, booking);
              const hasMenuAny =
                !!answers.dietary_menu_url ||
                !!answers.dietary_menu_text ||
                !!answers.dietary_menu_file;

              return (
                <div className="space-y-6">
                  {/* Hot meal requirement banner */}
                  {hotMeals.required ? (
                    <div className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded px-3 py-2">
                      This lineup requires <strong>{hotMeals.count}</strong> hot
                      meal
                      {hotMeals.count === 1 ? "" : "s"} and refreshments for the
                      performers.
                    </div>
                  ) : (
                    <div className="text-sm text-gray-700 bg-gray-50 border border-gray-200 rounded px-3 py-2">
                      This lineup does <strong>not</strong> require hot meals as
                      part of the booking, however if food is available for{" "}
                      {tscName} please kindly provide any relevant details
                      below.
                    </div>
                  )}
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
                            <td className="py-1 pr-2 text-gray-600">
                              {r.instrument}
                            </td>
                            <td className="py-1">{r.diet || DIET_FALLBACK}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <div className="text-sm text-gray-600">
                      We’re gathering dietary requirements, please check back
                      later.
                    </div>
                  )}

                  {/* Caterer email */}
                  <div>
                    <label className="text-sm text-gray-700 mb-1 block">
                      Caterer’s email (to receive dietary requirements & service
                      notes)
                    </label>
                    <input
                      type="email"
                      className="border rounded px-2 py-1 text-sm text-gray-800 w-full md:w-96"
                      placeholder="catering@venue.co.uk"
                      value={answers.caterer_email || ""}
                      onChange={(e) =>
                        handleAnswer("caterer_email", e.target.value)
                      }
                    />
                    <p className="text-xs text-gray-500 mt-1">
                      We’ll include a note that the band may need to be
                      fast-tracked during a short performance break and, if food
                      is initially served while performing, to keep plates
                      aside.
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
                      onChange={(e) =>
                        handleAnswer("dietary_notes", e.target.value)
                      }
                      placeholder="E.g., meals served in staff room at 20:15; water/soft drinks available at the bar."
                    />
                  </div>

                  {/* Hosted menu link */}
                  <div>
                    <label className="text-sm text-gray-700 mb-1 block">
                      If you need the band to pre-order please kindly provide a
                      menu link, copy and paste the menu or upload a file below.
                    </label>
                    <label className="text-sm text-gray-700 mb-1 block">
                      Menu link (optional)
                    </label>
                    <input
                      type="url"
                      className="border rounded px-2 py-1 text-sm text-gray-800 w-full"
                      placeholder="https://… (Google Drive, Dropbox, venue PDF)"
                      value={answers.dietary_menu_url || ""}
                      onChange={(e) =>
                        handleAnswer("dietary_menu_url", e.target.value)
                      }
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
                      onChange={(e) =>
                        handleAnswer("dietary_menu_text", e.target.value)
                      }
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

                  {/* Notify: split actions */}
                  <div className="pt-2 space-y-2">
                    {(() => {
                      const dietaryRows = extractDietaryRequirements(
                        acts,
                        booking
                      );
                      const hasCaterer = !!(answers.caterer_email || "").trim();

                      // Reuse the hints you already show in the copy
                      const fastTrackHint =
                        String(
                          answers.meal_fasttrack_ok || ""
                        ).toLowerCase() === "yes"
                          ? "The band may need to be fast-tracked during a short performance break."
                          : "The band may need to be fast-tracked during a short performance break.";
                      const plateAsideHint =
                        "If food is initially served while the band is performing, please keep plates aside for them.";

                      const serviceNotes = `${fastTrackHint} ${plateAsideHint}`;

                      // Button 1: send menu to band (cc caterer)
                      const sendMenuToBand = async () => {
                        try {
                          setNotifying(true);
                          await axios.post(
                            `${backendUrl}/api/notifications/menu-to-band`,
                            {
                              bookingId: booking?.bookingId || booking?._id,
                              catererEmail: (
                                answers.caterer_email || ""
                              ).trim(),
                              menu: {
                                url: answers.dietary_menu_url || "",
                                text: answers.dietary_menu_text || "",
                                fileUrl: answers.dietary_menu_file || "",
                                notes: answers.dietary_notes || "",
                              },
                              dietarySummary: dietaryRows, // helpful context for the band
                            }
                          );
                          alert(
                            "Menu sent to the band (caterer cc’d if provided) ✅"
                          );
                        } catch (e) {
                          console.error("menu-to-band failed:", e);
                          alert("Sorry—couldn’t send the menu just now.");
                        } finally {
                          setNotifying(false);
                        }
                      };

                      // Button 2: send dietary reqs to caterer
                      const sendDietaryToCaterer = async () => {
                        try {
                          setNotifying(true);
                          await axios.post(
                            `${backendUrl}/api/notifications/dietary-to-caterer`,
                            {
                              bookingId: booking?.bookingId || booking?._id,
                              catererEmail: (
                                answers.caterer_email || ""
                              ).trim(),
                              dietarySummary: dietaryRows,
                              serviceNotes,
                              notes: answers.dietary_notes || "",
                              menu: {
                                url: answers.dietary_menu_url || "",
                                text: answers.dietary_menu_text || "",
                                fileUrl: answers.dietary_menu_file || "",
                              },
                            }
                          );
                          alert("Dietary requirements sent to the caterer ✅");
                        } catch (e) {
                          console.error("dietary-to-caterer failed:", e);
                          alert("Sorry—couldn’t email the caterer just now.");
                        } finally {
                          setNotifying(false);
                        }
                      };

                      const canSendMenuToBand = hasMenuAny && !notifying;
                      const canSendDietaryToCaterer =
                        hasCaterer && dietaryRows.length > 0 && !notifying;

                      return (
                        <>
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              className={`px-3 py-1.5 text-sm rounded ${
                                canSendMenuToBand
                                  ? "bg-emerald-600 text-white hover:bg-emerald-700"
                                  : "bg-gray-300 text-gray-600 cursor-not-allowed"
                              }`}
                              disabled={!canSendMenuToBand}
                              title={
                                hasMenuAny
                                  ? "Send menu to band (cc caterer if provided)"
                                  : "Add a menu link, paste text, or upload a file first"
                              }
                              onClick={sendMenuToBand}
                            >
                              {notifying
                                ? "Sending…"
                                : "Send menu to band (cc caterer)"}
                            </button>

                            <button
                              type="button"
                              className={`px-3 py-1.5 text-sm rounded ${
                                canSendDietaryToCaterer
                                  ? "bg-indigo-600 text-white hover:bg-indigo-700"
                                  : "bg-gray-300 text-gray-600 cursor-not-allowed"
                              }`}
                              disabled={!canSendDietaryToCaterer}
                              title={
                                hasCaterer
                                  ? dietaryRows.length
                                    ? "Send dietary to caterer"
                                    : "Waiting on lineup for dietary details"
                                  : "Enter a caterer email first"
                              }
                              onClick={sendDietaryToCaterer}
                            >
                              {notifying
                                ? "Sending…"
                                : "Send dietary to caterer"}
                            </button>
                          </div>

                          <p className="text-xs text-gray-600">
                            We’ll include dietary requirements and service notes
                            for the caterer (and menu if provided).
                          </p>
                        </>
                      );
                    })()}
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
        help: "Arrival & finish are taken from your booking. Choose a set configuration and what you’d like between sets. Drag to reorder.",
        fields: [
          {
            key: "schedule_custom",
            type: "custom",
            render: () => (
              <ScheduleEditor
                booking={booking}
                acts={acts}
                answers={answers}
                handleAnswer={handleAnswer}
              />
            ),
          },
        ],
      },
    {
  id: "first_dance",
  title: isWedding
    ? "First Dance & Song List"
    : "Off-Repertoire Request & Song List",
  fields: [
    {
      key: "first_dance_song",
      label: isWedding
        ? "First dance song"
        : "Off-repertoire request (song & artist)",
      type: "text",
    },
    {
      key: "first_dance_performed_by",
      label: isWedding
        ? "Band to perform or original on MP3?"
        : "Play live or use original MP3?",
      type: "select",
      options: ["Band", "MP3"],
    },
    {
      key: "song_suggestions",
      type: "custom",
      render: () => {
        // Derive a link to the first act's profile
        const first =
          (Array.isArray(booking?.actsSummary) && booking.actsSummary[0]) ||
          null;
        const profileUrl =
          (first?.actSlug && `/act/${first.actSlug}`) ||
          (first?.actId && `/act/${first.actId}`) ||
          null;

        return (
          <div>
            <label className="text-sm text-gray-700 mb-1 block">
              Song suggestions
            </label>

            <p className="text-sm text-gray-600 mb-2">
              The band typically performs <strong>around 28–32 songs</strong> across a
              2-hour evening set. Feel free to list as few or as many favourites
              as you like from the{" "}
              {profileUrl ? (
                <a
                  href={profileUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[#ff6667] underline hover:opacity-80"
                >
                  band’s repertoire
                </a>
              ) : (
                <>band’s repertoire</>
              )}
              . The final setlist is curated by the band so the night flows —
              they’ll accommodate as many requests as possible and may make
              on-the-night tweaks to keep the dancefloor buzzing.
            </p>

            <textarea
              className="border rounded px-2 py-1 text-sm text-gray-800 w-full min-h-[100px]"
              placeholder="One per line"
              value={answers.song_suggestions || ""}
              onChange={(e) => handleAnswer("song_suggestions", e.target.value)}
            />
          </div>
        );
      },
    },
  ],
},
      {
        id: "socials",
        title: "Socials (optional)",
        fields: [
          {
            key: "social_handles",
            type: "custom",
            render: () => {
              // Ensure answers.social_handles is an array of objects { handle, role }
              const value = Array.isArray(answers.social_handles)
                ? answers.social_handles
                : typeof answers.social_handles === "string" &&
                    answers.social_handles.trim()
                  ? [{ handle: answers.social_handles.trim(), role: "" }]
                  : [];
              const handles =
                value.length > 0 ? value : [{ handle: "", role: "" }];

              // Add another row
              const addRow = () => {
                const next = [...handles, { handle: "", role: "" }];
                handleAnswer("social_handles", next);
              };

              // Update row
              const updateRow = (idx, field, val) => {
                const next = handles.map((row, i) =>
                  i === idx ? { ...row, [field]: val } : row
                );
                handleAnswer("social_handles", next);
              };

              // Remove row
              const removeRow = (idx) => {
                const next = handles.filter((_, i) => i !== idx);
                handleAnswer(
                  "social_handles",
                  next.length ? next : [{ handle: "", role: "" }]
                );
              };

              return (
                <div>
                  <label className="text-sm text-gray-700 mb-1 block">
                    We love to stay connected! Feel free to provide your handles
                    &amp; roles for your big day!
                  </label>
                  <div className="flex flex-col gap-2">
                    {handles.map((entry, idx) => (
                      <div key={idx} className="flex gap-2 items-center">
                        <input
                          type="text"
                          className="border rounded px-2 py-1 text-sm text-gray-800 flex-1"
                          placeholder="Handle or hashtag"
                          value={entry.handle || ""}
                          onChange={(e) =>
                            updateRow(idx, "handle", e.target.value)
                          }
                        />
                        <input
                          type="text"
                          className="border rounded px-2 py-1 text-sm text-gray-800 flex-1"
                          placeholder="Role (e.g. Florist, Groom)"
                          value={entry.role || ""}
                          onChange={(e) =>
                            updateRow(idx, "role", e.target.value)
                          }
                        />
                        {handles.length > 1 && (
                          <button
                            type="button"
                            className="px-2 py-1 text-xs rounded border bg-white hover:bg-gray-50"
                            onClick={() => removeRow(idx)}
                            aria-label="Remove"
                          >
                            ×
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                  <button
                    type="button"
                    className="mt-2 px-3 py-1.5 text-sm rounded bg-gray-100 hover:bg-gray-200 border"
                    onClick={addRow}
                  >
                    Add another
                  </button>
                  <p className="text-xs text-gray-500 mt-1">
                    Add each social handle and (optionally) the role (e.g.
                    “Florist”, “Groom”, “Venue”).
                  </p>
                </div>
              );
            },
          },
        ],
      },

      {
        id: "notes",
        title: "Notes",
        fields: [
          {
            key: "free_notes",
            label: `Anything else useful for ${tscName} to know?`,
            type: "textarea",
          },
        ],
      },
    ];
  }, [answers, booking, acts]);

  const totalSections = sections.length;
  const completedCount = useMemo(
    () => Object.values(complete).filter(Boolean).length,
    [complete]
  );

  const toggleComplete = (sectionId, val) => {
    setComplete((prev) => {
      const next = { ...prev, [sectionId]: val };
      // persist alongside current answers
      saveEventSheet(answers, next);
      return next;
    });
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
      localStorage.setItem(
        lsKey(payload.bookingId || "unknown"),
        JSON.stringify(payload.eventSheet)
      );
    } catch (e) {
      console.warn("Local save failed:", e?.message);
    }

    if (!payload._id) {
      console.warn(
        "Skipping autosave: missing Mongo _id (server requires ObjectId)",
        { bookingRef }
      );
      return;
    }

    try {
      setSaving(true);
      await axios.post(`${backendUrl}/api/booking/update-event-sheet`, payload);
    } catch (e) {
      console.warn(
        "Event sheet saved locally (backend route not available yet).",
        e?.message
      );
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
  const cur = currencySymbol(
    booking?.totals?.currency || booking?.cartMeta?.currency || "GBP"
  );

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

        {!booking?.actsSummary || booking.actsSummary.length === 0 ? (
          <div className="text-gray-600">—</div>
        ) : (
          <div className="space-y-4">
            {booking.actsSummary.map((it, i) => (
              <div key={i} className="flex gap-3 items-start">
                {it.image?.url ? (
                  <img
                    src={it.image.url}
                    alt={it.actName}
                    className="w-20 h-20 object-cover rounded"
                    onError={(e) => (e.currentTarget.style.display = "none")}
                  />
                ) : null}

                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-2 flex-wrap">
                    <span className="font-semibold text-gray-900">
                      {it.actName}
                    </span>
                    {it.lineupLabel && (
                      <span className="text-sm text-gray-600">
                        — {it.lineupLabel}
                      </span>
                    )}
                  </div>

                  {/* Quantity */}
                  {Number(it.quantity) > 1 && (
                    <p className="text-sm text-gray-700 mt-1">
                      Quantity: {Number(it.quantity)}
                    </p>
                  )}

                  {/* Performance times */}
                  {it.performance && (
                    <div className="mt-1 text-sm text-gray-700">
                      {it.performance.arrivalTime && (
                        <p>Arrival: {it.performance.arrivalTime}</p>
                      )}
                      {it.performance.setupAndSoundcheckedBy && (
                        <p>
                          Soundcheck by: {it.performance.setupAndSoundcheckedBy}
                        </p>
                      )}
                      {it.performance.startTime && (
                        <p>Start: {it.performance.startTime}</p>
                      )}
                      {it.performance.finishTime && (
                        <p>
                          Finish: {it.performance.finishTime}
                          {it.performance.finishDayOffset
                            ? ` (+${it.performance.finishDayOffset}d)`
                            : ""}
                        </p>
                      )}
                    </div>
                  )}

                  {/* Afternoon sets */}
                  {Array.isArray(it.afternoonSets) &&
                    it.afternoonSets.length > 0 && (
                      <div className="mt-1">
                        <div className="text-xs text-gray-600">
                          Afternoon Sets:
                        </div>
                        <ul className="text-sm text-gray-700 list-disc ml-5">
                          {it.afternoonSets.map((set, idx) => (
                            <li key={idx}>
                              {set.name || set.label || "Set"}{" "}
                              {Number(set.price)
                                ? `(${booking?.totals?.currency || "£"}${Number(
                                    set.price
                                  ).toFixed(2)})`
                                : ""}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                  {/* Extras */}
                  {Array.isArray(it.selectedExtras) &&
                    it.selectedExtras.length > 0 && (
                      <div className="mt-1">
                        <div className="text-xs text-gray-600">Extras:</div>
                        <ul className="text-sm text-gray-700 list-disc ml-5">
                          {it.selectedExtras.map((ex, idx) => (
                            <li
                              key={idx}
                              className="flex justify-between gap-3"
                            >
                              <span>
                                {ex.name || ex.key}
                                {ex.quantity && Number(ex.quantity) > 1
                                  ? ` × ${ex.quantity}`
                                  : ""}
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
                  {"£"}
                  {Number(booking?.totals?.fullAmount || 0).toFixed(2)}
                </span>
              </div>
              <div className="flex justify-between">
                <span>Deposit paid</span>
                <span>
                  {"£"}
                  {Number(booking?.totals?.depositAmount || 0).toFixed(2)}
                </span>
              </div>
              <div className="flex justify-between font-bold mt-4">
                <p>Outstanding Balance</p>
                <p>
                  {currencySymbol(booking?.currency)}
                  {remainingAmount.toFixed(2)}
                </p>
              </div>

              {/* Pay button */}
              <div className="mt-3 flex justify-end">
                <button
                  onClick={handleOpenBalanceInvoice}
                  className="px-4 py-2 rounded bg-black text-white hover:bg-[#ff6667] transition-colors"
                >
                  Pay Balance
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Sections */}
      <div className="mt-6 space-y-6">
        {sections.map((sec) => (
          <div key={sec.id} className="bg-white rounded border p-4 shadow-sm">
            {/* Header row */}
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-lg font-semibold">{sec.title}</h3>
                {sec.help && (
                  <p className="text-sm text-gray-600 mt-1">{sec.help}</p>
                )}
              </div>

              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="accent-[#ff6667]"
                  checked={!!complete[sec.id]}
                  disabled={!!sec.blockComplete} // disable UI if blocked
                  onChange={(e) => {
                    if (sec.blockComplete) return; // hard gate
                    toggleComplete(sec.id, e.target.checked);
                  }}
                />
                <span className="text-gray-700">Mark complete</span>
              </label>
            </div>

            {/* Block reason UNDER the checkbox row, styled as an alert */}
            {sec.blockComplete && sec.blockReason && (
              <div
                role="alert"
                className="mt-2 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
              >
                {sec.blockReason}
              </div>
            )}

            {/* Section fields */}
            <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-3 items-start">
              {sec.fields.map((f) => {
                if (f.type === "custom" && typeof f.render === "function") {
                  return (
                    <div key={f.key} className="md:col-span-2">
                      {f.render()}
                    </div>
                  );
                }

                return (
                  <div key={f.key} className="flex flex-col">
                    {f.label && (
                      <label className="text-sm text-gray-700 mb-1">
                        {f.label}
                      </label>
                    )}

                    {f.type === "textarea" ? (
                      <textarea
                        className="border rounded px-2 py-1 text-sm text-gray-800 min-h-[88px]"
                        placeholder={f.placeholder || ""}
                        value={answers[f.key] || ""}
                        onChange={(e) => handleAnswer(f.key, e.target.value)}
                      />
                    ) : f.type === "select" ? (
                      <select
                        className="border rounded px-2 py-1 text-sm text-gray-800"
                        value={answers[f.key] || ""}
                        onChange={(e) => handleAnswer(f.key, e.target.value)}
                      >
                        <option value="">Select…</option>
                        {f.options?.map((opt) => (
                          <option key={opt} value={opt}>
                            {opt}
                          </option>
                        ))}
                      </select>
                    ) : f.type === "number" ? (
                      <input
                        type="number"
                        className="border rounded px-2 py-1 text-sm text-gray-800"
                        value={answers[f.key] ?? ""}
                        onChange={(e) => handleAnswer(f.key, e.target.value)}
                      />
                    ) : (
                      <input
                        type="text"
                        className="border rounded px-2 py-1 text-sm text-gray-800"
                        placeholder={f.placeholder || ""}
                        value={answers[f.key] || ""}
                        onChange={(e) => handleAnswer(f.key, e.target.value)}
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
