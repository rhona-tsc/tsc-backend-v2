import React, {
  useContext,
  useEffect,
  useState,
  useCallback,
  useRef,
} from "react";
import { toast } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";
import CustomToast from "../components/CustomToast";
import { ShopContext } from "../context/ShopContext";
import Title from "../components/Title";
import CartTotal from "../components/CartTotal";
import { useNavigate } from "react-router-dom";
import calculateActPricing from "./utils/pricing";
import CustomTimePicker from "../components/CustomTimePicker";
import "keen-slider/keen-slider.min.css";
import ExtrasCarousel from "../components/ExtrasCarousel";
import { assets } from "../assets/assets";
import { calculateExtraPrice } from "./utils/pricing";
import { addMinutesHHMM } from "./utils/time";

const Cart = () => {
  const {
    acts,
    cartItems,
    selectedDate,
    selectedAddress,
    removeFromCart,
    setShowSearch,
    setCartItems,
    availabilityStatus,
    setAvailabilityStatus,
    requestVocalistAvailability,
    updatePerformance,
    isActUnavailableForSelectedDate,
  availLoading
  } = useContext(ShopContext);

  const changingLineupRef = useRef(false);

  const [cartData, setCartData] = useState([]);
  const [cartDetails, setCartDetails] = useState([]);

  const [selectedEventType, setSelectedEventType] = useState("Wedding");
  const [customEventType, setCustomEventType] = useState("");

  const [performancePlans, setPerformancePlans] = useState({});

  const [isChangingLineup, setIsChangingLineup] = useState(false);
  const navigate = useNavigate();
  const mergedUpdateExtras = useMergedUpdateExtras(cartItems, setCartItems);

  // NEW: track which lineups got auto-added extras so the banner shows the right text.
  // key shape: `${actId}:${lineupId}` -> 'late' | 'early'
  const [autoAddedFlags, setAutoAddedFlags] = useState({});
  const makeKey = (actId, lineupId) => `${actId}:${lineupId}`;
  const markAutoAdded = (actId, lineupId, kind /* 'late' | 'early' */) =>
    setAutoAddedFlags((prev) => ({
      ...prev,
      [makeKey(actId, lineupId)]: kind,
    }));
  const resolvePerMemberNet = (act, key, fallback = 0) => {
    const raw = act?.extras?.get ? act.extras.get(key) : act?.extras?.[key];
    if (typeof raw === "number") return Number(raw) || 0;
    if (raw && typeof raw === "object" && raw.price != null)
      return Number(raw.price) || 0;
    return Number(fallback) || 0;
  };
  const normLineupId = (l) => String(l?._id || l?.lineupId || "");

  const idToString = (val) => {
    if (!val) return "";
    // If an object with _id/lineupId was passed, extract and stringify
    if (typeof val === "object" && (val._id || val.lineupId)) {
      return String(val._id?.toString?.() || val.lineupId?.toString?.() || "");
    }
    // If it's already a primitive (string/number), stringify safely
    return String(val?.toString?.() || val);
  };

  const sameId = (a, b) => idToString(a) === idToString(b);

  // Helpers to exclude managers / non-performers from per-member time charges
  const isManagerLike = (m = {}) => {
    const hasManagerWord = (s = "") =>
      /\b(manager|management)\b/i.test(String(s));

    if (m.isManager === true || m.isNonPerformer === true) return true;

    // Instrument or title fields
    if (hasManagerWord(m.instrument) || hasManagerWord(m.title)) return true;

    // Any additional role name containing manager/management (e.g. "Band Management", "Tour Manager")
    const rolesArr = Array.isArray(m.additionalRoles) ? m.additionalRoles : [];
    if (
      rolesArr.some((r) => hasManagerWord(r?.role) || hasManagerWord(r?.title))
    )
      return true;

    return false;
  };

  const findLineupById = (act, lineupId) => {
    const target = idToString(lineupId);
    return (act?.lineups || []).find(
      (l) => sameId(l._id, target) || sameId(l.lineupId, target)
    );
  };

  useEffect(() => {
    // Don’t run until we have acts and cartItems
    if (!acts || acts.length === 0) return;
    if (!cartItems || Object.keys(cartItems).length === 0) {
      setCartData([]); // keep it clean
      return;
    }

    const fetchCartData = async () => {
      const tempData = [];

      for (const actId in cartItems) {
        const actData = acts.find((act) => act._id === actId);
        if (!actData) {
          continue;
        }

        for (const lineupId in cartItems[actId]) {
          const {
            quantity,
            selectedExtras = [],
            dismissedExtras = [],
          } = cartItems[actId][lineupId];

          const lineup = actData.lineups.find(
            (l) => String(l._id || l.lineupId) === String(lineupId)
          );
          if (!lineup) {
            
            continue;
          }

          const countyFromAddress =
            selectedAddress?.split(",").slice(-2)[0]?.trim() || "";
          let adjustedTotal = 0;

          try {
            const { total } = await calculateActPricing(
              actData,
              countyFromAddress,
              selectedAddress,
              selectedDate,
              lineup
            );
            adjustedTotal = Number(total) || 0;
          } catch (err) {
           
          }

          tempData.push({
            _id: actId,
            selectedLineup: lineupId,
            quantity,
            selectedExtras: Array.isArray(selectedExtras)
              ? selectedExtras
              : [selectedExtras],
            dismissedExtras:
              cartItems?.[actId]?.[lineupId]?.dismissedExtras || [],
            adjustedTotal,
            actData,
            lineup,
          });
        }
      }

      setCartData(tempData);
    };

    fetchCartData();
  }, [cartItems, acts, selectedAddress, selectedDate]);

  const triggerSearch = () => {
    setShowSearch(true);
    navigate("/acts");
    window.scrollTo(0, 0);
  };

  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  const clearFinishOverride = useCallback(
    (actId) => {
      setPerformancePlans((prev) => ({
        ...prev,
        [actId]: { ...prev[actId], finishTime: undefined },
      }));
    },
    [setPerformancePlans]
  );

  const formatDate = (dateString) => {
    if (!dateString) return "No date selected";
    const date = new Date(dateString);
    const day = date.getDate();
    const month = date.toLocaleString("en-GB", { month: "long" });
    const year = date.getFullYear();
    const suffix = ["th", "st", "nd", "rd"][
      day % 10 > 3 ? 0 : ((day % 100) - (day % 10) !== 10) * (day % 10)
    ];
    return `${day}${suffix} of ${month} ${year}`;
  };

  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  useEffect(() => {
    if (!acts || acts.length === 0) return;
    if (!cartItems || Object.keys(cartItems).length === 0) {
      setCartDetails([]);
      return;
    }

    const loadPrices = async () => {
      const results = [];
      const selectedCounty =
        selectedAddress?.split(",").slice(-2)[0]?.trim() || "";

      for (const actId in cartItems) {
        const act = acts.find((a) => a._id === actId);
        if (!act) continue;

        for (const lineupId in cartItems[actId]) {
          const { quantity, selectedExtras = [] } = cartItems[actId][lineupId];
          const lineup = act.lineups.find(
            (l) => String(l._id || l.lineupId) === String(lineupId)
          );
          if (!lineup) continue;

          const { total } = await calculateActPricing(
            act,
            selectedCounty,
            selectedAddress,
            selectedDate,
            lineup
          );
          const adjustedTotal = Number(total) || 0;

          let basePrice = Math.round(adjustedTotal * 0.75);
          lineup.bandMembers.forEach((member, i) => {
            const name =
              `${member.firstName || ""} ${member.lastName || ""}`.trim() ||
              `Member ${i + 1}`;
            const coreFee = member.fee || 0;
            const essentialRoles = (member.additionalRoles || []).filter(
              (r) => r.isEssential && typeof r.additionalFee === "number"
            );
            const roleDetails = essentialRoles.map((r) => ({
              role: r.role || "Unnamed Role",
              fee: r.additionalFee,
            }));
          });
          // Add fees for isEssential additionalRoles (only those with valid additionalFee)
          const additionalEssentialRoles = lineup.bandMembers.flatMap(
            (member) =>
              (member.additionalRoles || []).filter(
                (r) => r.isEssential && typeof r.additionalFee === "number"
              )
          );
          const additionalRolesTotal = additionalEssentialRoles.reduce(
            (sum, role) => sum + role.additionalFee,
            0
          );
          basePrice += additionalRolesTotal;

          const safeExtras = Array.isArray(selectedExtras)
            ? selectedExtras
            : selectedExtras
              ? [selectedExtras]
              : [];
          const extrasTotal = safeExtras.reduce(
            (sum, extra) => sum + (extra.price || 0),
            0
          );
          const subtotalWithMargin = adjustedTotal;
          const itemTotal = (subtotalWithMargin + extrasTotal) * quantity;

          results.push({
            actId,
            actName: act.tscName,
            image: act.images?.[0],
            lineupId,
            lineup,
            quantity,
            subtotalWithMargin,
            basePrice,
            adjustedTotal,
            extrasTotal,
            total: itemTotal,
            selectedExtras: Array.isArray(selectedExtras)
              ? selectedExtras
              : [selectedExtras],
            allLineups: act.lineups,
            actData: act,
          });
        }
      }

      setCartDetails(results);
    };

    loadPrices();
  }, [cartItems, acts, selectedAddress, selectedDate]);

  // ✅ Persist PA/Lights finish (time + dayOffset) to both performancePlans and cartItems
  const handleOverridePaFinishTime = useCallback(
    (actId, lineupId, { hhmm, dayOffset = 0 }) => {
      // local planner state (for UI calc)
      setPerformancePlans((prev) => ({
        ...prev,
        [actId]: {
          ...(prev[actId] || {}),
          paLightsFinishTime: hhmm,
          paLightsFinishDayOffset: dayOffset,
        },
      }));

      // 🔐 authoritative cart state (what PlaceBooking sends to backend)
      updatePerformance(actId, lineupId, {
        paLightsFinishTime: hhmm,
        paLightsFinishDayOffset: Number(dayOffset) || 0,
      });
    },
    []
  );

  // ✅ Persist Act finish (time + dayOffset) to both places
  const handleOverrideFinishTime = useCallback(
    (actId, lineupId, { hhmm, dayOffset = 0 }) => {
      setPerformancePlans((prev) => ({
        ...prev,
        [actId]: {
          ...(prev[actId] || {}),
          finishTime: hhmm,
          finishDayOffset: dayOffset,
        },
      }));

      updatePerformance(actId, lineupId, {
        finishTime: hhmm,
        finishDayOffset: Number(dayOffset) || 0,
      });
    },
    []
  );


  const handleLineupChange = async (actId, oldLineupId, newLineupId) => {
    const oldIdStr = String(oldLineupId || "");
    const newIdStr = String(newLineupId || "");

    if (!newIdStr || oldIdStr === newIdStr) {
    
      return;
    }

    if (changingLineupRef.current) {
    
    }

    changingLineupRef.current = true;
    setIsChangingLineup(true);

    try {
      const act = acts.find((a) => a._id === actId);
      if (!act) {
        return;
      }

      // Resolve the target lineup using normalized id comparison
      const lineup = findLineupById(act, newIdStr);
      if (!lineup) {
        const available = (act.lineups || []).map((l) => ({
          _id: idToString(l._id),
          lineupId: idToString(l.lineupId),
          label:
            l.actSize ||
            (Array.isArray(l.bandMembers)
              ? `${l.bandMembers.length}-Piece`
              : "Lineup"),
        }));
        return;
      }

      const selectedCounty =
        selectedAddress?.split(",").slice(-2)[0]?.trim() || "";
      const { total } = await calculateActPricing(
        act,
        selectedCounty,
        selectedAddress,
        selectedDate,
        lineup
      );
      const priceWithMargin = Number(total) || 0;
      const basePrice = Math.round(priceWithMargin * 0.75);

      // 1) Move the node in cartItems (old key -> new key) FIRST so effects rebuild cartDetails reliably
      setCartItems((prev) => {
        const updated = structuredClone(prev || {});
        const existing = updated?.[actId]?.[oldIdStr];
        if (!updated[actId]) updated[actId] = {};
        if (existing) {
          delete updated[actId][oldIdStr];
          updated[actId][newIdStr] = existing;
        } else {
        }
        return updated;
      });

      // 2) Optimistically update the rendered details so the dropdown reflects immediately
      setCartDetails((prev) =>
        prev.map((ci) => {
          if (ci.actId !== actId || String(ci.lineupId) !== oldIdStr) return ci;
          const extrasTotal = (ci.selectedExtras || []).reduce(
            (s, e) => s + (e.price || 0),
            0
          );
          return {
            ...ci,
            lineupId: newIdStr,
            lineup,
            basePrice,
            adjustedTotal: priceWithMargin,
            subtotalWithMargin: priceWithMargin,
            total: (priceWithMargin + extrasTotal) * (ci.quantity || 1),
          };
        })
      );

      toast(<CustomToast type="success" message="Lineup updated in cart!" />, {
        position: "top-right",
        autoClose: 2000,
      });
    } catch (err) {
    } finally {
     
      changingLineupRef.current = false;
      setIsChangingLineup(false);
    }
  };

  // Build a friendly lineup description from a lineup object, including roles tail
  const generateDescription = (lineup = {}) => {
    try {
      const members = Array.isArray(lineup.bandMembers)
        ? lineup.bandMembers
        : [];
      if (!members.length) return "";

      // Helpers
      const cap = (s = "") =>
        String(s).replace(/\b\w/g, (c) => c.toUpperCase());
      const isEssentialPerformer = (m = {}) => {
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
        .filter(isEssentialPerformer)
        .map((m) => cap(m.instrument || "").trim())
        .filter(Boolean);

      if (!instruments.length) return "";

      // Sort: vocals first, drums last, others in the middle
      const weight = (s) => {
        const x = s.toLowerCase();
        if (x.includes("vocal")) return 0;
        if (x === "drums" || x.includes("drum")) return 999;
        return 100;
      };
      const instrumentsOrdered = [...new Set(instruments)].sort(
        (a, b) => weight(a) - weight(b)
      );
      const instrumentsStr = formatWithAnd(instrumentsOrdered);

      // Essential service roles (e.g., Sound Engineering, Band Management)
      const roles = members.flatMap((m) =>
        (m.additionalRoles || [])
          .filter((r) => r?.isEssential)
          .map((r) => cap(r.role || r.title || "Unnamed Service"))
      );
      const rolesStr = formatWithAnd(roles);

      // Append roles tail when present
      const rolesTail = rolesStr ? ` (including ${rolesStr} services)` : "";

      return `${instrumentsStr}${rolesTail}`;
    } catch {
      return "";
    }
  };

const handlePerformancePlanChange = (actId, lineupId, selectedPlanIndex, actData) => {
   // mirror to local UI state
   setPerformancePlans((prev) => ({
     ...prev,
     [actId]: {
       ...prev[actId],
       planIndex: selectedPlanIndex,
     },
   }));

   // persist into the cart performance block so it reaches checkout → DB
   try {
     const idx = Number(selectedPlanIndex);
     const sets       = Array.isArray(actData?.numberOfSets) ? actData.numberOfSets[idx] : undefined;
     const length     = Array.isArray(actData?.lengthOfSets) ? actData.lengthOfSets[idx] : undefined;
     const minInterval= Array.isArray(actData?.minimumIntervalLength) ? actData.minimumIntervalLength[idx] : undefined;

     updatePerformance(actId, lineupId, {
       planIndex: Number.isFinite(idx) ? idx : null,
       plan: {
         sets: Number(sets) || null,
         length: Number(length) || null,
         minInterval: Number(minInterval) || null,
       },
     });
   } catch (e) {
   }
 };

  const toHHMM = (d) => {
    if (!d || !(d instanceof Date) || isNaN(d.getTime())) return "";
    return d.toLocaleTimeString("en-GB", {
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const calculateAdjustedTimes = (
    lineup,
    selectedExtras = [],
    startTime,
    setupAndSoundcheckedBy,
    actData,
    performancePlans,
    selectedDate
  ) => {
    try {
     
    } catch {}

    if (!lineup) {
      const ret = {
        setupTime: 0,
        soundcheckTime: 0,
        changeTime: 0,
        arrivalTime: null,
        finishTime: null,
        needsEarlyArrival: false,
        notEnoughPerformanceWindow: false,
      };
      return ret;
    }

    const eventBase = selectedDate ? new Date(selectedDate) : new Date();
    const eventDay = new Date(
      eventBase.getFullYear(),
      eventBase.getMonth(),
      eventBase.getDate(),
      0,
      0,
      0,
      0
    );

    const parseHHMM = (hhmm, mayBeNextDay = false) => {
      if (!hhmm) return null;
      const [h, m] = String(hhmm).split(":").map(Number);
      if (Number.isNaN(h) || Number.isNaN(m)) return null;
      const d = new Date(eventDay);
      d.setHours(h, m, 0, 0);
      if (mayBeNextDay && h < 6) d.setDate(d.getDate() + 1);
      return d;
    };

    const parseWithLog = (hhmm, mayBeNextDay = false, label = "") => {
      const d = parseHHMM(hhmm, mayBeNextDay);
      try {
      
      } catch {}
      return d;
    };

    let setupTime = Number(lineup.setupTime) || 90;
    let soundcheckTime = Number(lineup.soundcheckTime) || 60;
    let changeTime =
      Number(lineup.changeTimeRequired || lineup.changeTime) || 15;

    const hasSpeedySetup =
      Array.isArray(selectedExtras) &&
      selectedExtras.some((e) =>
        e?.name?.toLowerCase?.().includes("speedy setup")
      );
    if (hasSpeedySetup) {
      setupTime = 30;
      soundcheckTime = 30;
    }
    const totalPreShowTime = setupTime + soundcheckTime + changeTime;

    try {
    } catch {}

    const standardArrival = new Date(eventDay);
    standardArrival.setHours(17, 0, 0, 0); // 17:00

    const midnight = new Date(eventDay);
    midnight.setDate(midnight.getDate() + 1);
    midnight.setHours(0, 0, 0, 0);

    const lineupMembers = Array.isArray(lineup?.bandMembers)
      ? lineup.bandMembers
      : [];
    const performersOnly = lineupMembers.filter((m) => !isManagerLike(m));
    const lineupSize = performersOnly.length;
    const earlyArrivalFeePer60 = Number(lineup?.earlyArrivalFeePer60) || 0;
    const lateStayFeePer60 = Number(lineup?.lateStayFeePer60) || 0;

    const inferMinutes = (extra, per60) => {
      if (!extra) return 0;
      const byName = extra.name?.match(/(\d+)\s*mins/i);
      if (byName) return parseInt(byName[1], 10) || 0;
      if (extra.price && per60 && lineupSize) {
        return Math.round((extra.price / (per60 * lineupSize)) * 60);
      }
      if (extra.quantity) return 60 * Number(extra.quantity);
      return 0;
    };

    const earlyArrivalExtra = (selectedExtras || []).find(
      (e) => e?.key === "early_arrival_60min_per_band_member"
    );
    const lateStayExtra = (selectedExtras || []).find(
      (e) => e?.key === "late_stay_60min_per_band_member"
    );
    const earlyArrivalMinutes = inferMinutes(
      earlyArrivalExtra,
      earlyArrivalFeePer60
    );
    const lateStayMinutes = inferMinutes(lateStayExtra, lateStayFeePer60);

    const overrides = performancePlans?.[actData?._id] || {};
    const effectiveSetupAndSCBy =
      setupAndSoundcheckedBy ?? overrides.setupAndSoundcheckedBy ?? null;
    const effectiveStartTime = startTime ?? overrides.startTime ?? null;

    let setupCompleteTime;
    if (effectiveSetupAndSCBy) {
      setupCompleteTime = parseWithLog(
        effectiveSetupAndSCBy,
        false,
        "Setup+Soundcheck complete"
      );
    } else {
      setupCompleteTime = new Date(
        standardArrival.getTime() + totalPreShowTime * 60000
      );
    }

    let arrivalTime = new Date(
      setupCompleteTime.getTime() - totalPreShowTime * 60000
    );

    const arrivalOverride = parseWithLog(
      overrides.arrivalTime,
      false,
      "arrivalOverride"
    );
    if (arrivalOverride) {
      arrivalTime = arrivalOverride;
    }

    const earliestAllowedArrival = new Date(
      standardArrival.getTime() - earlyArrivalMinutes * 60000
    );
    const needsEarlyArrival = arrivalTime < earliestAllowedArrival;

    let chosenStart;
    if (effectiveStartTime) {
      chosenStart = parseWithLog(effectiveStartTime, false, "chosenStart");
    } else {
      const sevenPm = new Date(eventDay);
      sevenPm.setHours(19, 0, 0, 0);
      chosenStart = new Date(
        Math.max(setupCompleteTime.getTime(), sevenPm.getTime())
      );
    }
    const permittedOnSiteMinutes =
      7 * 60 + earlyArrivalMinutes + lateStayMinutes;

    const finishOverride = parseWithLog(
      overrides.finishTime,
      true,
      "finishOverride"
    );

    const theoreticalFinishNoClamp = finishOverride
      ? finishOverride
      : new Date(arrivalTime.getTime() + permittedOnSiteMinutes * 60000);

    let rawFinish = finishOverride
      ? finishOverride
      : new Date(
          Math.min(
            arrivalTime.getTime() + permittedOnSiteMinutes * 60000,
            midnight.getTime()
          )
        );

    if (
      rawFinish &&
      chosenStart &&
      rawFinish.getTime() < chosenStart.getTime()
    ) {
      rawFinish = new Date(rawFinish.getTime());
      rawFinish.setDate(rawFinish.getDate() + 1);
    }

    if (!finishOverride && lateStayMinutes <= 0) {
      const latestAllowedNoLateStay = new Date(
        Math.min(
          midnight.getTime(),
          arrivalTime.getTime() + (7 * 60 + earlyArrivalMinutes) * 60000
        )
      );
      if (rawFinish.getTime() > latestAllowedNoLateStay.getTime()) {
        rawFinish = latestAllowedNoLateStay;
      }
    }

    const finishTime = rawFinish;
    let requiredPerformanceMinutes = 120;
    const planIndex = performancePlans?.[actData?._id]?.planIndex;
    const plan = actData?.performancePlans?.[planIndex];
    if (plan && plan.setLength && plan.numberOfSets) {
      const setLength = parseInt(plan.setLength) || 0;
      const numberOfSets = parseInt(plan.numberOfSets) || 0;
      const interval = parseInt(plan.interval) || 0;
      requiredPerformanceMinutes =
        numberOfSets * setLength + Math.max(0, numberOfSets - 1) * interval;
    }

    const availablePerformanceMinutes = Math.max(
      0,
      Math.round((finishTime - chosenStart) / 60000)
    );
    const notEnoughPerformanceWindow =
      availablePerformanceMinutes < requiredPerformanceMinutes;

    const ret = {
      setupTime,
      soundcheckTime,
      changeTime,
      arrivalTime,
      finishTime,
      needsEarlyArrival,
      notEnoughPerformanceWindow,
      theoreticalFinishNoClamp,
    };
    return ret;
  };

  useEffect(() => {
    if (!Array.isArray(cartDetails) || cartDetails.length === 0) return;
    if (!acts || acts.length === 0) return;
    const roundUpTo60 = (mins) => (mins <= 0 ? 0 : Math.ceil(mins / 60));
    const formatHoursLabel = (mins) => {
      if (mins % 60 === 0) {
        const h = Math.max(1, Math.round(mins / 60));
        return `${h} hour${h !== 1 ? "s" : ""}`;
      }
      const h = Math.floor(mins / 60);
      const m = mins % 60;
      return h > 0 ? `${h} hour${h !== 1 ? "s" : ""} ${m} mins` : `${m} mins`;
    };

    cartDetails.forEach((item) => {
      try {
        const times = calculateAdjustedTimes(
          item.lineup,
          item.selectedExtras,
          performancePlans[item.actId]?.startTime,
          performancePlans[item.actId]?.setupAndSoundcheckedBy,
          item.actData,
          performancePlans,
          selectedDate
        );

        const { arrivalTime, finishTime } = times || {};
        if (!arrivalTime || !finishTime) {
         
          
          return;
        }

        const eventBase = selectedDate ? new Date(selectedDate) : new Date();
        const midnight = new Date(
          eventBase.getFullYear(),
          eventBase.getMonth(),
          eventBase.getDate() + 1,
          0,
          0,
          0,
          0
        );


        const dismissed = new Set(item.dismissedExtras || []);
        const keyId = makeKey(item.actId, item.lineupId);

        const setOrRemoveExtra = (key, desired) => {
          if (dismissed.has(key)) {
            if (autoAddedFlags[keyId]) {
              setAutoAddedFlags((prev) => {
                const next = { ...prev };
                delete next[keyId];
                return next;
              });
            }
            if (desired) {
            }
            const existing = (item.selectedExtras || []).find(
              (e) => e.key === key
            );
            if (!desired && !existing) {
            }
            return;
          }
          const existing = (item.selectedExtras || []).find(
            (e) => e.key === key
          );

          if (!desired) {
            if (!existing) {
              return;
            }
            mergedUpdateExtras(item.actId, item.lineupId, {
              key,
              quantity: 0,
              price: 0,
            });
            setAutoAddedFlags((prev) => {
              const next = { ...prev };
              delete next[keyId];
              return next;
            });
            return;
          }

          const same =
            existing &&
            existing.quantity === desired.quantity &&
            existing.price === desired.price &&
            existing.name === desired.name;

          if (same) {
            return;
          }
          mergedUpdateExtras(item.actId, item.lineupId, { key, ...desired });

          if (key === "late_stay_60min_per_band_member") {
            markAutoAdded(item.actId, item.lineupId, "late");
          } else if (key === "early_arrival_60min_per_band_member") {
            markAutoAdded(item.actId, item.lineupId, "early");
          }
        };

// Use the actual chosen finish (UI override if present, otherwise the clamped default)
const finishForLateCalc = finishTime;

// ── LATE STAY ───────────────────────────────
// Charge ONLY for time on site past midnight
const minutesPastMidnight = Math.max(
  0,
  Math.round((finishForLateCalc.getTime() - midnight.getTime()) / 60000)
);
const lateBlocks = roundUpTo60(minutesPastMidnight);
        if (lateBlocks > 0) {
          const members = Array.isArray(item?.lineup?.bandMembers)
            ? item.lineup.bandMembers.filter((m) => !isManagerLike(m)).length
            : 0;
          const per60Net = resolvePerMemberNet(
            item.actData,
            "late_stay_60min_per_band_member",
            Number(item?.lineup?.lateStayFeePer60) || 0
          );
          const totalMins = lateBlocks * 60;
          const price = Math.ceil((per60Net * members * lateBlocks) / 0.75);
          setOrRemoveExtra("late_stay_60min_per_band_member", {
            name: `Late Stay - ${formatHoursLabel(totalMins)}`,
            quantity: 1,
            price,
          });
        } else {
          setOrRemoveExtra("late_stay_60min_per_band_member", null);
        }

        // ── EARLY ARRIVAL ───────────────────────────
        // Charge early arrival for time before the standard 17:00 arrival.
        const standardArrival = new Date(
          eventBase.getFullYear(),
          eventBase.getMonth(),
          eventBase.getDate(),
          17,
          0,
          0,
          0
        );

        const minutesBeforeStandard = Math.max(
          0,
          Math.round(
            (standardArrival.getTime() - arrivalTime.getTime()) / 60000
          )
        );
        const earlyBlocks = roundUpTo60(minutesBeforeStandard);

        if (earlyBlocks > 0) {
          const members = Array.isArray(item?.lineup?.bandMembers)
            ? item.lineup.bandMembers.filter((m) => !isManagerLike(m)).length
            : 0;
          const per60Net = resolvePerMemberNet(
            item.actData,
            "early_arrival_60min_per_band_member",
            Number(item?.lineup?.earlyArrivalFeePer60) || 0
          );
          const totalMins = earlyBlocks * 60;
          const price = Math.ceil((per60Net * members * earlyBlocks) / 0.75);
          setOrRemoveExtra("early_arrival_60min_per_band_member", {
            name: `Early Arrival - ${formatHoursLabel(totalMins)}`,
            quantity: 1,
            price,
          });
        } else {
          setOrRemoveExtra("early_arrival_60min_per_band_member", null);
        }

        const autoExtras = [
          "late_stay_60min_per_band_member",
          "early_arrival_60min_per_band_member",
        ];
        const stillDismissed = (item.dismissedExtras || []).filter((k) =>
          autoExtras.includes(k)
        );
        if (stillDismissed.length !== (item.dismissedExtras || []).length) {
          setCartItems((prev) => {
            const updated = { ...prev };
            if (updated[item.actId] && updated[item.actId][item.lineupId]) {
              updated[item.actId][item.lineupId].dismissedExtras =
                stillDismissed;
            }
            return updated;
          });
        }

       
      } catch (e) {
      }
    });
  }, [
    cartDetails,
    mergedUpdateExtras,
    selectedDate,
    setCartItems,
    performancePlans,
  ]);

  useEffect(() => {
    setPerformancePlans((prev) => {
      let next = prev;
      (cartDetails || []).forEach((item) => {
        const paExtra =
          cartItems?.[item.actId]?.[item.lineupId]?.selectedExtras?.find(
            (e) => e.key === "pa_late_stay"
          ) ||
          (item.selectedExtras || []).find((e) => e.key === "pa_late_stay");

        if (paExtra?.finishTime) {
          const offset = paExtra.finishTime < "12:00" ? 1 : 0;
          const cur = next[item.actId] || {};
          if (
            cur.paLightsFinishTime !== paExtra.finishTime ||
            (cur.paLightsFinishDayOffset ?? 0) !== offset
          ) {
            next = {
              ...next,
              [item.actId]: {
                ...cur,
                paLightsFinishTime: paExtra.finishTime,
                paLightsFinishDayOffset: offset,
              },
            };
          }
        }
      });
      return next;
    });

    setCartItems((prev) => {
      let changed = false;
      const next = { ...prev };

      (cartDetails || []).forEach((item) => {
        const actId = item.actId;
        const lineupId = item.lineupId;
        const paExtra =
          prev?.[actId]?.[lineupId]?.selectedExtras?.find(
            (e) => e.key === "pa_late_stay"
          ) ||
          (item.selectedExtras || []).find((e) => e.key === "pa_late_stay");

        if (!paExtra?.finishTime) return;

        const offset = paExtra.finishTime < "12:00" ? 1 : 0;

        const actBlock = next[actId] || {};
        const lineupBlock = actBlock[lineupId] || {};
        const perf = lineupBlock.performance || {};

        if (
          perf.paLightsFinishTime !== paExtra.finishTime ||
          (perf.paLightsFinishDayOffset ?? 0) !== offset
        ) {
          next[actId] = {
            ...actBlock,
            [lineupId]: {
              ...lineupBlock,
              performance: {
                ...perf,
                paLightsFinishTime: paExtra.finishTime,
                paLightsFinishDayOffset: offset,
              },
            },
          };
          changed = true;
        }
      });

      return changed ? next : prev;
    });
  }, [cartDetails, cartItems, setPerformancePlans, setCartItems]);

  // --- availability-aware entries ---
// Hide acts that are explicitly unavailable for the selected date
const displayCartDetails = Array.isArray(cartDetails)
  ? cartDetails.filter((item) => !isActUnavailableForSelectedDate(item.actId))
  : [];

  return (
    <div className="border-t pt-14">
      <div className="text-2xl mb-3">
        <Title text1={"BOOKING"} text2={"DETAILS"} />
      </div>

      {selectedDate && selectedAddress ? (
        <>
          <p className="text-lg font-medium mt-3 p-2 text-gray-600">
            Date:{" "}
            <span className="text-gray-700">{formatDate(selectedDate)}</span>
          </p>
          <p className="text-lg font-medium p-2 text-gray-600">
            Venue: <span className="text-gray-700">{selectedAddress}</span>
          </p>
          <div className="flex flex-col sm:flex-row items-left gap-2 text-lg font-medium justify-right p-2 text-gray-600">
            <p>Event Type:</p>
            <div className="flex gap-2">
              <select
                value={selectedEventType}
                onChange={(e) => setSelectedEventType(e.target.value)}
                className="border px-2 py-1 text-lg rounded text-gray-700 flex-1"
              >
                <option>Wedding</option>
                <option>Israeli Wedding</option>
                <option>Private Party</option>
                <option>Corporate Event</option>
                <option>Award Ceremony</option>
                <option>HM Forces Event</option>
                <option>Summer Ball</option>
                <option>Winter Ball</option>
                <option>Christmas Party</option>
                <option>Festival</option>
                <option>Other</option>
              </select>
              {selectedEventType === "Other" && (
                <input
                  type="text"
                  placeholder="Enter custom event type"
                  value={customEventType}
                  onChange={(e) => setCustomEventType(e.target.value)}
                  className="border px-2 py-1 text-sm rounded font-medium flex-1"
                />
              )}
            </div>
          </div>
        </>
      ) : (
        <p className="text-sm mt-3 p-2 text-gray-600">
          Please select a date and location to checkout
          <span
            onClick={triggerSearch}
            className="text-blue-600 cursor-pointer underline ml-2"
          >
            Add my date and location
          </span>
        </p>
      )}

      <div className="flex flex-col gap-6 text-lg">
        {selectedDate && availLoading && (
  <div className="p-4 text-center text-gray-600">Checking availability…</div>
)}

{displayCartDetails.length === 0 ? (
  <div className="p-8 text-center text-gray-700">
    <p className="text-xl">Your cart is empty</p>
    <p className="mt-2 text-gray-500">
      Add an act to your cart and let’s get this show on the road!
    </p>
    <button
      onClick={() => navigate("/acts") }
      className="mt-4 px-6 py-3 rounded bg-black text-white hover:bg-[#ff6667] transition"
    >
      Browse acts
    </button>
  </div>
) : (
  <div className="flex flex-col gap-6 text-lg">
    {displayCartDetails.map((item, index) => {
 
          const availableLineups = Array.isArray(item.allLineups)
            ? item.allLineups
            : [];

          const autoManagedKeys = new Set([
            "late_stay_60min_per_band_member",
            "early_arrival_60min_per_band_member",
            "pa_late_stay",
            // ceremony & afternoon performance bundles are priced upstream in AcousticExtrasSelector
            "ceremony_performance",
            "afternoon_performance",
          ]);
          const pricedExtras = (item.selectedExtras || []).map((ex) => {
            if (autoManagedKeys.has(ex.key)) {
              // Trust upstream price/label provided by AcousticExtrasSelector or auto logic
              return ex;
            }
            const unitNet = calculateExtraPrice({
              extra: ex,
              act: item.actData,
              lineup: item.lineup,
              address: selectedAddress,
              date: selectedDate,
            });
            const unitGross = Math.ceil(Number(unitNet || 0) / 0.75);
            const qty = Math.max(1, Number(ex.quantity || 1));
            return { ...ex, price: unitGross * qty };
          });

          const times = calculateAdjustedTimes(
            item.lineup,
            item.selectedExtras,
            performancePlans[item.actId]?.startTime,
            performancePlans[item.actId]?.setupAndSoundcheckedBy,
            item.actData,
            performancePlans,
            selectedDate
          );

          // Pull performance values saved in cart (if any)
          const perfFromCart =
            cartItems[item.actId]?.[item.lineupId]?.performance || {};
          const arrivalFromCart =
            typeof perfFromCart.arrivalTime === "string"
              ? perfFromCart.arrivalTime
              : "";

          return (
            <div
              key={item.actId}
              className="relative flex flex-col sm:flex-row bg-white shadow rounded-lg p-4"
            >
              {/* Mobile: show remove button above the thumbnail, not absolute */}
              <div className="mb-2 -mt-2 flex justify-end md:hidden">
                <button
                  onClick={() => removeFromCart(item.actId, item.lineupId)}
                  title="Remove Act"
                  className="p-1 rounded hover:bg-red-50"
                >
                  <img
                    src={assets.bin_icon}
                    alt="Delete"
                    className="w-5 h-5 opacity-70 hover:opacity-100"
                  />
                </button>
              </div>

              {/* Desktop/tablet: keep absolute button in the card corner */}
              <button
                onClick={() => removeFromCart(item.actId, item.lineupId)}
                title="Remove Act"
                className="hidden md:block absolute top-2 right-2 p-1 rounded hover:bg-red-50"
              >
                <img
                  src={assets.bin_icon}
                  alt="Delete"
                  className="w-5 h-5 opacity-70 hover:opacity-100"
                />
              </button>
<div className="flex flex-col md:flex-row gap-4 items-start w-full">
{item.image && (
  <div className="w-full md:w-auto">
    <img
      src={item.image?.url || item.image || ""}
      alt={item.actName}
      className="w-full md:w-40 h-52 md:h-40 object-cover rounded"
      loading="lazy"
      onError={(e) => (e.target.style.display = "none")}
      onClick={() => navigate(`/act/${item.actId}`)}
      style={{ cursor: "pointer" }}
    />
  </div>
)}
<div className="w-full md:flex-1">

                <div className="flex flex-col w-full flex-1 overflow-hidden">
                  <p className="text-2xl text-gray-700 font-medium">
                    {item.actName}
                  </p>
                  {/* Availability badge */}
                  {availabilityStatus?.[item.actId]?.status && (
                    <div
                      className={`mt-1 inline-flex items-center gap-2 rounded px-2 py-1 text-sm ${
                        availabilityStatus[item.actId].status === "lead"
                          ? "bg-green-100 text-green-800"
                          : "bg-blue-100 text-blue-800"
                      }`}
                    >
                      <span className="inline-block h-2 w-2 rounded-full bg-current" />
                      <span>{availabilityStatus[item.actId].message}</span>
                    </div>
                  )}

                  {(() => {
                    const times = calculateAdjustedTimes(
                      item.lineup,
                      item.selectedExtras,
                      performancePlans[item.actId]?.startTime,
                      performancePlans[item.actId]?.setupAndSoundcheckedBy,
                      item.actData,
                      performancePlans,
                      selectedDate
                    );
                    return (
                      <>
                        {cartItems?.[item.actId]?.[item.lineupId]
                          ?.selectedAfternoonSets?.length > 0 && (
                          <div className="mt-2 border-b-1 ml-2">
                            <h2 className="font-semibold text-lg text-gray-700 mt-4 border-b-2 pb-3">
                              {(() => {
                                const setTypes = cartItems[item.actId][
                                  item.lineupId
                                ].selectedAfternoonSets
                                  .map((set) => set.type)
                                  .filter(Boolean);
                                const uniqueTypes = [...new Set(setTypes)];
                                if (uniqueTypes.includes("both"))
                                  return "Ceremony & Afternoon Performances";
                                if (
                                  uniqueTypes.includes("ceremony") &&
                                  uniqueTypes.includes("afternoon")
                                )
                                  return "Ceremony & Afternoon Performances";
                                if (uniqueTypes.includes("ceremony"))
                                  return "Ceremony Performance";
                                if (uniqueTypes.includes("afternoon"))
                                  return "Afternoon Performance";
                                return "Acoustic Performances";
                              })()}
                            </h2>
                            <div className="text-gray-700 text-base whitespace-pre-line p-2">
                              {cartItems[item.actId][
                                item.lineupId
                              ].selectedAfternoonSets
                                .filter((set) => set?.name)
                                .map((set, idx) => {
                                  const displayName = set.name
                                    ?.replace(
                                      /^Ceremony & Afternoon Performances:\s*- /,
                                      ""
                                    )
                                    .replace(/^Ceremony Performance:\s*- /, "")
                                    .replace(
                                      /^Afternoon Performance:\s*- /,
                                      ""
                                    );

                                  return (
                                    <div
                                      key={idx}
                                      className="flex justify-between items-center pr-2"
                                    >
                                      <div className="flex">
                                        {" "}
                                        <span className="text-gray-700 text-base whitespace-pre-line">
                                          - {displayName}
                                        </span>
                                        <div className="flex items-center">
                                          <button
                                            className="text-gray-400 hover:text-red-500 text-sm flex items-center"
                                            onClick={() => {
                                              const updated = { ...cartItems };
                                              const currentSets =
                                                updated[item.actId][
                                                  item.lineupId
                                                ].selectedAfternoonSets || [];
                                              updated[item.actId][
                                                item.lineupId
                                              ].selectedAfternoonSets =
                                                currentSets.filter(
                                                  (s) => s.key !== set.key
                                                );
                                              setCartItems(updated);
                                            }}
                                          >
                                            <img
                                              className="w-3 h-3 ml-2"
                                              src={assets.cross_icon}
                                              alt="Remove"
                                            />
                                          </button>
                                        </div>
                                      </div>
                                      <div className="flex items-center gap-2">
                                        <span className="text-sm text-gray-700 whitespace-nowrap">
                                          £{set.price}
                                        </span>
                                      </div>
                                    </div>
                                  );
                                })}
                            </div>
                            <h2 className="font-semibold text-lg text-gray-700 mt-4 border-b-2 pb-3">
                              Main Performance
                            </h2>
                          </div>
                        )}

                     <div className="flex items-center justify-between w-full gap-4 mt-2">
  <div className="w-full flex flex-col">
    <label className="block font-semibold text-gray-600 text-base mb-1 mt-2">
      Lineup:
    </label>
    <div className="w-full">
      <select
        className="w-flex border rounded px-2 py-1 ml-2 text-sm text-gray-700"
        value={normLineupId(item.lineup)}
        onChange={(e) =>
          handleLineupChange(
            item.actId,
            normLineupId(item.lineup),
            idToString(e.target.value)
          )
        }
      >
        {availableLineups.map((l) => {
          const val = normLineupId(l);
          return (
            <option key={val} value={val}>
              {l.actSize ||
                (Array.isArray(l.bandMembers)
                  ? `${l.bandMembers.length}-Piece`
                  : "Lineup")}
            </option>
          );
        })}
      </select>
    </div>
  </div>

  <span className="text-sm text-gray-700 whitespace-nowrap pr-2">
    £
    {Number(item.adjustedTotal ?? item.subtotalWithMargin ?? 0)}
  </span>
</div>
                        <div className="flex items-center justify-between w-[80%] gap-4 ml-2 mb-2">
                          <p className="text-sm text-gray-600 mt-1">
                            {generateDescription(item.lineup)}
                          </p>
                          {availabilityStatus?.[item.actId]?.status ===
                            "deputy" && (
                            <p className="text-sm text-blue-700 ml-4 mt-1">
                              {availabilityStatus[item.actId].message}
                              {/* Optional: link to deputy profile once you pass musicianId via SSE */}
                              {/* {' '}— <a className="underline" href={`/musician/${encodeURIComponent(availabilityStatus[item.actId]?.musicianId || '')}`}>view profile</a> */}
                            </p>
                          )}
                        </div>

               <div className="w-full max-w-xs sm:max-w-none">

  <label className="block font-semibold text-gray-600 text-base mb-1 mt-2">
    Arrival Time
  </label>
  <div className="w-full ml-2">
    <CustomTimePicker
      value={
        arrivalFromCart ||
        performancePlans[item.actId]?.arrivalTime ||
        toHHMM(times.arrivalTime) ||
        ""
      }
      onChange={(newTime) => {
        // Persist into cart
        updatePerformance(item.actId, item.lineupId, { arrivalTime: newTime });
        // Mirror into local planner state
        setPerformancePlans((prev) => ({
          ...prev,
          [item.actId]: {
            ...prev[item.actId],
            arrivalTime: newTime,
          },
        }));
      }}
    />
  </div>
</div>
                        <div className="flex flex-row gap-1">
                          <label className="font-semibold block text-gray-600 text-base mt-2 ">
                            Setup Time Required:{" "}
                          </label>
                          <p className="text-gray-600 text-base pt-2">
                            {times.setupTime} mins
                          </p>
                        </div>
                        <div className="flex flex-row gap-1">
                          <label className="font-semibold block text-gray-600 text-base mt-2">
                            Soundcheck Time Required:{" "}
                          </label>
                          <p className="text-gray-600 text-base mt-2">
                            {times.soundcheckTime} mins
                          </p>
                        </div>
                        <div className="flex flex-row gap-1">
                          <label className="font-semibold block text-gray-600 text-base mt-2">
                            Change Time Required:
                          </label>
                          <p className="text-gray-700 text-base pt-2">
                            {times.changeTime} mins
                          </p>
                        </div>

              <div className="w-full max-w-xs sm:max-w-none">
                <label className="block font-semibold text-gray-600 text-base mb-1 mt-2">
                  Setup &amp; Soundchecked By:
                </label>
                <div className="w-full ml-2">
                  {(() => {
                    // Base arrival (cart → plan → calculated → fall back 17:00)
                    const perf = cartItems[item.actId]?.[item.lineupId]?.performance || {};
                    const arrivalHHMM =
                      perf.arrivalTime ||
                      performancePlans[item.actId]?.arrivalTime ||
                      toHHMM(times.arrivalTime) ||
                      "17:00";

                    // Total pre-show minutes from lineup/times
                    const totalPre =
                      (times.setupTime || 0) + (times.soundcheckTime || 0) + (times.changeTime || 0);

                    // Minimum “setup complete” time (usually 19:30)
                    const { hhmm: setupMinHHMM } = addMinutesHHMM(arrivalHHMM, totalPre);

                    return (
                      <CustomTimePicker
                        value={
                          (cartItems[item.actId]?.[item.lineupId]?.performance?.setupAndSoundcheckedBy) ||
                          // default = arrival + (setup + soundcheck + change)
                          addMinutesHHMM(
                            (cartItems[item.actId]?.[item.lineupId]?.performance?.arrivalTime) ||
                            performancePlans[item.actId]?.arrivalTime ||
                            toHHMM(times.arrivalTime) ||
                            "17:00",
                            (times.setupTime || 0) + (times.soundcheckTime || 0) + (times.changeTime || 0)
                          ).hhmm
                        }
                        minHHMM={
                          addMinutesHHMM(
                            (cartItems[item.actId]?.[item.lineupId]?.performance?.arrivalTime) ||
                            performancePlans[item.actId]?.arrivalTime ||
                            toHHMM(times.arrivalTime) ||
                            "17:00",
                            (times.setupTime || 0) + (times.soundcheckTime || 0) + (times.changeTime || 0)
                          ).hhmm
                        }
                        minDayOffset={0}
                        onChange={(newTime) => {
                          updatePerformance(item.actId, item.lineupId, { setupAndSoundcheckedBy: newTime });
                          setPerformancePlans((prev) => ({
                            ...prev,
                            [item.actId]: { ...prev[item.actId], setupAndSoundcheckedBy: newTime },
                          }));
                        }}
                      />
                    );
                  })()}
                </div>
              </div>

      <div className="w-full max-w-xs sm:max-w-none">
        <label className="block font-semibold text-gray-600 text-base mb-1 mt-2">
          Start Time
        </label>
        <div className="w-full ml-2">
          {(() => {
            const arrivalHHMM =
              (cartItems[item.actId]?.[item.lineupId]?.performance?.arrivalTime) ||
              performancePlans[item.actId]?.arrivalTime ||
              toHHMM(times.arrivalTime) ||
              "17:00";

            const totalPre = (times.setupTime || 0) + (times.soundcheckTime || 0) + (times.changeTime || 0);
            const { hhmm: setupMinHHMM } = addMinutesHHMM(arrivalHHMM, totalPre);
            const { hhmm: startMinHHMM, dayOffset: startMinOffset } = addMinutesHHMM(setupMinHHMM, 15);

            return (
              <CustomTimePicker
                value={
                  (cartItems[item.actId]?.[item.lineupId]?.performance?.startTime) ||
                  startMinHHMM
                }
                minHHMM={startMinHHMM}
                minDayOffset={startMinOffset}
                onChange={(newTime) => {
                  updatePerformance(item.actId, item.lineupId, { startTime: newTime });
                  setPerformancePlans((prev) => ({
                    ...prev,
                    [item.actId]: { ...prev[item.actId], startTime: newTime },
                  }));
                }}
              />
            );
          })()}
        </div>
      </div>
<div className="w-full max-w-xs sm:max-w-none">
  <label className="block font-semibold text-gray-600 text-base mb-1 mt-2">
    Act Finish Time
  </label>
  <div className="w-full ml-2">
    {(() => {
      const perf = cartItems[item.actId]?.[item.lineupId]?.performance || {};
      const startHHMM =
        perf.startTime ||
        performancePlans[item.actId]?.startTime ||
        "";

      const hasSavedFinish =
        typeof perf.finishTime === "string" && perf.finishTime.includes(":");

      return (
        <CustomTimePicker
          value={hasSavedFinish ? perf.finishTime : "00:00"}
          enableDayOffset
          dayOffset={
            hasSavedFinish
              ? (Number.isInteger(perf.finishDayOffset) ? perf.finishDayOffset : 0)
              : 1
          }
          onDayOffsetChange={(v) => {
            updatePerformance(item.actId, item.lineupId, { finishDayOffset: v });
            setPerformancePlans((prev) => ({
              ...prev,
              [item.actId]: { ...prev[item.actId], finishDayOffset: v },
            }));
          }}
          minHHMM={startHHMM || null}
          minDayOffset={0}
          onChange={(newTime) => {
            updatePerformance(item.actId, item.lineupId, { finishTime: newTime });
            setPerformancePlans((prev) => ({
              ...prev,
              [item.actId]: { ...prev[item.actId], finishTime: newTime },
            }));
          }}
        />
      );
    })()}
  </div>
</div>
                        {(() => {
                          const perfFromCart =
                            cartItems?.[item.actId]?.[item.lineupId]
                              ?.performance || {};
                          const plan = performancePlans[item.actId] || {};

                          // Prefer values from cart (persisted), fallback to planner state
                          const arrival =
                            perfFromCart.arrivalTime ||
                            plan.arrivalTime ||
                            null;
                          const finish =
                            perfFromCart.finishTime || plan.finishTime || null;

                          const setupComplete =
                            perfFromCart.setupAndSoundcheckedBy ||
                            plan.setupAndSoundcheckedBy;

                          if (!setupComplete || !arrival || !finish)
                            return null;

                          // Convert HH:MM → Date for math
                          const parseToDate = (hhmm) => {
                            if (!hhmm || !hhmm.includes(":")) return null;
                            const [h, m] = hhmm.split(":").map(Number);
                            const d = new Date();
                            d.setHours(h, m, 0, 0);
                            return d;
                          };

                          const arrivalDate = parseToDate(arrival);
                          const finishDate = parseToDate(finish);
                          if (!arrivalDate || !finishDate) return null;

                          let totalTimeOnSite =
                            (finishDate - arrivalDate) / 60000; // minutes
                          if (totalTimeOnSite < 0) {
                            // Handle overnight (finish past midnight)
                            totalTimeOnSite += 24 * 60;
                          }

                          const hasExtension = (item.selectedExtras || []).some(
                            (e) =>
                              e.key === "early_arrival_60min_per_band_member" ||
                              e.key === "late_stay_60min_per_band_member"
                          );

                          const needsNote =
                            totalTimeOnSite > 420 && !hasExtension; // >7 hours

                          if (!needsNote) return null;

                          const formattedHours = Math.floor(
                            totalTimeOnSite / 60
                          );
                          const formattedMinutes = totalTimeOnSite % 60;

                          return (
                            <div className="mt-2 bg-yellow-100 text-yellow-800 border border-yellow-300 rounded p-2 text-sm">
                              ⚠️ <strong>{item.actName}</strong> may not be able
                              to complete their full performance in their
                              contracted time on site (currently{" "}
                              {formattedHours}h {formattedMinutes}m).
                              <br />
                              Please add an <strong>Early Arrival</strong> if
                              they need to be onsite before 5pm, or a{" "}
                              <strong>Late Stay</strong> for post-midnight
                              performances.
                            </div>
                          );
                        })()}
                      </>
                    );
                  })()}

                  {(() => {
                    // 1) Detect PA/Lights presence from catalogue values on this act
                    const paRaw = String(item?.actData?.paSystem ?? "").trim();
                    const lightRaw = String(
                      item?.actData?.lightingSystem ?? ""
                    ).trim();

                    // Only treat these specific keys as “has system”
                    const hasPA = ["smallPA", "mediumPA", "largePA"].includes(
                      paRaw
                    );
                    const hasLights = [
                      "smallLight",
                      "mediumLight",
                      "largeLight",
                    ].includes(lightRaw);

                    // 2) Prefer values saved on cartItems.performance; fall back to planner state
                    const perf =
                      cartItems?.[item.actId]?.[item.lineupId]?.performance ??
                      {};
                    const plan = performancePlans[item.actId] ?? {};

                    const paFinish =
                      (typeof perf.paLightsFinishTime === "string" &&
                        perf.paLightsFinishTime) ||
                      (typeof plan.paLightsFinishTime === "string" &&
                        plan.paLightsFinishTime) ||
                      "";

                    const paFinishOffset = Number.isInteger(
                      perf.paLightsFinishDayOffset
                    )
                      ? perf.paLightsFinishDayOffset
                      : Number.isInteger(plan.paLightsFinishDayOffset)
                        ? plan.paLightsFinishDayOffset
                        : 0;

                    // 3) Nothing to show if no systems or no time set
                    if (!(hasPA || hasLights)) return null;
                    if (!paFinish) return null;

                    // 4) Render
                    return (
                      <div className="flex items-center gap-2">
                        <label className="font-semibold block text-gray-600 text-base p-2 ml-2">
                          {hasPA && hasLights
                            ? "PA & Lights Finish Time:"
                            : hasPA
                              ? "PA Finish Time:"
                              : "Lights Finish Time:"}
                        </label>
                        <span className="text-base text-gray-700 p-2">
                          {paFinish}
                          {paFinishOffset === 1 ? " (next day)" : ""}
                        </span>
                      </div>
                    );
                  })()}

                  {/* Performance Plan */}
                 <div className="w-full flex flex-col mt-2">
                    <label className="font-semibold text-gray-600 text-base">
                      Performance Plan:
                    </label>
                    <div className="w-full mt-1">
                      <select
                        className="w-flex border rounded px-3 py-1 text-sm text-gray-700"
                        value={
                          (cartItems?.[item.actId]?.[item.lineupId]?.performance?.planIndex ??
                            performancePlans[item.actId]?.planIndex ??
                            "")
                        }
                        onChange={(e) =>
                          handlePerformancePlanChange(
                            item.actId,
                            item.lineupId,
                            e.target.value,
                            item.actData
                          )
                        }
                      >
                        {(item.actData?.numberOfSets || []).map((sets, i) => {
                          const length = item.actData.lengthOfSets[i];
                          const interval = item.actData.minimumIntervalLength[i];
                          if (sets && length && interval) {
                            return (
                              <option key={i} value={i}>
                                {sets}x {length} mins sets,{' '}
                                {sets > 2
                                  ? `with at least ${interval}-min breaks`
                                  : `with at least a ${interval}-min break`}
                              </option>
                            );
                          }
                          return null;
                        })}
                        <option value="">TBC</option>
                      </select>
                    </div>
                  </div>

                  {/* Complimentary Inclusions */}
                  {(() => {
                    const comp =
                      item.actData?.extras?.complimentary ||
                      (item.actData?.extras?.background_music_playlist
                        ?.complimentary
                        ? "background_music_playlist"
                        : null);
                    const offReq = item.actData?.offRepertoireRequests;
                    const paSize = item.actData?.paSystem;
                    const lightSize = item.actData?.lightingSystem;

                    if (!comp && !offReq && !paSize && !lightSize) return null;

                    const formatSystem = (type) => {
                      switch (type) {
                        case "smallPA":
                        case "smallLight":
                          return "a small";
                        case "mediumPA":
                        case "mediumLight":
                          return "a medium";
                        case "largePA":
                        case "largeLight":
                          return "a large";
                        default:
                          return "";
                      }
                    };

                    const paLabel = paSize
                      ? `${formatSystem(paSize)} PA system`
                      : "";
                    const lightLabel = lightSize
                      ? `${formatSystem(lightSize)} lighting system`
                      : "";

                    const inclusions = [
                      comp === "background_music_playlist"
                        ? "Background music playlist"
                        : comp
                          ? "complimentary extras"
                          : null,
                      offReq
                        ? `${offReq} special request${offReq > 1 ? "s" : ""}`
                        : null,
                      paLabel,
                      lightLabel,
                    ]
                      .filter(Boolean)
                      .join(", ");

                    return (
                      <div className="flex flex-row gap-2">
                        <label className="font-semibold block text-gray-600 text-base mt-2">
                          Complimentary Inclusions:
                        </label>
                        <span className="text-gray-700 text-base pt-2">
                          {inclusions}
                        </span>
                      </div>
                    );
                  })()}

                  {cartItems?.[item.actId]?.[item.lineupId]?.songSuggestions
                    ?.length > 0 && (
                    <div className="flex flex-row gap-2">
                      <p className="font-semibold block text-gray-600 text-base p-2 ml-2">
                        Setlist Suggestions:
                      </p>
                      <ul className="list-disc list-inside text-gray-700 text-base pt-2">
                        {cartItems[item.actId][
                          item.lineupId
                        ].songSuggestions.map((song, idx) => (
                          <li key={`${song.title}-${idx}`}>
                            {song.title} – {song.artist}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  <div className="w-full">
                    {/* Enhance Your Booking - EXTRAS Carousel */}
                    <ExtrasCarousel
                      extras={item.actData.extras}
                      pricedExtras={pricedExtras}
                      selectedExtras={item.selectedExtras}
                      lineup={item.lineup}
                      cartItems={cartItems}
                      setCartItems={setCartItems}
                      actId={item.actId}
                      lineupId={item.lineupId}
                      updateExtras={mergedUpdateExtras}
                      actName={item.actName}
                      allLineups={item.allLineups}
                      selectedAddress={selectedAddress}
                      actData={item.actData}
                      onPaFinishChange={handleOverridePaFinishTime}
                      onOverridePaFinishTime={handleOverridePaFinishTime}
                      onOverrideFinishTime={handleOverrideFinishTime}
                      onLateStayRemoved={() => clearFinishOverride(item.actId)}
                      onOverrideArrivalTime={(actId, lineupId, { hhmm }) => {
                        setPerformancePlans((prev) => ({
                          ...prev,
                          [actId]: {
                            ...prev[actId],
                            arrivalTime: hhmm,
                          },
                        }));
                      }}
                    />
                  </div>
                </div>
              </div>
            </div>
            </div>
          );
         })}
  </div>
)}
      
        
      </div>

      {/* Cart Total and Payment Info */}
      <div className="flex flex-col sm:flex-row justify-end my-20 gap-8">
        {/* Payment Info Box */}
        <div className="w-full sm:w-auto sm:max-w-[400px] bg-white border border-gray-200 rounded-md p-4 shadow-sm text-sm text-gray-700 self-start">
          <h3 className="font-semibold text-gray-800 mb-2 text-base">
            Payment Options
          </h3>
          <ul className="list-disc list-inside space-y-2">
            <li>
              We accept card payments via <strong>Stripe</strong>.
            </li>
            <li>
              You can also pay with <strong>PayPal</strong> (including{" "}
              <strong>PayPal Pay in 3</strong>) and <strong>Klarna</strong> via
              Stripe where available. Eligibility, approval and order limits are
              set by PayPal/Klarna and shown at checkout, and may involve a soft
              credit check.{" "}
            </li>
            <li>
              If your event is more than 28 days away, you’ll pay a deposit now
              and the remaining balance is due 14 days before your event. If
              your event is 28 days or fewer away, the full amount is payable at
              the time of booking.
            </li>
          </ul>
          <div className="flex flex-row items-center gap-2">
            <img
              src={assets.stripe}
              alt="Stripe Payments"
              className="mt-4 w-full max-w-[90px] mx-auto"
            />
            <img
              src={assets.paypal_pay_in_three}
              alt="PayPal Pay in 3"
              className="mt-2 w-full max-w-[90px] mx-auto"
            />
          </div>
          <div className="flex flex-row items-center gap-2">
            <img
              src={assets.klarna}
              alt="Klarna"
              className="mt-2 w-full max-w-[90px] mx-auto"
            />
          </div>
        </div>

        {/* Cart Summary and Button */}
        <div className="w-full sm:w-[450px]">
          <CartTotal />
          <div className="w-full text-end">
           <button
  onClick={() => {
    if (selectedDate && selectedAddress) {
      navigate("/place-booking");
    }
  }}
  className={`hidden sm:inline-block bg-black text-white text-sm my-8 px-8 py-3 rounded transition-colors duration-300 ${
    selectedDate && selectedAddress
      ? "hover:bg-[#ff6667] cursor-pointer"
      : "opacity-50 cursor-not-allowed"
  }`}
  disabled={!selectedDate || !selectedAddress}
>
  PROCEED TO BOOK
</button>
            {/* Mobile sticky footer */}
<div className="fixed bottom-0 left-0 right-0 bg-white p-4 shadow-inner md:hidden z-50">
  <button
    onClick={() => navigate("/place-booking")}
    className="w-full bg-black text-white font-semibold py-3 rounded shadow hover:bg-black transition"
  >
    PROCEED TO BOOK
  </button>
</div>
          </div>
        </div>
      </div>
    </div>
  );
};

function useMergedUpdateExtras(cartItems, setCartItems) {
  return useCallback(
    (actId, lineupId, extra) => {
      setCartItems((prev) => {
        // Fast path: if prev is empty and we're trying to remove, do nothing
        if (!extra || !actId || !lineupId) return prev;

        const prevAct = prev[actId];
        const prevLineup = prevAct?.[lineupId];
        const prevExtras = prevLineup?.selectedExtras || [];

        // Find existing entry (if any)
        const existingIdx = prevExtras.findIndex((e) => e.key === extra.key);
        const exists = existingIdx !== -1;

        // If removing (quantity is 0/falsy or extra is null) and it doesn't exist -> no change
        const isRemoval = !extra || Number(extra.quantity) <= 0;
        if (isRemoval && !exists) return prev;

        // If updating/adding and it already exists with identical payload -> no change
        if (
          !isRemoval &&
          exists &&
          prevExtras[existingIdx].quantity === extra.quantity &&
          prevExtras[existingIdx].price === extra.price &&
          prevExtras[existingIdx].name === extra.name
        ) {
          return prev;
        }

        // Build next state immutably, cloning only what we touch
        const next = { ...prev };
        const nextAct = { ...(prevAct || {}) };
        // Start from the existing lineup object so we don't drop other fields
        const nextLineup = {
          ...(prevLineup || {}),
          // Ensure quantity is preserved (default to 1 if truly missing)
          quantity: prevLineup?.quantity ?? 1,
          // Work on a cloned extras array
          selectedExtras: [...prevExtras],
        };

        if (isRemoval) {
          nextLineup.selectedExtras = nextLineup.selectedExtras.filter(
            (e) => e.key !== extra.key
          );
        } else if (exists) {
          nextLineup.selectedExtras[existingIdx] = { ...extra };
        } else {
          nextLineup.selectedExtras.push({ ...extra });
        }

        nextAct[lineupId] = nextLineup;
        next[actId] = nextAct;
       
        return next;
      });
    },
    [setCartItems]
  );
}

export default Cart;
