// frontend/src/context/ShopContext.jsx
import React, {
  createContext,
  useState,
  useEffect,
  useRef,
} from "react";
import axios from "axios";
import calculateActPricing from "../pages/utils/pricing";
import CustomToast from "../components/CustomToast";
import { toast } from "react-toastify";
import { useNavigate, useLocation } from "react-router-dom";

export const ShopContext = createContext();

const ALLOWED_ACT_NAMES = new Set(["Motown Magic", "Dancefloor Magic"]);


const ShopProvider = (props) => {
  const currency = "£";
  const delivery_fee = 10;
  const backendUrl = import.meta.env.VITE_BACKEND_URL;

  // --- Core UI / data ---
  const [search, setSearch] = useState("");
  const [showSearch, setShowSearch] = useState(false);
  const [acts, setActs] = useState([]);
  const [cartItems, setCartItems] = useState({});
  const [token, setToken] = useState("");

  // --- User / shortlist (single sources of truth) ---
  const [userId, setUserId] = useState(null);
  const [shortlistedActs, setShortlistedActs] = useState([]); // array of actId strings
  const [shortlistItems, setShortlistItems] = useState([]); // legacy mirror (array of actId strings)

  // --- Availability map for selectedDate (tri-state: true / false / undefined) ---
  const [availableMap, setAvailableMap] = useState({});
  const [availLoading, setAvailLoading] = useState(false);



  // --- Location / date (synced with sessionStorage) ---
  const [selectedAddress, setSelectedAddress] = useState(
    sessionStorage.getItem("selectedAddress") || ""
  );
  const [selectedDate, setSelectedDate] = useState(
    sessionStorage.getItem("selectedDate") || ""
  );

// Always build absolute API URLs
const api = (path) =>
  `${backendUrl}${path.startsWith('/') ? path : `/${path}`}`;

  // Fetch + cache availability map for a given date (YYYY-MM-DD or ISO)
const loadAvailabilityForDate = async (dateISO) => {
  const d = String(dateISO || "").slice(0, 10);
  if (!d) return;

  const cacheKey = `availMap:${d}`;

  // 1) Warm from cache if present (instant UI)
  try {
    const cached = sessionStorage.getItem(cacheKey);
    if (cached) {
      const parsed = JSON.parse(cached);
      if (parsed && typeof parsed === "object") setAvailableMap(parsed);
    }
  } catch {}

  // Helper to build tri-state map from various backend shapes
  const toMap = (payload = {}) => {
    const map = {};
    const unavailable = Array.isArray(payload.unavailableActIds) ? payload.unavailableActIds : [];
    const available   = Array.isArray(payload.availableActIds)   ? payload.availableActIds   : [];
    const actIds      = Array.isArray(payload.actIds)            ? payload.actIds            : [];

    unavailable.forEach((id) => { map[id] = false; });
    available.forEach((id)   => { if (!(id in map)) map[id] = true; });

    // Compat: some endpoints only return actIds ⇒ treat as available
    if (!payload.unavailableActIds && actIds.length) {
      actIds.forEach((id) => { if (!(id in map)) map[id] = true; });
    }
    return map;
  };

  setAvailLoading(true);
  try {
    // 2) Try the canonical acts-by-date endpoint
    const url1 = api(`api/v2/availability/acts-by-dateV2?date=${encodeURIComponent(d)}`);
    let res = await fetch(url1, { headers: { accept: "application/json" } });
    let text = await res.text();
    let data = {};
    try { data = text ? JSON.parse(text) : {}; } catch {}

    // 3) If missing (404) or not OK, attempt fallback to acts-available
    if (!res.ok) {
      if (res.status === 404) {
        const url2 = api(`api/availability/acts-available?date=${encodeURIComponent(d)}`);
        res = await fetch(url2, { headers: { accept: "application/json" } });
        text = await res.text();
        try { data = text ? JSON.parse(text) : {}; } catch {}
      }
      if (!res.ok) {
        const msg = data?.message || data?.error || text || `HTTP ${res.status}`;
        throw new Error(msg);
      }
    }

    const map = toMap(data);
    try { sessionStorage.setItem(cacheKey, JSON.stringify(map)); } catch {}
    setAvailableMap(map);
  } catch (e) {
    console.warn("[avail] load failed:", e?.message || e);
    // Keep any cached UI; don't overwrite with empty on error
  } finally {
    setAvailLoading(false);
  }
};

  // Re-load when date changes
  useEffect(() => {
    if (selectedDate) loadAvailabilityForDate(selectedDate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDate]);

  // Convenience helpers for components
  const isActUnavailableForSelectedDate = (actId) =>
    !!selectedDate && availableMap[String(actId)] === false;
  const isActAvailableForSelectedDate = (actId) =>
    !!selectedDate && availableMap[String(actId)] === true;

  // ---- Availability (lead/deputy) driven by SSE ----
  const [availabilityStatus, setAvailabilityStatus] = useState({});
  // shape: { [actId]: { status: 'lead' | 'deputy', musicianName, dateISO, message } }


  // Cooldown map for global auto-trigger (per actId:dateISO)
  const lastAutoTriggerRef = useRef({});

  const formatShortDate = (iso) => {
    if (!iso) return "";
    try {
      const d = new Date(iso);
      return d.toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
      });
    } catch {
      return iso;
    }
  };

  // --- State container kept for compatibility with callers in your app ---
  const [state, setState] = useState({
    selectedExtras: [],
    selectedAddress: selectedAddress || "",
    selectedDate: selectedDate || "",
    shortlistItems: {},
  });

  // ============ Data loaders ============
  const getActsData = async () => {
    const res = await axios.get(`${backendUrl}/api/act/list`);
    if (res.data?.success) {
      setActs(res.data.acts.reverse());
    }
  };

  // Try to refresh one act (used after SSE inbound). If single-act endpoint is missing,
  // we fall back to reloading the list.
  const refreshActById = async (actId) => {
    if (!actId) return;
    try {
      const r = await axios.get(`${backendUrl}/api/act/${actId}`);
      if (r.data?.success && r.data?.act) {
        setActs((prev) => {
          const idx = prev.findIndex((a) => String(a._id) === String(actId));
          if (idx >= 0) {
            const next = [...prev];
            next[idx] = r.data.act;
            return next;
          }
          return [r.data.act, ...prev];
        });
        return;
      }
    } catch {
      // ignore and try list
    }
    try {
      await getActsData();
    } catch {
      // swallow
    }
  };

  useEffect(() => {
    getActsData().catch(() => {});
  }, []);

  // ✅ Hydrate logged-in user + shortlist once
  useEffect(() => {
    (async () => {
      try {
        const storedUserRaw = localStorage.getItem("user");
        const storedUser = storedUserRaw ? JSON.parse(storedUserRaw) : null;

        if (storedUser?._id) {
          setUserId(storedUser._id);
          const res = await axios.get(
            `${backendUrl}/api/shortlist/user/${storedUser._id}/shortlisted`
          );
          const ids = (res.data?.acts || []).map((a) => String(a._id));
          setShortlistedActs(ids);
          setShortlistItems(ids);
          localStorage.setItem("shortlistItems", JSON.stringify(ids));
        }
      } catch (err) {
      }
    })();
  }, [backendUrl]);

  // Keep sessionStorage in sync for date/address
  useEffect(() => {
    if (selectedDate) {
      sessionStorage.setItem("selectedDate", selectedDate);
      setState((s) => ({ ...s, selectedDate }));
    }
  }, [selectedDate]);
  useEffect(() => {
    if (selectedAddress) {
      sessionStorage.setItem("selectedAddress", selectedAddress);
      setState((s) => ({ ...s, selectedAddress }));
    }
  }, [selectedAddress]);

  // inside ShopProvider, near other cart helpers
const updatePerformance = (actId, lineupId, patch) => {
  setCartItems(prev => {
    const next = structuredClone(prev || {});
    if (!next[actId] || !next[actId][lineupId]) return prev; // nothing to update

    const current = next[actId][lineupId].performance || {
      arrivalTime: "",
      setupAndSoundcheckedBy: "",
      startTime: "",
      finishTime: "",
      finishDayOffset: 0,
      paLightsFinishTime: "",
      paLightsFinishDayOffset: 0,
    };
    next[actId][lineupId].performance = { ...current, ...patch };
    return next;
  });
};

  // ============ Availability helpers ============

  // Gate by act name — only allow specific acts
  const isActAllowed = (actId) => {
    const act = Array.isArray(acts)
      ? acts.find((a) => String(a._id) === String(actId))
      : null;
    const name = act?.tscName || act?.name || "";
    return ALLOWED_ACT_NAMES.has(name);
  };

  // Compute vocalist-specific “fee” for messaging (optional/nice-to-have)
  const computeVocalistFeeForMessage = async ({ act, lineup, address, date }) => {
    try {
      // members & base per-head
      const members = Array.isArray(lineup?.bandMembers) ? lineup.bandMembers : [];
      const lineupTotal =
        Number(lineup?.base_fee?.[0]?.total_fee) ||
        Number(act?.base_fee?.[0]?.total_fee) ||
        0;
      const perHead =
        members.length > 0 ? lineupTotal / members.length : 0;

      // try a basic travel component (very light touch; your pricing util can be heavier)
      // we won’t overfit here—this is just for the message number
      const vocalist =
        members.find((m) =>
          ["Lead Male Vocal", "Lead Female Vocal", "Lead Vocal", "vocalist-guitarist"].includes(
            m.instrument
          )
        ) || members[0];

      let travelFee = 0;
      if (vocalist?.postCode && act?.costPerMile > 0 && address) {
        // We can omit the distance API for now to avoid extra latency — per your current code you often fallback.
        // travelFee stays 0 (or you can add a fixed heuristic if you prefer)
      }
      const fee = Math.ceil(Math.max(0, perHead + travelFee));
      return fee > 0 ? String(fee) : null;
    } catch {
      return null;
    }
  };

  // Trigger availability requests for an act/lineup — **gated** by allowed act names
 // Trigger availability requests for an act/lineup — **gated** by allowed act names
const requestVocalistAvailability = async ({ actId, lineupId }) => {
  try {
    // Require date + address
    if (!selectedDate || !selectedAddress) return;
    // Only allow whitelisted acts (prevents unwanted spam)
    if (!isActAllowed(actId)) return;

    // Resolve act + lineup for an optional fee hint
    const act = Array.isArray(acts) ? acts.find((a) => String(a._id) === String(actId)) : null;
    let feeForMsg = null;

    if (act) {
      const lineup =
        (act.lineups || []).find(
          (l) =>
            String(l._id) === String(lineupId) ||
            String(l.lineupId) === String(lineupId)
        ) ||
        (act.lineups || []).reduce((max, l) => {
          const len = Array.isArray(l?.bandMembers) ? l.bandMembers.length : 0;
          const curr = Array.isArray(max?.bandMembers) ? max.bandMembers.length : 0;
          return len > curr ? l : max;
        }, null);

      if (lineup) {
        feeForMsg = await computeVocalistFeeForMessage({
          act,
          lineup,
          address: selectedAddress,
          date: selectedDate,
        });
      }
    }

    // Always hit absolute backend URL to avoid Netlify/ngrok intercepts
    const base = String(backendUrl || "").replace(/\/+$/, "");
    const url = `${base}/api/availability-v2/request`;

    // Normalize date to YYYY-MM-DD
    const dateISO = new Date(selectedDate).toISOString().slice(0, 10);

    const payload = {
      actId: String(actId),
      lineupId: lineupId != null ? String(lineupId) : null,
      date: dateISO,
      address: String(selectedAddress),
      // fee: feeForMsg ?? undefined, // optional — backend can compute if omitted
    };

    await axios.post(url, payload, {
      headers: { accept: "application/json" },
      withCredentials: false,
      timeout: 15000,
    });
  } catch (err) {
    // Keep UI quiet, but log for debugging
    console.warn("requestVocalistAvailability failed:", err?.message || err);
  }
};

  // 🔁 Global AUTO-TRIGGER: when user adds date+address AFTER shortlisting,
  // ping availability for ALL shortlisted acts (with 6h per-act cooldown).
  useEffect(() => {
    (async () => {
      try {
        if (!selectedDate || !selectedAddress) return;
        const shortlistIds = Array.isArray(shortlistedActs) ? shortlistedActs : [];
        if (!shortlistIds.length) return;

        const dateISO = new Date(selectedDate).toISOString().slice(0, 10);

        for (const actId of shortlistIds) {
          if (!actId) continue;
          if (!isActAllowed(actId)) continue;

          const key = `${actId}:${dateISO}`;
          const now = Date.now();
          const last = lastAutoTriggerRef.current[key] || 0;
          // 6 hours
          if (now - last < 6 * 60 * 60 * 1000) continue;

          try {
            // ✅ Skip if already YES recorded (call absolute backend URL)
            const res = await fetch(
              api(`api/availability/check-latest?actId=${encodeURIComponent(actId)}&dateISO=${encodeURIComponent(dateISO)}`),
              { headers: { accept: "application/json" } }
            );
            const text = await res.text();
            let j = {};
            try { j = text ? JSON.parse(text) : {}; } catch {}
            if (res.ok && j?.latestReply === "yes") continue;

            // ✅ Request availability via V2 (absolute URL)
            await axios.post(
              api("api/availability-v2/request"),
              {
                actId,
                lineupId: null,
                date: dateISO,
                address: selectedAddress,
              },
              { headers: { accept: "application/json" }, withCredentials: false, timeout: 15000 }
            );

            lastAutoTriggerRef.current[key] = now;
          } catch (e) {
            // swallow per design
          }
        }
      } catch (e) {
        // swallow
      }
    })();
  }, [selectedDate, selectedAddress, shortlistedActs, backendUrl]);

  // 🔌 SSE subscription: update toast + force-refresh act to pull fresh badge/photo
  useEffect(() => {
    try {
const sse = new EventSource(api('api/shortlist/availability/subscribe')); // absolute URL for SSE
      sse.addEventListener("open", () => {
      });

      sse.addEventListener("message", async (evt) => {
        if (!evt?.data) return;
        try {
          const payload = JSON.parse(evt.data);
          if (!payload?.actId) return;

          const isLead = payload.type === "availability_yes";
          const msg = isLead
            ? `Lead vocalist ${payload.musicianName} (featured in ${payload.actName}) is available for ${formatShortDate(
                payload.dateISO
              )}.`
            : `${payload.actName}'s deputy vocalist ${payload.musicianName} is available for ${formatShortDate(
                payload.dateISO
              )}.`;

          setAvailabilityStatus((prev) => ({
            ...prev,
            [payload.actId]: {
              status: isLead ? "lead" : "deputy",
              musicianName: payload.musicianName,
              dateISO: payload.dateISO,
              message: msg,
            },
          }));

          toast(<CustomToast type="success" message={msg} />);

          // 🧲 Force-refresh the specific act to ensure badge/photo is up-to-date
          await refreshActById(payload.actId);
        } catch (e) {
        }
      });

      sse.addEventListener("error", (err) => {
      });

      return () => {
        sse.close();
      };
    } catch (e) {
    }
  }, [backendUrl]);

  // ============ Shortlist helpers ============

  // Public helper to refresh shortlist from backend
  const fetchShortlistedActs = async (uid) => {
    try {
      const u = uid || userId;
      if (!u) return;
      const res = await axios.get(
        `${backendUrl}/api/shortlist/user/${u}/shortlisted`
      );
      if (res.data.success) {
        const ids = (res.data.acts || []).map((a) => String(a._id));
        setShortlistedActs(ids);
        setShortlistItems(ids);
        localStorage.setItem("shortlistItems", JSON.stringify(ids));
      }
    } catch (err) {
    }
  };

  const navigate = useNavigate();
const location = useLocation();

// Small helper: nudge user to log in and remember where they were
const promptLogin = (msg = "Please log in to save acts to your shortlist.") => {
  try {
    toast(<CustomToast type="info" message={msg} />);
  } catch {}
  // Remember current page to come back to after login
  const next = `${location.pathname}${location.search || ""}`;
  sessionStorage.setItem("postLoginNext", next);
  navigate("/login");
};

  // Add to shortlist (uses toggle route + triggers availability if date/address present)
const addToShortlist = async (itemId, selectedLineup) => {
  // keep signature for callers, but route through shortlistAct (toggle)
  const storedUserRaw = localStorage.getItem("user");
  const storedUser = storedUserRaw ? JSON.parse(storedUserRaw) : null;
  const u = storedUser?._id || userId;
  if (!u) {
    promptLogin("Please log in to save acts to your shortlist.");
    return;
  }
  await shortlistAct(u, String(itemId));
};

  // Toggle shortlist via PATCH routes with optimistic UI
  const shortlistAct = async (uid, actId) => {
    const u = uid || userId;
    if (!actId) return;
    if (!u) {
      promptLogin("Please log in to manage your shortlist.");
      return;
    }

    const idStr = String(actId);
    const isShortlistedNow = Array.isArray(shortlistedActs) && shortlistedActs.includes(idStr);

    // optimistic update
    const prev = Array.isArray(shortlistedActs) ? [...shortlistedActs] : [];
    const next = isShortlistedNow
      ? prev.filter((id) => id !== idStr)
      : [...new Set([...prev, idStr])];

    setShortlistedActs(next);
    setShortlistItems(next);
    try { localStorage.setItem("shortlistItems", JSON.stringify(next)); } catch {}

    try {
      if (isShortlistedNow) {
        await axios.patch(`${backendUrl}/api/shortlist/act/${idStr}/decrement-shortlist`, { userId: u });
      } else {
        await axios.patch(`${backendUrl}/api/shortlist/act/${idStr}/increment-shortlist`, { userId: u, updateTimesShortlisted: true });
        if (selectedDate && selectedAddress && isActAllowed(idStr)) {
          await requestVocalistAvailability({ actId: idStr, lineupId: null });
        }
      }
    } catch (err) {
      // revert on failure
      setShortlistedActs(prev);
      setShortlistItems(prev);
      try { localStorage.setItem("shortlistItems", JSON.stringify(prev)); } catch {}
      try { toast(<CustomToast type="error" message="Could not update shortlist." />); } catch {}
    }
  };

  // ============ Invoicing helpers ============
  const computeBalanceDueDate = (eventISO) => {
    try {
      if (!eventISO) return null;
      const d = new Date(eventISO);
      if (Number.isNaN(d.getTime())) return null;
      d.setDate(d.getDate() - 14);
      // Normalise to 00:00 local time
      d.setHours(0, 0, 0, 0);
      return d.toISOString();
    } catch {
      return null;
    }
  };

  /**
   * Schedule a balance invoice (due 14 days before the event) and set up reminders.
   * The backend endpoint should:
   *  - create/update an invoice in DB with status="scheduled" and dueDate
   *  - create reminder jobs (e.g. 7d and 3d before due date + on due date)
   *  - optionally create a Stripe Invoice (draft) tied to a Customer and send at reminder time
   */
  const scheduleBalanceInvoice = async ({
    bookingId,
    actId,
    customerId,     // Stripe customer id or your internal id
    eventDateISO,   // event date (ISO)
    currency = 'GBP',
    amountPence,    // integer in pence for the remaining balance
    metadata = {},
  }) => {
    try {
      if (!bookingId || !eventDateISO || !amountPence) {
        return { success: false, error: 'missing_fields' };
      }

      const dueAtISO = computeBalanceDueDate(eventDateISO);
      const payload = {
        bookingId,
        actId,
        customerId,
        currency,
        amountPence,
        eventDateISO,
        dueAtISO,
        metadata,
      };

      const res = await axios.post(`${backendUrl}/api/invoices/schedule-balance`, payload);
      return res.data || { success: true };
    } catch (err) {
      return { success: false, error: err?.message || 'request_failed' };
    }
  };

  // ============ Cart helpers ============

  const removeFromCart = (actId, lineupId) => {
    const updated = structuredClone(cartItems);

    if (updated[actId]) {
      delete updated[actId][lineupId];
      if (Object.keys(updated[actId]).length === 0) {
        delete updated[actId]; // if no lineups left, remove act
      }
    }

    setCartItems(updated);
  };

  // Accepts: actId, lineupId, selectedExtras, selectedAfternoonSets, songSuggestions
  const addToCart = async (
    actId,
    lineupId,
    selectedExtras = [],
    selectedAfternoonSets = [],
    songSuggestions = []
  ) => {
    if (!actId || !lineupId) {
      return;
    }
    const actKey = String(actId);
    const lineupKey = String(lineupId);

    // Normalize inputs: accept a single object or an array
    const extrasInput = Array.isArray(selectedExtras)
      ? selectedExtras.filter(Boolean)
      : selectedExtras
      ? [selectedExtras]
      : [];

    const afternoonInput = Array.isArray(selectedAfternoonSets)
      ? selectedAfternoonSets.filter(Boolean)
      : selectedAfternoonSets
      ? [selectedAfternoonSets]
      : [];

    const suggestionsInput = Array.isArray(songSuggestions)
      ? songSuggestions.filter(Boolean)
      : songSuggestions
      ? [songSuggestions]
      : [];

    // Clone cart
    const updated = structuredClone(cartItems || {});
    // single-lineup-per-act model: clear existing
    if (updated[actKey]) {
      delete updated[actKey];
    }

    // Split extras vs ceremony/afternoon sets
    const allSelectedExtras = [];
    const allAfternoonSets = [];
    extrasInput.forEach((item) => {
      if (["ceremony", "afternoon", "both"].includes(item?.type)) {
        allAfternoonSets.push(item);
      } else {
        allSelectedExtras.push(item);
      }
    });

    updated[actKey] = {
      [lineupKey]: {
        quantity: 1,
        selectedExtras: allSelectedExtras,
        selectedAfternoonSets: [
          ...afternoonInput,
          ...allAfternoonSets,
        ],
        songSuggestions: suggestionsInput,
        dismissedExtras: [],
        performance: {               // 👈 new
          arrivalTime: "",
          setupAndSoundcheckedBy: "",
          startTime: "",
          finishTime: "",
          finishDayOffset: 0,
          paLightsFinishTime: "",
          paLightsFinishDayOffset: 0,
        },
      },
    };

    setCartItems(updated);

    // Trigger availability (gated) if we have date+address
    if (selectedDate && selectedAddress && isActAllowed(actKey)) {
      requestVocalistAvailability({ actId: actKey, lineupId: lineupKey });
    }

    // Optional: sync cart to backend
    if (token) {
      try {
        await axios.post(
          `${backendUrl}/api/cart/add`,
          {
            actId: actKey,
            lineupId: lineupKey,
            selectedExtras: allSelectedExtras,
            selectedAfternoonSets: [
              ...afternoonInput,
              ...allAfternoonSets,
            ],
            songSuggestions: suggestionsInput,
          },
          { headers: { token } }
        );
      } catch (err) {
      }
    }
  };

  const getCartCount = () => {
    return Object.values(cartItems).reduce((total, act) => {
      return (
        total +
        Object.values(act).reduce(
          (sum, lineup) => sum + (lineup.quantity || 0),
          0
        )
      );
    }, 0);
  };

  const updateQuantity = (actId, lineupId, quantity) => {
    const updated = structuredClone(cartItems);

    if (quantity > 0) {
      if (!updated[actId]) updated[actId] = {};

      const existingExtras = updated[actId][lineupId]?.selectedExtras || [];
      updated[actId][lineupId] = {
        quantity,
        selectedExtras: existingExtras,
      };
    } else {
      if (updated[actId]) {
        delete updated[actId][lineupId];
        if (Object.keys(updated[actId]).length === 0) {
          delete updated[actId];
        }
      }
    }
    setCartItems(updated);
  };

  const updateExtras = async (actId, lineupId, newExtra) => {
    const updated = structuredClone(cartItems);

    if (updated[actId] && updated[actId][lineupId]) {
      const rawExtras = updated[actId][lineupId].selectedExtras;
      const extras = Array.isArray(rawExtras)
        ? rawExtras
        : rawExtras
        ? [rawExtras]
        : [];

      const exists = extras.find((e) => e.key === newExtra.key);

      if (exists) {
        // remove
        if (newExtra.quantity === 0) {
          updated[actId][lineupId].selectedExtras = extras.filter(
            (e) => e.key !== newExtra.key
          );
        } else {
          // update
          updated[actId][lineupId].selectedExtras = extras.map((e) =>
            e.key === newExtra.key
              ? { ...e, price: newExtra.price, quantity: newExtra.quantity }
              : e
          );
        }
      } else {
        // add
        if (newExtra.quantity > 0) {
          updated[actId][lineupId].selectedExtras = [...extras, newExtra];
        }
      }

      setCartItems(updated);

      if (token) {
        try {
          await axios.post(
            `${backendUrl}/api/cart/update`,
            {
              actId,
              lineupId,
              quantity: updated[actId][lineupId].quantity,
              selectedExtras: updated[actId][lineupId].selectedExtras,
            },
            { headers: { token } }
          );
        } catch (err) {
        }
      }
    }
  };

  const getCartAmount = async () => {
    let totalAmount = 0;

    for (const actId in cartItems) {
      const actData = acts.find((act) => String(act._id) === String(actId));
      if (!actData) continue;

      for (const lineupId in cartItems[actId]) {
        const cartItem = cartItems[actId][lineupId];
        const {
          quantity,
          selectedExtras = [],
          selectedAfternoonSets = [],
        } = cartItem;

        const lineup =
          actData.lineups.find((l) => String(l.lineupId) === String(lineupId)) ||
          actData.lineups.find((l) => String(l._id) === String(lineupId));
        if (!lineup) continue;

        const result = await calculateActPricing(
          actData,
          selectedAddress?.split(",").slice(-2)[0]?.trim() || "",
          selectedAddress,
          selectedDate,
          lineup
        );

        const basePrice = Number(result?.total || 0);
        const extrasTotal = [...selectedExtras, ...selectedAfternoonSets].reduce(
          (sum, e) => sum + (e.price || 0),
          0
        );
        const itemTotal = (basePrice + extrasTotal) * (quantity || 1);

        totalAmount += itemTotal;
      }
    }

    return Math.ceil(totalAmount);
  };

  // ============ Simple helpers ============

  const getShortlistCount = () => shortlistedActs.length;

  const isShortlisted = (actId) => {
    const id = String(actId);
    return Array.isArray(shortlistedActs) && shortlistedActs.includes(id);
  };

  // 🚪 Logout: clears storage and resets state
  const logout = () => {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    localStorage.removeItem("shortlistItems");
    sessionStorage.removeItem("selectedAddress");
    sessionStorage.removeItem("selectedDate");

    setToken("");
    setUserId(null);
    setShortlistItems([]);
    setShortlistedActs([]);
    setCartItems({});
    setSelectedAddress("");
    setSelectedDate("");
    setActs([]);
    setAvailabilityStatus({});

    window.location.reload();
  };

  

  const value = {
    // core
    acts,
    currency,
    delivery_fee,
    search,
    setSearch,
    showSearch,
    setShowSearch,
    backendUrl,

    // cart
    cartItems,
    setCartItems,
    addToCart,
    updateQuantity,
    updateExtras,
    removeFromCart,
    getCartCount,
    getCartAmount,
updatePerformance,
    // location/date
    selectedAddress,
    setSelectedAddress,
    selectedDate,
    setSelectedDate,

    // shortlist
    addToShortlist,
    shortlistedActs,
    setShortlistedActs,
    shortlistItems,
    setShortlistItems,
    shortlistAct,
    getShortlistCount,
    isShortlisted,
    fetchShortlistedActs,

    // availability (frontend)
    availableMap,
    availLoading,
    loadAvailabilityForDate,
    isActUnavailableForSelectedDate,
    isActAvailableForSelectedDate,

    // availability
    availabilityStatus,
    setAvailabilityStatus,
    requestVocalistAvailability,

    // auth
    token,
    setToken,
    userId,
    setUserId,

    // misc
    state,
    setState,
    logout,
     computeBalanceDueDate,
    scheduleBalanceInvoice,
  };

  return (
    <ShopContext.Provider value={value}>{props.children}</ShopContext.Provider>
  );
};

export default ShopProvider;
    // invoicing
   