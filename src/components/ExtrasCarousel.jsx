import React, { useState, useContext } from "react";
import PropTypes from "prop-types";
import "keen-slider/keen-slider.min.css";
import { useKeenSlider } from "keen-slider/react";
import { assets } from "../assets/assets";
import { useNavigate } from "react-router-dom";
import AcousticExtrasSelector from "./AcousticExtrasSelector";
import { ShopContext } from "../context/ShopContext";
import { addMinutesHHMM, baselineFinishTime } from "../pages/utils/time";



const ExtrasCarousel = ({
  extras,
  selectedExtras,
  lineup,
  actId,
  lineupId,
  updateExtras,
  allLineups,
  selectedAddress,
  pricedExtras,
  actData,
  onLateStayRemoved,
  onOverrideFinishTime,
  onOverrideArrivalTime,
  onOverridePaFinishTime,
  
}) => {

  const [sliderRef, instanceRef] = useKeenSlider({
    loop: true,
    mode: "snap",
    // Base: phones (portrait & small devices) → exactly 1 slide
    slides: { perView: 1, spacing: 8 },
    // Progressive enhancements
    breakpoints: {
      // Tablets (≥768px)
      "(min-width: 768px)": {
        slides: { perView: 3, spacing: 12 },
      },
      // Small laptops (≥1024px)
      "(min-width: 1024px)": {
        slides: { perView: 4, spacing: 12 },
      },
      // Desktops (≥1280px)
      "(min-width: 1280px)": {
        slides: { perView: 6, spacing: 15 },
      
      },
    },
  });
  const [showCeremonyModal, setShowCeremonyModal] = useState(false);
  const { cartItems, setCartItems } = useContext(ShopContext);
  // Local state for PA Late Stay finish time choice (must be inside component)
  const [paFinishChoice, setPaFinishChoice] = useState("03:00");

 // Prefer live selection from cart (keeps buttons/list in sync even if parent prop lags)
const lineupCart = (cartItems?.[actId]?.[lineupId]) || {};
const liveSelectedExtras = Array.isArray(lineupCart.selectedExtras)
  ? lineupCart.selectedExtras
  : [];
// Fallback to prop if it already has content (e.g. previews)
const safeSelectedExtras =
  Array.isArray(selectedExtras) && selectedExtras.length
    ? selectedExtras
    : liveSelectedExtras;

const displayExtras = liveSelectedExtras;

// Helpers to exclude managers / non-performers from per-member time charges
const isManagerLike = (m = {}) => {
  const hasManagerWord = (s = "") => /\b(manager|management)\b/i.test(String(s));

  if (m.isManager === true || m.isNonPerformer === true) return true;

  if (hasManagerWord(m.instrument) || hasManagerWord(m.title)) return true;

  const rolesArr = Array.isArray(m.additionalRoles) ? m.additionalRoles : [];
  if (rolesArr.some((r) => hasManagerWord(r?.role) || hasManagerWord(r?.title))) return true;

  return false;
};

  // Calculate lineupSize early, ensure it's correct
// Calculate lineupSize using performers only (exclude managers / non-performers)
const lineupMembers = Array.isArray(lineup?.bandMembers) ? lineup.bandMembers : [];
const lineupPerformers = lineupMembers.filter(m => !isManagerLike(m));
const lineupSize = lineupPerformers.length;

const navigate = useNavigate();

  // 🎸 Extra Performance
  const extraPerformanceOptions = [
    {
      key: "extra_30min_performance_per_band_member",
      label: "30 mins",
      fee: parseFloat(extras["extra_30min_performance_per_band_member"] || 0),
    },
    {
      key: "extra_40min_performance_per_band_member",
      label: "40 mins",
      fee: parseFloat(extras["extra_40min_performance_per_band_member"] || 0),
    },
    {
      key: "extra_60min_performance_per_band_member",
      label: "60 mins",
      fee: parseFloat(extras["extra_60min_performance_per_band_member"] || 0),
    },
  ].filter((opt) => opt.fee > 0 && !isNaN(opt.fee));

  const djLiveOptions = [
    {
      key: "DJ_live_sax_3x30mins",
      label: "DJ + Live Sax",
      fee: parseFloat(extras["DJ_live_sax_3x30mins"] || 0),
    },
    {
      key: "DJ_live_bongos_3x30mins",
      label: "DJ + Live Bongos",
      fee: parseFloat(extras["DJ_live_bongos_3x30mins"] || 0),
    },
    {
      key: "DJ_live_bongos_and_sax_3x30mins",
      label: "DJ + Bongos & Sax",
      fee: parseFloat(extras["DJ_live_bongos_and_sax_3x30mins"] || 0),
    },
  ].filter((opt) => opt.fee > 0 && !isNaN(opt.fee));

  const [selectedDjOption, setSelectedDjOption] = useState(
    djLiveOptions[0]?.key || ""
  );
  const [selectedPerformance, setSelectedPerformance] = useState(
    extraPerformanceOptions[0]?.key || ""
  );
  // Add state for selectedDuration for the extra performance dropdown
  const [selectedDuration, setSelectedDuration] = useState("");

  // 🎚 Mic for Speeches (Dropdown for Wired/Wireless)
  const [selectedMicType, setSelectedMicType] = useState("");
  // Patch: local state for mic quantity and pending extra
  const [selectedMicQty, setSelectedMicQty] = useState("");
  const [pendingMicExtra, setPendingMicExtra] = useState(null);

  const getPerformancePrice = (selectedKey) => {
    const option = extraPerformanceOptions.find(
      (opt) => opt.key === selectedKey
    );
    if (!option) return 0;
    // Per band member
    const base = option.fee * lineupSize;
    return Math.ceil(base / 0.75);
  };

  const getDjPrice = (selectedKey) => {
    const option = djLiveOptions.find((opt) => opt.key === selectedKey);
    if (!option) return 0;
    // Not multiplied by lineupSize (charge is for one band member)
    return Math.ceil(option.fee / 0.75);
  };

  // Toggle Add/Remove for Extra Performance
  const handlePerformanceToggle = () => {
    const selectedOption = extraPerformanceOptions.find(
      (opt) => opt.key === selectedPerformance
    );
    const selectedPerf = safeSelectedExtras.find((e) =>
      extraPerformanceOptions.some((opt) => opt.key === e.key)
    );
    if (selectedPerf) {
      // Remove
      updateExtras(actId, lineupId, {
        name: selectedPerf.name,
        key: selectedPerf.key,
        price: 0,
        quantity: 0,
      });
      setSelectedPerformance(extraPerformanceOptions[0]?.key || "");
    } else if (selectedOption) {
      // Add
      updateExtras(actId, lineupId, {
        name: `Extra Performance - ${selectedOption.label}`,
        key: selectedOption.key,
        price: getPerformancePrice(selectedOption.key),
        quantity: 1,
      });
    }
  };

  // 🎯 Late Stay and Early Arrival
  const lateStayFeePer60 = parseFloat(
    extras["late_stay_60min_per_band_member"] || 0
  );
  const earlyArrivalFeePer60 = parseFloat(
    extras["early_arrival_60min_per_band_member"] || 0
  );

  // Pro-rata options generator for Late Stay and Early Arrival with dynamic maxMinutes
const generateTimeOptions = (minMinutes, basePrice, dynamicMaxMinutes = 180) => {
  const options = [];
  for (let i = minMinutes; i <= dynamicMaxMinutes; i += minMinutes) {
    const price = Math.ceil(((basePrice / 60) * i * lineupSize) / 0.75);
    
    // Format label as hours/mins
    let label;
    if (i % 60 === 0) {
      const hours = i / 60;
      label = `${hours} hour${hours > 1 ? "s" : ""}`;
    } else {
      const hours = Math.floor(i / 60);
      const mins = i % 60;
      label = hours > 0 
        ? `${hours} hour${hours > 1 ? "s" : ""} ${mins} mins`
        : `${mins} mins`;
    }

    options.push({ label, value: i, price });
  }
  return options;
};

  // Use pro-rata calculation for options with dynamic max minutes
  const lateStayOptions = generateTimeOptions(30, lateStayFeePer60, 180); // up to 3 hours = 180 mins
  const earlyArrivalOptions = generateTimeOptions(
    30,
    earlyArrivalFeePer60,
    480
  ); // up to 8 hours = 480 mins

  const [selectedLateStay, setSelectedLateStay] = useState(
    lateStayOptions[0]?.value || 30
  );
  const [selectedEarlyArrival, setSelectedEarlyArrival] = useState(
    earlyArrivalOptions[0]?.value || 30
  );

  // Helpers to read current arrival/finish from cart (fallbacks if missing)
  const getArrivalHHMM = () => {
    const a = cartItems?.[actId]?.[lineupId]?.arrivalTime;
    return typeof a === "string" && /\d{1,2}:\d{2}/.test(a) ? a : "17:00";
  };
  const getFinishHHMM = () => {
    const f = cartItems?.[actId]?.[lineupId]?.finishTime;
    if (typeof f === "string" && /\d{1,2}:\d{2}/.test(f)) return f;
    // baseline = min(midnight, arrival+7h)
    return baselineFinishTime(getArrivalHHMM());
  };

  // Toggle Add/Remove for Late Stay (no longer used, replaced by select below)

  // Toggle Add/Remove for Early Arrival (no longer used, replaced by select below)
  {
    /* --- Late Stay Slide --- */
  }
  <div className="keen-slider__slide bg-white border rounded p-2 flex flex-col justify-between shadow">
    <div className="overflow-hidden h-24 w-full rounded mb-2">
      <img
        src={assets.late_stay_icon}
        alt="Late Stay"
        className="w-full h-full object-cover transition-transform duration-300 ease-in-out hover:scale-110"
      />
    </div>
    <p className="text-sm font-medium text-center">Late Stay</p>
    <p className="text-sm text-gray-600 text-center">
      £{lateStayOptions[0]?.price || 0} / 60 mins{" "}
      <span className="text-xs">(per band member)</span>
    </p>
    <div className="flex items-center justify-center gap-2 mt-1">
      <label className="text-xs text-gray-600">Duration</label>
      <select
        className="border px-2 py-1 rounded text-sm"
        value={String(selectedLateStay)}
        onChange={(e) => {
          const minutes = parseInt(e.target.value || "0", 10) || 0;
          setSelectedLateStay(minutes);

          // 1) Update extras immediately
          const option = lateStayOptions.find((opt) => opt.value === minutes);
          if (option) {
            updateExtras(actId, lineupId, {
              name: `Late Stay - ${option.label}`,
              key: "late_stay_60min_per_band_member",
              price: option.price,
              quantity: 1,
              memberCount: lineupSize, // ✅ performers only
            });

            // 2) Bump Finish Time in Cart (cap at 03:00 next day)
            const baseFinish = baselineFinishTime(getArrivalHHMM());
            let { hhmm, dayOffset } = addMinutesHHMM(baseFinish, minutes);
            // Cap to 03:00 of next day
            if (dayOffset > 1 || (dayOffset === 1 && hhmm > "03:00")) {
              hhmm = "03:00";
              dayOffset = 1;
            }
            if (typeof onOverrideFinishTime === "function") {
              onOverrideFinishTime(actId, lineupId, { hhmm, dayOffset });
            } else {
              // best-effort local write so the dropdown reflects quickly
              setCartItems((prev) => {
                const u = { ...prev };
                if (u?.[actId]?.[lineupId]) {
                  u[actId][lineupId].finishTime = hhmm;
                  u[actId][lineupId].finishDayOffset = dayOffset;
                }
                return u;
              });
            }
          } // ← close if(option)
        }}
      >
        {lateStayOptions.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
    <button
      onClick={() => {
        // Remove late stay
        updateExtras(actId, lineupId, {
          name: "Late Stay",
          key: "late_stay_60min_per_band_member",
          price: 0,
          quantity: 0,
        });
        setSelectedLateStay(lateStayOptions[0]?.value || 30);
        // Reset finish time as well
        setCartItems((prev) => {
          const u = { ...prev };
          if (u?.[actId]?.[lineupId]) {
            u[actId][lineupId].finishTime =
              baselineFinishTime(getArrivalHHMM());
            u[actId][lineupId].finishDayOffset = 0;
          }
          return u;
        });
        if (typeof onLateStayRemoved === "function") {
          onLateStayRemoved(actId, lineupId);
        }
      }}
      className={`mt-2 px-4 py-2 text-base rounded text-white ${safeSelectedExtras.find((e) => e.key === "late_stay_60min_per_band_member") ? "bg-black" : "bg-gray-300 hover:bg-[#ff6667]"}`}
    >
      {safeSelectedExtras.find(
        (e) => e.key === "late_stay_60min_per_band_member"
      )
        ? "Remove"
        : "Add"}
    </button>
  </div>;



(() => {
  // Show if act has PA or lights (upsell either)
  const hasPA = Boolean(actData?.paSystem);
  const hasLights = Boolean(actData?.lightingSystem);
  if (!hasPA && !hasLights) return null;

  // Base price is the band-member late stay NET fee × 2 band members
  const lsRaw = actData?.extras?.get
    ? actData.extras.get("late_stay_60min_per_band_member")
    : actData?.extras?.["late_stay_60min_per_band_member"];
  const basePerMemberNet =
    typeof lsRaw === "number" ? lsRaw : (lsRaw?.price ?? 0);
  if (!basePerMemberNet) return null;

  // --- helpers for time conversion ---
  const parseMins = (hhmm) => {
    const [h, m] = String(hhmm || "00:00").split(":").map(Number);
    return (h || 0) * 60 + (m || 0);
  };
  const to12h = (hhmm) => {
    const [H, M] = String(hhmm || "00:00").split(":").map(Number);
    let h = H % 12;
    if (h === 0) h = 12;
    const suffix = H >= 12 ? "pm" : "am";
    return `${h}:${String(M).padStart(2, "0")}${suffix}`;
  };

  const finishTimes = ["00:30", "01:00", "01:30", "02:00", "02:30", "03:00"];

  

  const cartFinishHHMM =
    (cartItems?.[actId]?.[lineupId]?.finishTime) || getFinishHHMM();
  const cartFinishDayOffset = Number(
    cartItems?.[actId]?.[lineupId]?.finishDayOffset || 0
  );

  // If Cart finish isn't set yet, infer band's late minutes from the selected band Late Stay extra
  const lateStayBandExtra = liveSelectedExtras.find((e) => e.key === "late_stay_60min_per_band_member");

  const inferBandLateMinsFromExtra = () => {
    if (!lateStayBandExtra) return 0;
    // 1) explicit minutes metadata if present
    if (typeof lateStayBandExtra.minutes === "number" && lateStayBandExtra.minutes > 0) {
      return Math.max(0, Math.min(180, lateStayBandExtra.minutes));
    }
    // 2) try to parse from name e.g. "Late Stay - 1 hour", "Late Stay - 1 hour 30 mins", "Late Stay - 30 mins"
    const name = String(lateStayBandExtra.name || "").toLowerCase();
    let mins = 0;
    const mHours = name.match(/(\d+)\s*hour/);
    const mMins = name.match(/(\d+)\s*mins?/);
    if (mHours) mins += parseInt(mHours[1], 10) * 60;
    if (mMins) mins += parseInt(mMins[1], 10);
    if (mins > 0) return Math.max(0, Math.min(180, mins));
    // 3) last resort – derive from price vs per-60 net and performer count
    const per60Net = basePerMemberNet || 0; // already computed above from actData extras
    const members = lineupPerformers.length || 0; // performers only (management excluded)
    if (per60Net > 0 && members > 0 && typeof lateStayBandExtra.price === "number") {
      const estimated = Math.round(((lateStayBandExtra.price * 0.75) / (per60Net * members)) * 60);
      return Math.max(0, Math.min(180, estimated || 0));
    }
    return 0;
  };

  // If dayOffset is 1 or the time is between 00:00–05:59, treat as after midnight (minutes past midnight)
  const bandLateMinsFromCart =
    (cartFinishDayOffset > 0 || cartFinishHHMM < "06:00")
      ? Math.max(0, Math.min(parseMins(cartFinishHHMM), 180))
      : 0;

  // Fallback: infer from the selected band Late Stay extra
  const bandLateMins = Math.max(bandLateMinsFromCart, inferBandLateMinsFromExtra());

  // Offer only finish times strictly AFTER the band's finish
  const allowedFinishTimes = finishTimes.filter((ft) => {
    const ftMin = parseMins(ft);
    return Number.isFinite(ftMin) && ftMin > bandLateMins;
  });
  if (allowedFinishTimes.length === 0) return null;

  // Read any existing selection from cart extras (keeps UI in sync)
  const paLateStayExisting = liveSelectedExtras.find((e) => e.key === "pa_late_stay");
  const preferredFinish = paLateStayExisting?.finishTime || paFinishChoice || allowedFinishTimes[0];
  const effectiveFinish = allowedFinishTimes.includes(preferredFinish)
    ? preferredFinish
    : allowedFinishTimes[0];

  const minutesAfterMidnight = Math.max(0, Math.min(parseMins(effectiveFinish), 180));
  const deltaMins = Math.max(0, minutesAfterMidnight - bandLateMins); // charge only for PA beyond band finish
  const priceGrossCalc = Math.ceil((basePerMemberNet * 2 * (deltaMins / 60)) / 0.75);
  const priceGross = typeof paLateStayExisting?.price === "number" && paLateStayExisting.price > 0
    ? paLateStayExisting.price
    : priceGrossCalc;

  const writeCartPaFinish = (hhmm) => {
    if (typeof onOverridePaFinishTime === "function") {
      onOverridePaFinishTime(actId, lineupId, {
        hhmm,
        dayOffset: hhmm < "12:00" ? 1 : 0,
      });
    } else {
      setCartItems((prev) => {
        const u = { ...prev };
        if (u?.[actId]?.[lineupId]) {
          u[actId][lineupId].paLightsFinishTime = hhmm;
          u[actId][lineupId].paLightsFinishDayOffset = hhmm < "12:00" ? 1 : 0;
        }
        return u;
      });
    }
  };

  const handleSelectChange = (newFinish) => {
    const mins = Math.max(0, Math.min(parseMins(newFinish), 180));
    const delta = Math.max(0, mins - bandLateMins);
    if (paLateStayExisting) {
      if (delta === 0) {
        // Selecting a time at/before the band's finish removes the PA Late Stay
        updateExtras(actId, lineupId, { key: "pa_late_stay", name: "PA & Lights Late Stay", price: 0, quantity: 0 });
        writeCartPaFinish("00:00");
        return;
      }
      const newGross = Math.ceil((basePerMemberNet * 2 * (delta / 60)) / 0.75);
      updateExtras(actId, lineupId, {
        key: "pa_late_stay",
        name: `PA Late Stay to ${to12h(newFinish)}`,
        price: newGross,
        quantity: 1,
        finishTime: newFinish,
      });
      writeCartPaFinish(newFinish);
    } else {
      setPaFinishChoice(newFinish);
    }
  };

  const handleAdd = () => {
    const mins = Math.max(0, Math.min(parseMins(effectiveFinish), 180));
    const delta = Math.max(0, mins - bandLateMins);
    if (delta === 0) return; // nothing to charge beyond band finish
    const gross = Math.ceil((basePerMemberNet * 2 * (delta / 60)) / 0.75);
    updateExtras(actId, lineupId, {
      key: "pa_late_stay",
      name: `PA Late Stay to ${to12h(effectiveFinish)}`,
      price: gross,
      quantity: 1,
      finishTime: effectiveFinish,
    });
    writeCartPaFinish(effectiveFinish);
  };

  const handleRemove = () => {
    updateExtras(actId, lineupId, {
      key: "pa_late_stay",
      name: "PA & Lights Late Stay",
      price: 0,
      quantity: 0,
    });
    // Keep chosen dropdown value, but clear the cart field so the Cart line hides
    writeCartPaFinish("00:00");
  };

  return (
    <div className="keen-slider__slide bg-white border rounded p-2 flex flex-col justify-between shadow">
      <div className="overflow-hidden h-24 w-full rounded mb-2">
        <img
          src={assets.PA_speakers_icon}
          alt="PA Late Stay"
          className="w-full h-full object-cover transition-transform duration-300 ease-in-out hover:scale-110"
        />
      </div>
      <p className="text-sm font-medium text-center">PA Late Stay</p>
      <p className="text-sm text-center text-gray-600">Covers PA & Lights past midnight</p>

      <div className="flex items-center justify-center gap-2 mt-2">
        <label className="text-xs text-gray-600">Finish Time</label>
        <select
          className="border px-3 py-1 rounded text-sm"
          value={effectiveFinish}
          onChange={(e) => handleSelectChange(e.target.value)}
        >
          {allowedFinishTimes.map((ft) => (
            <option key={ft} value={ft}>{ft}</option>
          ))}
        </select>
      </div>

      <div className="text-center text-sm text-gray-700 mt-1">£{priceGross}</div>

      {paLateStayExisting ? (
        <button onClick={handleRemove} className="mt-2 px-4 py-2 text-base rounded text-white bg-black">Remove</button>
      ) : (
        <button onClick={handleAdd} className="mt-2 px-4 py-2 text-base rounded text-white bg-gray-300 hover:bg-[#ff6667]">Add</button>
      )}
    </div>
  );
})()

  {
    /* --- Early Arrival Slide --- */
  }
  <div className="keen-slider__slide bg-white border rounded p-2 flex flex-col justify-between shadow">
    <div className="overflow-hidden h-24 w-full rounded mb-2">
      <img
        src={assets.early_arrival_icon}
        alt="Early Arrival"
        className="w-full h-full object-cover transition-transform duration-300 ease-in-out hover:scale-110"
      />
    </div>
    <p className="text-sm font-medium text-center">Early Arrival</p>
    <p className="text-sm text-gray-600 text-center">
      £{earlyArrivalOptions[0]?.price || 0} / 60 mins{" "}
      <span className="text-xs">(per band member)</span>
    </p>
    <div className="flex items-center justify-center gap-2 mt-1">
      <label className="text-xs text-gray-600">Advance</label>
      <select
        className="border px-2 py-1 rounded text-sm"
        value={String(selectedEarlyArrival)}
        onChange={(e) => {
          const minutes = parseInt(e.target.value || "0", 10) || 0;
          setSelectedEarlyArrival(minutes);

          // 1) Update extras immediately
          const option = earlyArrivalOptions.find(
            (opt) => opt.value === minutes
          );
          if (option) {
      updateExtras(actId, lineupId, {
  name: `Early Arrival - ${option.label}`,
  key: "early_arrival_60min_per_band_member",
  price: option.price,
  quantity: 1,
  memberCount: lineupSize,   
});
          }

          // 2) Pull arrival back from 17:00 by minutes (floor at 09:00 same day)
          const { hhmm } = addMinutesHHMM("17:00", -minutes);
          const clamped = hhmm < "09:00" ? "09:00" : hhmm;
          if (typeof onOverrideArrivalTime === "function") {
            onOverrideArrivalTime(actId, lineupId, { hhmm: clamped });
          } else {
            setCartItems((prev) => {
              const u = { ...prev };
              if (u?.[actId]?.[lineupId]) {
                u[actId][lineupId].arrivalTime = clamped;
              }
              return u;
            });
          }
        }}
      >
        {earlyArrivalOptions.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
    <button
      onClick={() => {
        // Remove early arrival
        updateExtras(actId, lineupId, {
          name: "Early Arrival",
          key: "early_arrival_60min_per_band_member",
          price: 0,
          quantity: 0,
        });
        setSelectedEarlyArrival(earlyArrivalOptions[0]?.value || 30);
        setCartItems((prev) => {
          const u = { ...prev };
          if (u?.[actId]?.[lineupId]) {
            u[actId][lineupId].arrivalTime = "17:00";
          }
          return u;
        });
      }}
      className={`mt-2 px-4 py-2 text-base rounded text-white ${safeSelectedExtras.find((e) => e.key === "early_arrival_60min_per_band_member") ? "bg-black" : "bg-gray-300 hover:bg-[#ff6667]"}`}
    >
      {safeSelectedExtras.find(
        (e) => e.key === "early_arrival_60min_per_band_member"
      )
        ? "Remove"
        : "Add"}
    </button>
  </div>;

  // 📦 Filter all other extras (remove special handled ones)
  const ignoredKeys = [
    "extra_30min_performance_per_band_member",
    "extra_40min_performance_per_band_member",
    "extra_60min_performance_per_band_member",
    "late_stay_60min_per_band_member",
    "early_arrival_60min_per_band_member",
  ];


  const additionalPaRaw =
    actData?.extras && typeof actData.extras === "object"
      ? actData.extras["sound_engineering_for_another_act with your acts PA"]
      : null;
  const basePrice =
    additionalPaRaw && typeof additionalPaRaw.price === "number"
      ? additionalPaRaw.price
      : 0;
  const price = Math.ceil(basePrice / 0.75);


  const selectedMic = safeSelectedExtras.find((e) => e.key === selectedMicType);
  const hasQuantity = selectedMic?.quantity > 0;

  return (
    <div className="relative">
      <div className="flex flex-row gap-2 ">
        <div>
          <p className="text-medium font-semibold text-gray-600 text-base mt-2 pb-2">
            Extras:
          </p>
        </div>
        <div className="pt-2 flex-1">
          {displayExtras.length > 0 ? (
            <ul className="space-y-1 max-h-48 overflow-y-auto pr-2 pb-2">
              {displayExtras.map((extra, idx) => (
                <li
                  key={idx}
                  className="group flex items-center justify-between text-gray-700 text-base"
                >
                  {/* Left: name + qty + hover delete */}
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="truncate">
                      {extra.name}
                      {extra.quantity > 1 && (
                        <span className="ml-1">× {extra.quantity}</span>
                      )}
                    </span>
                    <button
                      className="opacity-0 group-hover:opacity-100 transition-opacity text-gray-400 hover:text-red-500 text-sm flex items-center"
                      aria-label={`Remove ${extra.name}`}
                      onClick={() => {
                        const shouldClearFinish =
                          extra.key === "late_stay_60min_per_band_member";

                        setCartItems((prev) => {
                          const updated = { ...prev };
                          const currentLineup = updated[actId][lineupId];
                          const currentSets =
                            currentLineup.selectedExtras || [];
                          currentLineup.selectedExtras = currentSets.filter(
                            (s) => s.key !== extra.key
                          );

                          // record dismissal to stop auto-readding
                          currentLineup.dismissedExtras = [
                            ...new Set([
                              ...(currentLineup.dismissedExtras || []),
                              extra.key,
                            ]),
                          ];

                          // reset finish when late stay removed
                          if (shouldClearFinish) {
                         
                            const arrivalTime = currentLineup.arrivalTime;
                            if (arrivalTime) {
                              const [hour, minute] = arrivalTime
                                .split(":")
                                .map(Number);
                              const finishHour = (hour + 7) % 24;
                              const finishTime = `${finishHour
                                .toString()
                                .padStart(2, "0")}:${minute
                                .toString()
                                .padStart(2, "0")}`;
                              currentLineup.finishTime =
                                finishHour >= 0 && finishHour < 24
                                  ? finishTime
                                  : "00:00";
                            } else {
                              currentLineup.finishTime = "00:00";
                            }
                          }

                          return updated;
                        });

                        // ⬇️ this must be OUTSIDE the updater to actually run
                        if (
                          shouldClearFinish &&
                          typeof onLateStayRemoved === "function"
                        ) {
                          onLateStayRemoved(actId, lineupId);
                        }
                      }}
                    >
                      <img
                        className="w-3 h-3 ml-1"
                        src={assets.cross_icon}
                        alt="Remove"
                      />
                    </button>
                  </div>

                  {/* Right: price */}
                  <span className="whitespace-nowrap text-sm tabular-nums">
                    £{extra.price}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-gray-700 text-base">None selected</p>
          )}
        </div>
      </div>
      <div className="relative w-[90%] mx-auto bg-black p-3 rounded ">
        {/* Left arrow */}
        <div className="absolute -left-6 top-1/2 transform -translate-y-1/2 z-10">
          <button
            onClick={() => instanceRef.current?.prev()}
            className="text-3xl text-gray-800 hover:text-black transition-colors"
            aria-label="Scroll left"
            type="button"
          >
            <img
              src={assets.scroll_left_icon}
              alt="Scroll left"
              className="w-6 h-6 md:w-8 md:h-8"
            />
          </button>
        </div>

        {/* Right arrow */}
        <div className="absolute -right-6 top-1/2 transform -translate-y-1/2 z-10">
          <button
            onClick={() => instanceRef.current?.next()}
            className="text-3xl text-gray-800 hover:text-black transition-colors"
            aria-label="Scroll right"
            type="button"
          >
            <img
              src={assets.scroll_right_icon}
              alt="Scroll right"
              className="w-6 h-6 md:w-8 md:h-8"
            />
          </button>
        </div>

        <div ref={sliderRef} className="keen-slider ">
          {/* 🎚 sound_engineering_for_another_act with your acts PA */}
          {(() => {
            const raw = actData?.extras?.get
              ? actData.extras.get(
                  "sound_engineering_for_another_act with your acts PA"
                )
              : actData?.extras?.[
                  "sound_engineering_for_another_act with your acts PA"
                ];
            const base = typeof raw === "number" ? raw : raw?.price || 0;
            if (!base || base === 0) return null;

            return (
              <div className="keen-slider__slide bg-white border rounded p-2 flex flex-col justify-between shadow">
                <div className="overflow-hidden h-24 w-full rounded mb-2">
                  <img
                    src={assets.PA_speakers_icon}
                    alt="PA & Sound Engineering for an External Act"
                    className="w-full h-full object-cover transition-transform duration-300 ease-in-out hover:scale-110"
                  />
                </div>
                <p className="text-sm font-medium text-center">
                  PA & Sound Engineering for an External Act
                </p>
                <p className="text-sm text-gray-600 text-center">
                  £{Math.ceil(base / 0.75)}
                </p>
                <button
                  onClick={() => {
                    const selected = safeSelectedExtras.find(
                      (e) =>
                        e.key ===
                        "sound_engineering_for_another_act with your acts PA"
                    );
                    const price = Math.ceil(base / 0.75);
                    updateExtras(actId, lineupId, {
                      name: "PA Use For an External Act",
                      key: "sound_engineering_for_another_act with your acts PA",
                      price,
                      quantity: selected ? 0 : 1,
                    });
                  }}
                  className={`mt-2 px-4 py-2 text-base rounded text-white ${
                    safeSelectedExtras.find(
                      (e) =>
                        e.key ===
                        "sound_engineering_for_another_act with your acts PA"
                    )
                      ? "bg-black"
                      : "bg-gray-300 hover:bg-[#ff6667]"
                  }`}
                >
                  {safeSelectedExtras.find(
                    (e) =>
                      e.key ===
                      "sound_engineering_for_another_act with your acts PA"
                  )
                    ? "Remove"
                    : "Add"}
                </button>
              </div>
            );
          })()}

          {/* Ceremony / Afternoon Performances Slide */}
          <div className="keen-slider__slide bg-white border rounded p-2 flex flex-col justify-between shadow">
            <div className="overflow-hidden h-24 w-full rounded mb-2">
              <img
                src={assets.ceremony_afternoon_icon} // <- Replace with a relevant icon/image asset
                alt="Ceremony or Afternoon Performances"
                className="w-full h-full object-cover transition-transform duration-300 ease-in-out hover:scale-110"
              />
            </div>
            <p className="text-sm font-medium text-center">
              Ceremony or Afternoon Performances
            </p>
            <p className="text-sm text-gray-600 text-center">
              Click through to the performance selector
            </p>
            <button
              onClick={() => setShowCeremonyModal(true)}
              className="mt-2 px-4 py-2 text-base rounded text-white bg-gray-300 hover:bg-[#ff6667]"
            >
              Explore
            </button>
          </div>

          {showCeremonyModal && (
            <div className="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-center z-50">
              <div
                className="bg-white rounded-lg p-6 w-[90%] max-w-3xl relative overflow-y-auto"
                style={{
                  maxHeight: "90vh", // limit height to viewport
                }}
              >
                <button
                  className="absolute top-3 right-3 text-gray-500 hover:text-black"
                  onClick={() => setShowCeremonyModal(false)}
                >
                  ✕
                </button>
                <h2 className="text-xl font-bold mb-4">
                  Ceremony / Afternoon Performances
                </h2>

                <AcousticExtrasSelector
                  actData={actData}
                  lineups={actData.lineups}
                  selectedLineup={lineup}
                  addToCart={updateExtras}
                  selectedLineupId={lineupId}
                />
              </div>
            </div>
          )}

          {/* 🎚 background_music_playlist */}
          {(() => {
            const raw = actData?.extras?.get
              ? actData.extras.get("background_music_playlist")
              : actData?.extras?.["background_music_playlist"];
            const base = typeof raw === "number" ? raw : raw?.price || 0;
            if (!base || base === 0) return null;

            return (
              <div className="keen-slider__slide bg-white border rounded p-2 flex flex-col justify-between shadow">
                <div className="overflow-hidden h-24 w-full rounded mb-2">
                  <img
                    src={assets.playlist_icon}
                    alt="Background Music Playlist"
                    className="w-full h-full object-cover transition-transform duration-300 ease-in-out hover:scale-110"
                  />
                </div>
                <p className="text-sm font-medium text-center">
                  Background Music Playlist
                </p>
                <p className="text-sm text-gray-600 text-center">
                  £
                  {(() => {
                    const raw = actData?.extras?.get
                      ? actData.extras.get("background_music_playlist")
                      : actData?.extras?.["background_music_playlist"];
                    let base = 0;
                    if (typeof raw === "number") {
                      base = raw;
                    } else if (typeof raw === "object" && raw !== null) {
                      base = raw.price || 0;
                    }
                    return Math.ceil(base / 0.75);
                  })()}
                </p>
                <button
                  onClick={() => {
                    const selected = safeSelectedExtras.find(
                      (e) => e.key === "background_music_playlist"
                    );
                    const raw = actData?.extras?.get
                      ? actData.extras.get("background_music_playlist")
                      : actData?.extras?.["background_music_playlist"];
                    let base = 0;
                    if (typeof raw === "number") {
                      base = raw;
                    } else if (typeof raw === "object" && raw !== null) {
                      base = raw.price || 0;
                    }
                    const price = Math.ceil(base / 0.75);
                    updateExtras(actId, lineupId, {
                      name: "Background Music Playlist",
                      key: "background_music_playlist",
                      price,
                      quantity: selected ? 0 : 1,
                    });
                  }}
                  className={`mt-2 px-4 py-2 text-base rounded text-white ${
                    safeSelectedExtras.find(
                      (e) => e.key === "background_music_playlist"
                    )
                      ? "bg-black"
                      : "bg-gray-300 hover:bg-[#ff6667]"
                  }`}
                >
                  {safeSelectedExtras.find(
                    (e) => e.key === "background_music_playlist"
                  )
                    ? "Remove"
                    : "Add"}
                </button>
              </div>
            );
          })()}

          {/* 🎚 up_to_3_hours_manned_playlist */}
          {(() => {
            const raw = actData?.extras?.get
              ? actData.extras.get("up_to_3_hours_manned_playlist")
              : actData?.extras?.["up_to_3_hours_manned_playlist"];
            const base = typeof raw === "number" ? raw : raw?.price || 0;
            if (!base || base === 0) return null;

            return (
              <div className="keen-slider__slide bg-white border rounded p-2 flex flex-col justify-between shadow">
                <div className="overflow-hidden h-24 w-full rounded mb-2">
                  <img
                    src={assets.manned_playlist_icon}
                    alt="Up to 3 Hours Manned Playlist"
                    className="w-full h-full object-cover transition-transform duration-300 ease-in-out hover:scale-110"
                  />
                </div>
                <p className="text-sm font-medium text-center">
                  Up to 3 Hours Manned Playlist
                </p>
                <p className="text-sm text-gray-600 text-center">
                  £
                  {(() => {
                    const raw = actData?.extras?.get
                      ? actData.extras.get("up_to_3_hours_manned_playlist")
                      : actData?.extras?.["up_to_3_hours_manned_playlist"];
                    let base = 0;
                    if (typeof raw === "number") {
                      base = raw;
                    } else if (typeof raw === "object" && raw !== null) {
                      base = raw.price || 0;
                    }
                    return Math.ceil(base / 0.75);
                  })()}
                </p>
                <button
                  onClick={() => {
                    const selected = safeSelectedExtras.find(
                      (e) => e.key === "up_to_3_hours_manned_playlist"
                    );
                    const raw = actData?.extras?.get
                      ? actData.extras.get("up_to_3_hours_manned_playlist")
                      : actData?.extras?.["up_to_3_hours_manned_playlist"];
                    let base = 0;
                    if (typeof raw === "number") {
                      base = raw;
                    } else if (typeof raw === "object" && raw !== null) {
                      base = raw.price || 0;
                    }
                    const price = Math.ceil(base / 0.75);
                    updateExtras(actId, lineupId, {
                      name: "Up to 3 Hours Manned Playlist",
                      key: "up_to_3_hours_manned_playlist",
                      price,
                      quantity: selected ? 0 : 1,
                    });
                  }}
                  className={`mt-2 px-4 py-2 text-base rounded text-white ${
                    safeSelectedExtras.find(
                      (e) => e.key === "up_to_3_hours_manned_playlist"
                    )
                      ? "bg-black"
                      : "bg-gray-300 hover:bg-[#ff6667]"
                  }`}
                >
                  {safeSelectedExtras.find(
                    (e) => e.key === "up_to_3_hours_manned_playlist"
                  )
                    ? "Remove"
                    : "Add"}
                </button>
              </div>
            );
          })()}

          {/* 🎚 up_to_3_hours_band_member_DJ */}
          {(() => {
            const raw = actData?.extras?.get
              ? actData.extras.get("up_to_3_hours_band_member_DJ")
              : actData?.extras?.["up_to_3_hours_band_member_DJ"];
            const base = typeof raw === "number" ? raw : raw?.price || 0;
            if (!base || base === 0) return null;
            return (
              <div className="keen-slider__slide bg-white border rounded p-2 flex flex-col justify-between shadow">
                <div className="overflow-hidden h-24 w-full rounded mb-2">
                  <img
                    src={assets.band_member_DJ_icon}
                    alt="Up to 3 Hours Band Member DJ"
                    className="w-full h-full object-cover transition-transform duration-300 ease-in-out hover:scale-110"
                  />
                </div>
                <p className="text-sm font-medium text-center">
                  Up to 3 Hours Band Member DJ
                </p>
                <p className="text-sm text-gray-600 text-center">
                  £
                  {(() => {
                    const raw = actData?.extras?.get
                      ? actData.extras.get("up_to_3_hours_band_member_DJ")
                      : actData?.extras?.["up_to_3_hours_band_member_DJ"];
                    let base = 0;
                    if (typeof raw === "number") {
                      base = raw;
                    } else if (typeof raw === "object" && raw !== null) {
                      base = raw.price || 0;
                    }
                    return Math.ceil(base / 0.75);
                  })()}
                </p>
                <button
                  onClick={() => {
                    const selected = safeSelectedExtras.find(
                      (e) => e.key === "up_to_3_hours_band_member_DJ"
                    );
                    const raw = actData?.extras?.get
                      ? actData.extras.get("up_to_3_hours_band_member_DJ")
                      : actData?.extras?.["up_to_3_hours_band_member_DJ"];
                    let base = 0;
                    if (typeof raw === "number") {
                      base = raw;
                    } else if (typeof raw === "object" && raw !== null) {
                      base = raw.price || 0;
                    }
                    const price = Math.ceil(base / 0.75);
                    updateExtras(actId, lineupId, {
                      name: "Up to 3 Hours Band Member DJ",
                      key: "up_to_3_hours_band_member_DJ",
                      price,
                      quantity: selected ? 0 : 1,
                    });
                  }}
                  className={`mt-2 px-4 py-2 text-base rounded text-white ${
                    safeSelectedExtras.find(
                      (e) => e.key === "up_to_3_hours_band_member_DJ"
                    )
                      ? "bg-black"
                      : "bg-gray-300 hover:bg-[#ff6667]"
                  }`}
                >
                  {safeSelectedExtras.find(
                    (e) => e.key === "up_to_3_hours_band_member_DJ"
                  )
                    ? "Remove"
                    : "Add"}
                </button>
              </div>
            );
          })()}

          {/* (removed duplicate PA Late Stay block; using the filtered PA Late Stay above) */}

          {/* 🎚 extra DJing per 30 mins */}
          {(() => {
            const getExtraValue = (key) => {
              const raw = actData?.extras?.get
                ? actData.extras.get(key)
                : actData?.extras?.[key];
              if (typeof raw === "number") return raw;
              if (typeof raw === "object" && raw !== null)
                return raw.price || 0;
              return 0;
            };

            const dj30Base = getExtraValue("extra DJing per 30 mins");
            const maxDjHours = getExtraValue("max_dj_hours");

            // Don’t render if base price is 0 or max hours <= 3
            if (!dj30Base || maxDjHours <= 3) return null;

            const pricePer30 = Math.ceil(dj30Base / 0.75);

            const selected = safeSelectedExtras.find(
              (e) => e.key === "extra DJing per 30 mins"
            );
            const quantity = selected?.quantity || 0;

            return (
              <div className="keen-slider__slide bg-white border rounded p-2 flex flex-col justify-between shadow">
                <div className="overflow-hidden h-24 w-full rounded mb-2">
                  <img
                    src={assets.additional_band_member_DJ_icon}
                    alt="Additional DJing per 30 mins"
                    className="w-full h-full object-cover transition-transform duration-300 ease-in-out hover:scale-110"
                  />
                </div>
                <p className="text-sm font-medium text-center">
                  Additional DJing per 30 mins
                </p>
                <p className="text-sm text-gray-600 text-center">
                  £{pricePer30}
                </p>

                <div className="flex items-center justify-center mt-2 gap-2">
                  <button
                    onClick={() => {
                      if (quantity > 0) {
                        updateExtras(actId, lineupId, {
                          name: "Additional DJing per 30 mins",
                          key: "extra DJing per 30 mins",
                          price: pricePer30,
                          quantity: quantity - 1,
                        });
                      }
                    }}
                    className="px-3 py-1 bg-gray-300 hover:bg-gray-400 rounded text-black"
                    disabled={quantity === 0}
                  >
                    -
                  </button>
                  <span>{quantity}</span>
                  <button
                    onClick={() => {
                      if (quantity * 0.5 < maxDjHours - 3) {
                        // ensures max limit
                        updateExtras(actId, lineupId, {
                          name: "Additional DJing per 30 mins",
                          key: "extra DJing per 30 mins",
                          price: pricePer30,
                          quantity: quantity + 1,
                        });
                      }
                    }}
                    className="px-3 py-1 bg-[#ff6667] hover:bg-black rounded text-white"
                  >
                    +
                  </button>
                </div>
              </div>
            );
          })()}

          {/* 🎚 DJ_live_sax_3x30mins */}
          {(() => {
            const raw = actData?.extras?.get
              ? actData.extras.get("DJ_live_sax_3x30mins")
              : actData?.extras?.["DJ_live_sax_3x30mins"];
            const base = typeof raw === "number" ? raw : raw?.price || 0;
            if (!base || base === 0) return null;
            return (
              <div className="keen-slider__slide bg-white border rounded p-2 flex flex-col justify-between shadow">
                <div className="overflow-hidden h-24 w-full rounded mb-2">
                  <img
                    src={assets.dj_live_sax_icon}
                    alt="DJ Live Sax (3x30mins)"
                    className="w-full h-full object-cover transition-transform duration-300 ease-in-out hover:scale-110"
                  />
                </div>
                <p className="text-sm font-medium text-center">
                  DJ Live Sax (3x30mins)
                </p>
                <p className="text-sm text-gray-600 text-center">
                  £
                  {(() => {
                    const raw = actData?.extras?.get
                      ? actData.extras.get("DJ_live_sax_3x30mins")
                      : actData?.extras?.["DJ_live_sax_3x30mins"];
                    let base = 0;
                    if (typeof raw === "number") {
                      base = raw;
                    } else if (typeof raw === "object" && raw !== null) {
                      base = raw.price || 0;
                    }
                    return Math.ceil(base / 0.75);
                  })()}
                </p>
                <button
                  onClick={() => {
                    const selected = safeSelectedExtras.find(
                      (e) => e.key === "DJ_live_sax_3x30mins"
                    );
                    const raw = actData?.extras?.get
                      ? actData.extras.get("DJ_live_sax_3x30mins")
                      : actData?.extras?.["DJ_live_sax_3x30mins"];
                    let base = 0;
                    if (typeof raw === "number") {
                      base = raw;
                    } else if (typeof raw === "object" && raw !== null) {
                      base = raw.price || 0;
                    }
                    const price = Math.ceil(base / 0.75);
                    updateExtras(actId, lineupId, {
                      name: "DJ Live Sax (3x30mins)",
                      key: "DJ_live_sax_3x30mins",
                      price,
                      quantity: selected ? 0 : 1,
                    });
                  }}
                  className={`mt-2 px-4 py-2 text-base rounded text-white ${
                    safeSelectedExtras.find(
                      (e) => e.key === "DJ_live_sax_3x30mins"
                    )
                      ? "bg-black"
                      : "bg-gray-300 hover:bg-[#ff6667]"
                  }`}
                >
                  {safeSelectedExtras.find(
                    (e) => e.key === "DJ_live_sax_3x30mins"
                  )
                    ? "Remove"
                    : "Add"}
                </button>
              </div>
            );
          })()}

          {/* 🎚 DJ_live_bongos_3x30mins */}
          {(() => {
            const raw = actData?.extras?.get
              ? actData.extras.get("DJ_live_bongos_3x30mins")
              : actData?.extras?.["DJ_live_bongos_3x30mins"];
            const base = typeof raw === "number" ? raw : raw?.price || 0;
            if (!base || base === 0) return null;
            return (
              <div className="keen-slider__slide bg-white border rounded p-2 flex flex-col justify-between shadow">
                <div className="overflow-hidden h-24 w-full rounded mb-2">
                  <img
                    src={assets.dj_live_bongos_icon}
                    alt="DJ Live Bongos (3x30mins)"
                    className="w-full h-full object-cover transition-transform duration-300 ease-in-out hover:scale-110"
                  />
                </div>
                <p className="text-sm font-medium text-center">
                  DJ Live Bongos (3x30mins)
                </p>
                <p className="text-sm text-gray-600 text-center">
                  £
                  {(() => {
                    const raw = actData?.extras?.get
                      ? actData.extras.get("DJ_live_bongos_3x30mins")
                      : actData?.extras?.["DJ_live_bongos_3x30mins"];
                    let base = 0;
                    if (typeof raw === "number") {
                      base = raw;
                    } else if (typeof raw === "object" && raw !== null) {
                      base = raw.price || 0;
                    }
                    return Math.ceil(base / 0.75);
                  })()}
                </p>
                <button
                  onClick={() => {
                    const selected = safeSelectedExtras.find(
                      (e) => e.key === "DJ_live_bongos_3x30mins"
                    );
                    const raw = actData?.extras?.get
                      ? actData.extras.get("DJ_live_bongos_3x30mins")
                      : actData?.extras?.["DJ_live_bongos_3x30mins"];
                    let base = 0;
                    if (typeof raw === "number") {
                      base = raw;
                    } else if (typeof raw === "object" && raw !== null) {
                      base = raw.price || 0;
                    }
                    const price = Math.ceil(base / 0.75);
                    updateExtras(actId, lineupId, {
                      name: "DJ Live Bongos (3x30mins)",
                      key: "DJ_live_bongos_3x30mins",
                      price,
                      quantity: selected ? 0 : 1,
                    });
                  }}
                  className={`mt-2 px-4 py-2 text-base rounded text-white ${
                    safeSelectedExtras.find(
                      (e) => e.key === "DJ_live_bongos_3x30mins"
                    )
                      ? "bg-black"
                      : "bg-gray-300 hover:bg-[#ff6667]"
                  }`}
                >
                  {safeSelectedExtras.find(
                    (e) => e.key === "DJ_live_bongos_3x30mins"
                  )
                    ? "Remove"
                    : "Add"}
                </button>
              </div>
            );
          })()}

          {/* 🎚 DJ_live_sax_and_bongos_3x30mins */}
          {(() => {
            const raw = actData?.extras?.get
              ? actData.extras.get("DJ_live_sax_and_bongos_3x30mins")
              : actData?.extras?.["DJ_live_sax_and_bongos_3x30mins"];
            const base = typeof raw === "number" ? raw : raw?.price || 0;
            if (!base || base === 0) return null;
            return (
              <div className="keen-slider__slide bg-white border rounded p-2 flex flex-col justify-between shadow">
                <div className="overflow-hidden h-24 w-full rounded mb-2">
                  <img
                    src={assets.dj_live_sax_and_bongos_icon}
                    alt="DJ Live Sax & Bongos (3x30mins)"
                    className="w-full h-full object-cover transition-transform duration-300 ease-in-out hover:scale-110"
                  />
                </div>
                <p className="text-sm font-medium text-center">
                  DJ Live Sax & Bongos (3x30mins)
                </p>
                <p className="text-sm text-gray-600 text-center">
                  £
                  {(() => {
                    const raw = actData?.extras?.get
                      ? actData.extras.get("DJ_live_sax_and_bongos_3x30mins")
                      : actData?.extras?.["DJ_live_sax_and_bongos_3x30mins"];
                    let base = 0;
                    if (typeof raw === "number") {
                      base = raw;
                    } else if (typeof raw === "object" && raw !== null) {
                      base = raw.price || 0;
                    }
                    return Math.ceil(base / 0.75);
                  })()}
                </p>
                <button
                  onClick={() => {
                    const selected = safeSelectedExtras.find(
                      (e) => e.key === "DJ_live_sax_and_bongos_3x30mins"
                    );
                    const raw = actData?.extras?.get
                      ? actData.extras.get("DJ_live_sax_and_bongos_3x30mins")
                      : actData?.extras?.["DJ_live_sax_and_bongos_3x30mins"];
                    let base = 0;
                    if (typeof raw === "number") {
                      base = raw;
                    } else if (typeof raw === "object" && raw !== null) {
                      base = raw.price || 0;
                    }
                    const price = Math.ceil(base / 0.75);
                    updateExtras(actId, lineupId, {
                      name: "DJ Live Sax & Bongos (3x30mins)",
                      key: "DJ_live_sax_and_bongos_3x30mins",
                      price,
                      quantity: selected ? 0 : 1,
                    });
                  }}
                  className={`mt-2 px-4 py-2 text-base rounded text-white ${
                    safeSelectedExtras.find(
                      (e) => e.key === "DJ_live_sax_and_bongos_3x30mins"
                    )
                      ? "bg-black"
                      : "bg-gray-300 hover:bg-[#ff6667]"
                  }`}
                >
                  {safeSelectedExtras.find(
                    (e) => e.key === "DJ_live_sax_and_bongos_3x30mins"
                  )
                    ? "Remove"
                    : "Add"}
                </button>
              </div>
            );
          })()}

          {/* 🎚 Extra Performance (Dropdown for 30/40/60 min) */}
          {(() => {
            const keyMap = {
              30: "extra_30min_performance_per_band_member",
              40: "extra_40min_performance_per_band_member",
              60: "extra_60min_performance_per_band_member",
            };

            const lineupSize = parseInt(
              lineup?.actSize || lineup?.bandMembers?.length || 0
            );

            const availableOptions = Object.entries(keyMap)
              .map(([duration, key]) => {
                const raw = actData?.extras?.get
                  ? actData.extras.get(key)
                  : actData?.extras?.[key];
                let base = 0;
                if (typeof raw === "number") {
                  base = raw;
                } else if (typeof raw === "object" && raw !== null) {
                  base = raw.price || 0;
                }
                const total = Math.ceil((base * (lineupSize || 1)) / 0.75);
                return { duration, key, base, total };
              })
              .filter((opt) => opt.base > 0);

            if (availableOptions.length === 0) return null;

            return (
              <div className="keen-slider__slide bg-white border rounded p-2 flex flex-col justify-between shadow">
                <div className="overflow-hidden h-24 w-full rounded mb-2">
                  <img
                    src={assets.extra_performance_icon}
                    alt="Extra Performance"
                    className="w-full h-full object-cover transition-transform duration-300 ease-in-out hover:scale-110"
                  />
                </div>
                <p className="text-sm font-medium text-center">
                  Extra Performance
                </p>

                <select
                  value={selectedDuration || ""}
                  onChange={(e) => setSelectedDuration(e.target.value)}
                  className="mt-2 px-2 py-1 border rounded text-sm"
                >
                  <option value="">Select</option>
                  {availableOptions.map((opt) => (
                    <option key={opt.duration} value={opt.duration}>
                      {opt.duration} mins
                    </option>
                  ))}
                </select>

                <p className="text-sm text-gray-600 text-center mt-2">
                  {selectedDuration
                    ? `£${
                        availableOptions.find(
                          (o) => o.duration === selectedDuration
                        )?.total || ""
                      }`
                    : `from £${availableOptions[0]?.total}`}
                </p>

                <button
                  disabled={!selectedDuration}
                  onClick={() => {
                    const selected = availableOptions.find(
                      (o) => o.duration === selectedDuration
                    );
                    if (!selected) return;
                    const existing = safeSelectedExtras.find(
                      (e) => e.key === selected.key
                    );
                    updateExtras(actId, lineupId, {
                      name: `Extra ${selected.duration}min Performance`,
                      key: selected.key,
                      price: selected.total,
                      quantity: existing ? 0 : 1,
                    });
                  }}
                  className={`mt-2 px-4 py-2 text-base rounded text-white ${
                    !selectedDuration
                      ? "bg-gray-300 cursor-not-allowed"
                      : safeSelectedExtras.find(
                            (e) => e.key === keyMap[selectedDuration]
                          )
                        ? "bg-black"
                        : "bg-gray-300 hover:bg-[#ff6667]"
                  }`}
                >
                  {safeSelectedExtras.find(
                    (e) => e.key === keyMap[selectedDuration]
                  )
                    ? "Remove"
                    : "Add"}
                </button>
              </div>
            );
          })()}

          {/* 🎚 Mic for Speeches (Dropdown for Wired/Wireless) */}
          {(() => {
            const micOptions = [
              "wired_mic for speeches",
              "wireless_mic for speeches",
            ]
              .map((key) => {
                const raw = actData?.extras?.get
                  ? actData.extras.get(key)
                  : actData?.extras?.[key];
                let base = 0;
                if (typeof raw === "number") {
                  base = raw;
                } else if (typeof raw === "object" && raw !== null) {
                  base = raw.price || 0;
                }
                return { key, base, total: Math.ceil(base / 0.75) };
              })
              .filter((opt) => opt.base > 0);

            if (micOptions.length === 0) return null;

            // Find selected extra for this mic type
            const selectedExtra = safeSelectedExtras.find(
              (e) => e.key === selectedMicType
            );
            // Use local state for selected quantity
            const micQty = selectedMicQty;
            // For display price, use pending or selected
            let displayPrice = "";
            if (selectedMicType && micQty) {
              const raw = actData?.extras?.get
                ? actData.extras.get(selectedMicType)
                : actData?.extras?.[selectedMicType];
              let base = 0;
              if (typeof raw === "number") {
                base = raw;
              } else if (typeof raw === "object" && raw !== null) {
                base = raw.price || 0;
              }
              displayPrice = Math.ceil((base / 0.75) * micQty);
            }

            return (
              <div className="keen-slider__slide bg-white border rounded p-2 flex justify-between flex-col shadow">
                <div className="overflow-hidden h-24 w-full rounded mb-2">
                  <img
                    src={assets.wireless_mic_icon}
                    alt="Mic for Speeches"
                    className="w-full h-full object-cover transition-transform duration-300 ease-in-out hover:scale-110"
                  />
                </div>
                <p className="text-sm font-medium text-center">
                  Mic for Speeches
                </p>

                <div className="flex flex-row gap-2 mt-2 items-start">
                  <select
                    value={selectedMicType || ""}
                    onChange={(e) => {
                      setSelectedMicType(e.target.value);
                      setSelectedMicQty(""); // Reset quantity when type changes
                      setPendingMicExtra(null);
                    }}
                    className="px-2 py-1 border rounded text-sm flex-1"
                  >
                    <option value="">Select</option>
                    {micOptions.map((opt) => (
                      <option key={opt.key} value={opt.key}>
                        {opt.key.includes("wireless") ? "Wireless" : "Wired"}
                      </option>
                    ))}
                  </select>
                  <select
                    value={selectedMicQty}
                    onChange={(e) => {
                      const quantity = parseInt(e.target.value);
                      setSelectedMicQty(quantity);
                      const raw = actData?.extras?.get
                        ? actData.extras.get(selectedMicType)
                        : actData?.extras?.[selectedMicType];
                      let base = 0;
                      if (typeof raw === "number") {
                        base = raw;
                      } else if (typeof raw === "object" && raw !== null) {
                        base = raw.price || 0;
                      }
                      const price = Math.ceil(base / 0.75) * quantity;
                      setPendingMicExtra({
                        name: `Mic for Speeches - ${
                          selectedMicType.includes("wireless")
                            ? "Wireless"
                            : "Wired"
                        }`,
                        key: selectedMicType,
                        price,
                        quantity,
                      });
                    }}
                    className="px-2 py-1 border rounded text-sm w-[80px] "
                    disabled={!selectedMicType}
                  >
                    <option value="">Qty</option>
                    <option value="1">1</option>
                    <option value="2">2</option>
                  </select>
                </div>

                <p className="text-sm text-gray-600 text-center mt-2">
                  {selectedMicType && micQty ? `£${displayPrice}` : ""}
                </p>

                <button
                  disabled={!selectedMicType || !selectedMicQty}
                  onClick={() => {
                    const selected = safeSelectedExtras.find(
                      (e) => e.key === selectedMicType
                    );
                    if (selected) {
                      updateExtras(actId, lineupId, {
                        name: selected.name,
                        key: selected.key,
                        price: 0,
                        quantity: 0,
                      });
                    } else if (pendingMicExtra) {
                      updateExtras(actId, lineupId, pendingMicExtra);
                    }
                  }}
                  className={`mt-2 px-4 py-2 text-base rounded text-white ${
                    !selectedMicType || !selectedMicQty
                      ? "bg-gray-300 cursor-not-allowed"
                      : safeSelectedExtras.find(
                            (e) => e.key === selectedMicType
                          )
                        ? "bg-black"
                        : "bg-gray-300 hover:bg-[#ff6667]"
                  }`}
                >
                  {safeSelectedExtras.find((e) => e.key === selectedMicType)
                    ? "Remove"
                    : "Add"}
                </button>
              </div>
            );
          })()}






          {/* 🎚 extra_song_request_per_band_member */}
          {(() => {
            const raw = actData?.extras?.get
              ? actData.extras.get("extra_song_request_per_band_member")
              : actData?.extras?.["extra_song_request_per_band_member"];
            let base = 0;
            if (typeof raw === "number") {
              base = raw;
            } else if (typeof raw === "object" && raw !== null) {
              base = raw.price || 0;
            }
            const lineupSize = lineup?.bandMembers?.length || 0;
            if (!base || !lineupSize) return null;

            const [selectedSongRequests, setSelectedSongRequests] =
              React.useState("");

            const options = [];
            for (let i = 1; i <= 30; i++) {
              const total = base * i * lineupSize;
              const withMargin = Math.ceil(total / 0.75);
              options.push({
                value: i,
                label: `${i} request${i > 1 ? "s" : ""}`,
                price: withMargin,
              });
            }

            return (
              <div className="keen-slider__slide bg-white border rounded p-2 flex flex-col justify-between shadow">
                <div className="overflow-hidden h-24 w-full rounded mb-1">
                  <img
                    src={assets.extra_song_request_icon}
                    alt="Extra Song Request"
                    className="w-full h-full object-cover transition-transform duration-300 ease-in-out hover:scale-110"
                  />
                </div>

                <p className="text-sm font-medium text-center">
                  Extra Song Request
                </p>

                <select
                  value={selectedSongRequests || ""}
                  onChange={(e) =>
                    setSelectedSongRequests(parseInt(e.target.value))
                  }
                  className="mt-2 px-2 py-1 border rounded text-sm"
                >
                  <option value="">Select</option>
                  {options.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
                <p className="text-sm text-gray-600 text-center mt-2">
                  {selectedSongRequests
                    ? `£${options.find((o) => o.value === selectedSongRequests)?.price}`
                    : `from £${options[0]?.price}`}
                </p>
                <button
                  disabled={!selectedSongRequests}
                  onClick={() => {
                    const selected = safeSelectedExtras.find(
                      (e) => e.key === "extra_song_request_per_band_member"
                    );
                    const opt = options.find(
                      (o) => o.value === selectedSongRequests
                    );
                    updateExtras(actId, lineupId, {
                      name: `Extra Song Requests (${selectedSongRequests})`,
                      key: "extra_song_request_per_band_member",
                      price: opt?.price || 0,
                      quantity: selected ? 0 : 1,
                    });
                  }}
                  className={`mt-2 px-4 py-2 text-base rounded text-white ${
                    !selectedSongRequests
                      ? "bg-gray-300 cursor-not-allowed"
                      : safeSelectedExtras.find(
                            (e) =>
                              e.key === "extra_song_request_per_band_member"
                          )
                        ? "bg-black"
                        : "bg-gray-300 hover:bg-[#ff6667]"
                  }`}
                >
                  {safeSelectedExtras.find(
                    (e) => e.key === "extra_song_request_per_band_member"
                  )
                    ? "Remove"
                    : "Add"}
                </button>
              </div>
            );
          })()}

          {/* 🎚 speedy_setup (60mins) - roadie and engineer duties only (travel added on top later for additional team member) */}
          {(() => {
            const raw = actData?.extras?.get
              ? actData.extras.get(
                  "speedy_setup (60mins) - roadie and engineer duties only (travel added on top later for additional team member)"
                )
              : actData?.extras?.[
                  "speedy_setup (60mins) - roadie and engineer duties only (travel added on top later for additional team member)"
                ];
            const base = typeof raw === "number" ? raw : raw?.price || 0;
            if (!base || base === 0) return null;
            return (
              <div className="keen-slider__slide bg-white border rounded p-2 flex flex-col justify-between shadow">
                <div className="overflow-hidden h-24 w-full rounded mb-2">
                  <img
                    src={assets.speedysetup_icon}
                    alt="Speedy Setup & Soundcheck (60mins)"
                    className="w-full h-full object-cover transition-transform duration-300 ease-in-out hover:scale-110"
                  />
                </div>

                <p className="text-sm font-medium text-center">
                  Speedy Setup & Soundcheck (60mins)
                </p>
                <p className="text-sm text-gray-600 text-center">
                  £
                  {(() => {
                    const raw = actData?.extras?.get
                      ? actData.extras.get(
                          "speedy_setup (60mins) - roadie and engineer duties only (travel added on top later for additional team member)"
                        )
                      : actData?.extras?.[
                          "speedy_setup (60mins) - roadie and engineer duties only (travel added on top later for additional team member)"
                        ];
                    let base = 0;
                    if (typeof raw === "number") {
                      base = raw;
                    } else if (typeof raw === "object" && raw !== null) {
                      base = raw.price || 0;
                    }
                    return Math.ceil(base / 0.75);
                  })()}
                </p>
                <button
                  onClick={() => {
                    const selected = safeSelectedExtras.find(
                      (e) =>
                        e.key ===
                        "speedy_setup (60mins) - roadie and engineer duties only (travel added on top later for additional team member)"
                    );
                    const raw = actData?.extras?.get
                      ? actData.extras.get(
                          "speedy_setup (60mins) - roadie and engineer duties only (travel added on top later for additional team member)"
                        )
                      : actData?.extras?.[
                          "speedy_setup (60mins) - roadie and engineer duties only (travel added on top later for additional team member)"
                        ];
                    let base = 0;
                    if (typeof raw === "number") {
                      base = raw;
                    } else if (typeof raw === "object" && raw !== null) {
                      base = raw.price || 0;
                    }
                    const price = Math.ceil(base / 0.75);
                    updateExtras(actId, lineupId, {
                      name: "Speedy Setup & Soundcheck (60mins)",
                      key: "speedy_setup (60mins) - roadie and engineer duties only (travel added on top later for additional team member)",
                      price,
                      quantity: selected ? 0 : 1,
                    });
                  }}
                  className={`mt-2 px-4 py-2 text-base rounded text-white ${
                    safeSelectedExtras.find(
                      (e) =>
                        e.key ===
                        "speedy_setup (60mins) - roadie and engineer duties only (travel added on top later for additional team member)"
                    )
                      ? "bg-black"
                      : "bg-gray-300 hover:bg-[#ff6667]"
                  }`}
                >
                  {safeSelectedExtras.find(
                    (e) =>
                      e.key ===
                      "speedy_setup (60mins) - roadie and engineer duties only (travel added on top later for additional team member)"
                  )
                    ? "Remove"
                    : "Add"}
                </button>
              </div>
            );
          })()}

          {/* 🎚 israeli_dancing */}
          {(() => {
            const raw = actData?.extras?.get
              ? actData.extras.get("israeli_dancing")
              : actData?.extras?.["israeli_dancing"];
            const base = typeof raw === "number" ? raw : raw?.price || 0;
            if (!base || base === 0) return null;
            return (
              <div className="keen-slider__slide bg-white border rounded p-2 flex flex-col justify-between shadow">
                <div className="overflow-hidden h-24 w-full rounded mb-2">
                  <img
                    src={assets.israeli_dancing_icon}
                    alt="Israeli Dancing (20mins)"
                    className="w-full h-full object-cover transition-transform duration-300 ease-in-out hover:scale-110"
                  />
                </div>
                <p className="text-sm font-medium text-center">
                  Israeli Dancing (20mins)
                </p>
                <p className="text-sm text-gray-600 text-center">
                  £
                  {(() => {
                    const raw = actData?.extras?.get
                      ? actData.extras.get("israeli_dancing")
                      : actData?.extras?.["israeli_dancing"];
                    let base = 0;
                    if (typeof raw === "number") {
                      base = raw;
                    } else if (typeof raw === "object" && raw !== null) {
                      base = raw.price || 0;
                    }
                    return Math.ceil(base / 0.75);
                  })()}
                </p>
                <button
                  onClick={() => {
                    const selected = safeSelectedExtras.find(
                      (e) => e.key === "israeli_dancing"
                    );
                    const raw = actData?.extras?.get
                      ? actData.extras.get("israeli_dancing")
                      : actData?.extras?.["israeli_dancing"];
                    let base = 0;
                    if (typeof raw === "number") {
                      base = raw;
                    } else if (typeof raw === "object" && raw !== null) {
                      base = raw.price || 0;
                    }
                    const price = Math.ceil(base / 0.75);
                    updateExtras(actId, lineupId, {
                      name: "Israeli Dancing (20mins)",
                      key: "israeli_dancing",
                      price,
                      quantity: selected ? 0 : 1,
                    });
                  }}
                  className={`mt-2 px-4 py-2 text-base rounded text-white ${
                    safeSelectedExtras.find((e) => e.key === "israeli_dancing")
                      ? "bg-black"
                      : "bg-gray-300 hover:bg-[#ff6667]"
                  }`}
                >
                  {safeSelectedExtras.find((e) => e.key === "israeli_dancing")
                    ? "Remove"
                    : "Add"}
                </button>
              </div>
            );
          })()}
        </div>
      </div>
    </div>
  );
};
ExtrasCarousel.propTypes = {
  extras: PropTypes.object,
  selectedExtras: PropTypes.oneOfType([PropTypes.array, PropTypes.object]),
  lineup: PropTypes.object,
  actId: PropTypes.any,
  lineupId: PropTypes.any,
  updateExtras: PropTypes.func,
  allLineups: PropTypes.array,
  selectedAddress: PropTypes.any,
  actData: PropTypes.shape({
    extras: PropTypes.object,
  }),
  onLateStayRemoved: PropTypes.func,
};

export default ExtrasCarousel;
