import React, { useState, useEffect } from "react";
import { toast } from "react-toastify";
import { assets } from "../assets/assets";
import CustomToast from "./CustomToast";
import { useContext } from "react";
import { ShopContext } from "../context/ShopContext";

const AcousticExtrasSelector = ({
  actData,
  lineups,
  selectedLineup,
  selectedLineupId,
  lineupSize,
  amplificationType,
  addToCart,
  ceremonySets = {},
}) => {
  const [performanceType, setPerformanceType] = useState("");
  const [ceremonyTime, setCeremonyTime] = useState("");
  const [afternoonTime, setAfternoonTime] = useState("");
  const [ceremonyDuration, setCeremonyDuration] = useState(1);
  const [afternoonDuration, setAfternoonDuration] = useState(1);

  const [ceremonySize, setCeremonySize] = useState("");
  const [ceremonyInstruments, setCeremonyInstruments] = useState([]);
  const [ceremonyAmp, setCeremonyAmp] = useState("");

  const [afternoonSize, setAfternoonSize] = useState("");
  const [afternoonInstruments, setAfternoonInstruments] = useState([]);
  const [afternoonAmp, setAfternoonAmp] = useState("");
  const { setCartItems } = useContext(ShopContext);

  // Helpers: exclude managers / non-performers from time-based per-member counts
const isManagerLike = (m = {}) => {
  const instr = (m.instrument || "").toLowerCase();
  const title = (m.title || "").toLowerCase();
  const roles = (Array.isArray(m.additionalRoles) ? m.additionalRoles : [])
    .map(r => (r?.role || "").toLowerCase());

  return (
    m.isManager === true ||
    m.isNonPerformer === true ||
    instr.includes("manager") ||
    title.includes("manager") ||
    roles.includes("band manager") ||
    roles.includes("manager") ||
    roles.includes("management")
  );
};

const isCountablePerformer = (m) => !isManagerLike(m);

  // Reset instruments on lineup size or amplification change
  useEffect(() => {
    setCeremonyInstruments([]);
  }, [ceremonySize, ceremonyAmp]);

  useEffect(() => {
    setAfternoonInstruments([]);
  }, [afternoonSize, afternoonAmp]);

  // Build a nice label for the cart line
  const buildBundleLabel = ({
    type,
    size,
    amplification,
    time,
    instruments,
    durationHours,
  }) => {
    const cap = (s) => (s || "").replace(/\b\w/g, (c) => c.toUpperCase());
    const pieces = [];
    if (type) pieces.push(cap(type)); // Ceremony / Afternoon
    if (size) pieces.push(cap(size)); // Solo / Duo / Trio / Four Piece
    if (amplification) pieces.push(`– ${cap(amplification)}`);
    if (time) pieces.push(`@ ${time}`);
    if (Number(durationHours)) pieces.push(`• ${durationHours}h`);
    if (Array.isArray(instruments) && instruments.length) {
      pieces.push(`(${instruments.join(", ")})`);
    }
    return pieces.join(" ");
  };

  const addCeremonyOrAfternoonToCart = ({
    actId,
    lineupId,
    type, // 'ceremony' | 'afternoon'
    size, // 'solo' | 'duo' | 'trio' | 'fourPiece'
    instruments, // ['Lead Female Vocal','Electric Guitar'] etc
    amplification, // 'unplugged' | 'amplified' | ...
    time, // '12:00' etc
    grossTotal, // e.g. 600 (already incl. margin)
    durationHours,
  }) => {
    const key =
      type === "ceremony" ? "ceremony_performance" : "afternoon_performance";

    const name = buildBundleLabel({
      type,
      size,
      amplification,
      time,
      instruments,
      durationHours,
    });

    setCartItems((prev) => {
      const next = structuredClone(prev || {});
      if (!next[actId]) next[actId] = {};
      if (!next[actId][lineupId])
        next[actId][lineupId] = {
          quantity: 1,
          selectedExtras: [],
          selectedAfternoonSets: [],
        };

      const node = next[actId][lineupId];

      // 1) Put a priced line into selectedExtras (billing + UI)
      //    Replace any existing bundle of the same type.
      node.selectedExtras = [
        ...(node.selectedExtras || []).filter((e) => e.key !== key),
        {
          key,
          name, // 👈 this fixes the “blank extra” label
          price: Number(grossTotal) || 0, // 👈 Cart now trusts this price
          quantity: 1,
          // optional helpers (visible in event sheet / debugging)
          time,
          amplification,
          instruments,
          size,
          type,
          durationHours: Number(durationHours) || null,
                    performanceLengthMinutes: Number.isFinite(Number(durationHours))
           ? Math.round(Number(durationHours) * 60)
           : null,
        },
      ];

      // 2) Mirror a rich record to selectedAfternoonSets for the booking snapshot
      node.selectedAfternoonSets = [
        ...(node.selectedAfternoonSets || []).filter((s) => s.type !== type),
        {
          type, // 'ceremony' | 'afternoon'
          size, // solo/duo/trio/fourPiece
          instruments: instruments || [],
          amplification: amplification || null,
          time: time || null,
          price: Number(grossTotal) || 0,
          name, // same label for clarity
          durationHours: Number(durationHours) || null,
                    performanceLengthMinutes: Number.isFinite(Number(durationHours))
           ? Math.round(Number(durationHours) * 60)
           : null,
        },
      ];

      return next;
    });
  };
  // Get the correct lineup by ID
  const selectedLineupObj = actData?.lineups?.find((l, idx) => {
    if (selectedLineupId && l._id === selectedLineupId) return true;
    if (selectedLineup && l === selectedLineup) return true;
    return false;
  });

  let ceremonySetsObj = {};
  if (selectedLineupObj?.ceremonySets instanceof Map) {
    ceremonySetsObj = Object.fromEntries(selectedLineupObj.ceremonySets);
  } else if (typeof selectedLineupObj?.ceremonySets === "object") {
    ceremonySetsObj = selectedLineupObj.ceremonySets;
  }
  const currentCeremonySize = ceremonySize;
  //   // Normalise ceremony size key for object lookup
  const normalisedSizeKey = currentCeremonySize?.toLowerCase();
  const currentCeremonyAmp = (ceremonyAmp || amplificationType)?.toLowerCase();


  const currentAfternoonSize = afternoonSize;
  // Normalise afternoon size key for object lookup
  const normalisedAfternoonSizeKey =
    currentAfternoonSize === "four piece" ? "fourPiece" : currentAfternoonSize;

  const currentAfternoonAmp = (
    afternoonAmp || amplificationType
  )?.toLowerCase();


  const ceremonyInstrumentsAvailable =
    ceremonySetsObj?.[normalisedSizeKey]?.[currentCeremonyAmp] || [];
  // Debug log after instruments calculation

  const toggleInstrument = (instrument) => {
    const sizeMap = { solo: 1, duo: 2, trio: 3, fourPiece: 4 };
    const maxAllowed = sizeMap[normalisedSizeKey] || Infinity;

    setCeremonyInstruments((prev) => {
      if (prev.includes(instrument)) {
        return prev.filter((i) => i !== instrument);
      } else {
        if (prev.length >= maxAllowed) {
          return prev;
        }
        return [...prev, instrument];
      }
    });
  };

  const afternoonInstrumentsAvailable =
    ceremonySetsObj?.[normalisedAfternoonSizeKey]?.[currentAfternoonAmp] || [];
  // Debug log after instruments calculation

  const toggleAfternoonInstrument = (instrument) => {
    const sizeMap = { solo: 1, duo: 2, trio: 3, fourPiece: 4 };
    const maxAllowed = sizeMap[normalisedAfternoonSizeKey] || Infinity;

    setAfternoonInstruments((prev) => {
      if (prev.includes(instrument)) {
        return prev.filter((i) => i !== instrument);
      } else {
        if (prev.length >= maxAllowed) {
          return prev; // Do not add more than allowed
        }
        return [...prev, instrument];
      }
    });
  };


  // --- NEW calculatePrice with dynamic early arrival and advanced logging ---
const calculatePrice = (sizeKey, forcedType) => {    const sizeMap = { solo: 1, duo: 2, trio: 3, fourPiece: 4 };
    const normalisedKey = sizeKey?.toLowerCase();
    // allow callers to force which segment to price
    const typeSource = forcedType || performanceType;
       const isCeremony = typeSource === "ceremony";
    const isAfternoon = typeSource === "afternoon";
    const isBoth = typeSource === "both";

    const allMembers = selectedLineupObj?.bandMembers || [];

    const instrumentAliases = {
      "acoustic guitar": "Electric Guitar",
      "acoustic bass guitar": "Bass Guitar",
      "double bass": "Bass Guitar",
      percussion: "Drums",
    };

    // 🔹 Normalize instrument names
    const normCeremony = ceremonyInstruments.map((i) => {
      const key = i?.toLowerCase();
      return instrumentAliases[key] || i;
    });

    const normAfternoon = afternoonInstruments.map((i) => {
      const key = i?.toLowerCase();
      return instrumentAliases[key] || i;
    });
   

    // 🔹 Select matching members
    // Derive matching band members for each segment
    const ceremonyMembers = allMembers.filter((m) =>
      normCeremony.includes(m.instrument)
    );
    const afternoonMembers = allMembers.filter((m) =>
      normAfternoon.includes(m.instrument)
    );

    // Exclude managers / non-performers from time-based counts
    const ceremonyPerformers = ceremonyMembers.filter(isCountablePerformer);
    const afternoonPerformers = afternoonMembers.filter(isCountablePerformer);



    let total = 0;
    let bookedMemberCount = 0;
    let hasSoloPA = false,
      hasDuoPA = false,
      hasSoundEngineer = false;

    // 🔹 Ceremony base fees
   if (isCeremony || isBoth) {
  ceremonyPerformers.forEach((m) => {
    const fee = (m.fee || 0) * (ceremonyDuration / 2);
    total += fee;
    if (m.haveSoloPa) hasSoloPA = true;
    if (m.haveDuoPa) hasDuoPA = true;
    if (m.additionalRoles?.some(r => r.role === "Sound Engineering"))
      hasSoundEngineer = true;
  });
}

if (isAfternoon || isBoth) {
  afternoonPerformers.forEach((m) => {
    const fee = (m.fee || 0) * (afternoonDuration / 2);
    total += fee;
    if (m.haveSoloPa) hasSoloPA = true;
    if (m.haveDuoPa) hasDuoPA = true;
    if (m.additionalRoles?.some(r => r.role === "Sound Engineering"))
      hasSoundEngineer = true;
  });
}

    // 🔹 PA Add-Ons
    if (normalisedKey === "solo" && hasSoloPA) {
      total += 100;
    }
    if (normalisedKey === "duo" && hasDuoPA) {
      total += 100;
    }

    // 🔹 Sound Engineer Check
    const fallbackEngineer = allMembers.find((m) =>
      m.additionalRoles?.some((r) => r.role === "Sound Engineering")
    );
    const engineerFee =
      fallbackEngineer?.additionalRoles?.find(
        (r) => r.role === "Sound Engineering"
      )?.additionalFee || 0;

    // 🔹 Early Arrival Rate (declare once here)
    const earlyArrivalRate =
      actData?.extras?.early_arrival_60min_per_band_member?.price || 0;

    // Calculate start times for use in early arrival logic
    let ceremonyStart = ceremonyTime
      ? parseInt(ceremonyTime.split(":")[0]) +
        parseInt(ceremonyTime.split(":")[1]) / 60
      : 17;

    let afternoonStart = afternoonTime
      ? parseInt(afternoonTime.split(":")[0]) +
        parseInt(afternoonTime.split(":")[1]) / 60
      : 17;

    // Member ID deduplication
const uniqueCeremonyMemberIds = new Set(ceremonyPerformers.map(m => m._id));
const uniqueAfternoonMemberIds = new Set(afternoonPerformers.map(m => m._id));       
    const engineerMemberId = fallbackEngineer?._id;

    // CEREMONY EARLY ARRIVAL
    if (ceremonyStart + ceremonyDuration < 17) {
      const ceremonyEarlyHours = Math.max(
        0,
        17 - (ceremonyStart + ceremonyDuration)
      );
      const numCeremonyMembers = uniqueCeremonyMemberIds.size;
      if (ceremonyEarlyHours > 0 && earlyArrivalRate > 0) {
        total += Math.round(
          ceremonyEarlyHours * earlyArrivalRate * numCeremonyMembers
        );
     
      }
    }

    let needsEngineer = false;

    // AFTERNOON EARLY ARRIVAL
    if (afternoonStart + afternoonDuration < 17) {
      const afternoonEarlyHours = Math.max(
        0,
        17 - (afternoonStart + afternoonDuration)
      );
      let numAfternoonMembers = uniqueAfternoonMemberIds.size;
      if (
        needsEngineer &&
        engineerMemberId &&
        !uniqueAfternoonMemberIds.has(engineerMemberId)
      ) {
        numAfternoonMembers += 1;
      }
      if (afternoonEarlyHours > 0 && earlyArrivalRate > 0) {
        total += Math.round(
          afternoonEarlyHours * earlyArrivalRate * numAfternoonMembers
        );
       
      }
    }

    const ampType = isCeremony
      ? ceremonyAmp || amplificationType
      : currentAfternoonAmp || amplificationType;
    const ampTypeLower = ampType?.toLowerCase();


    // Add £50 fee if using backing tracks
    if (ampTypeLower === "amplified with backing tracks") {
      total += 50;
    }

    if (ampTypeLower !== "unplugged") {
      if (
        (normalisedKey === "solo" && !hasSoloPA) ||
        (normalisedKey === "duo" && !hasDuoPA) ||
        ((normalisedKey === "trio" || normalisedKey === "fourpiece") &&
          !hasSoundEngineer)
      ) {
        needsEngineer = true;
        bookedMemberCount += 1;
        total += engineerFee;
      } else {
      }
    }

    // 🔹 Early Arrival Logic
    let timeStr = isCeremony ? ceremonyTime : afternoonTime;
    if (!timeStr) timeStr = "17:00";
    const [hour, minute] = timeStr.split(":").map(Number);
    const endTimeDecimal = hour + minute / 60;

    let earlyHours = 0;
    if (isCeremony)
      earlyHours = Math.max(0, 17 - (endTimeDecimal + ceremonyDuration));
    if (isAfternoon)
      earlyHours = Math.max(0, 17 - (endTimeDecimal + afternoonDuration));
    if (isBoth) {
      const ceremonyEnd =
        (ceremonyTime
          ? parseInt(ceremonyTime.split(":")[0]) +
            parseInt(ceremonyTime.split(":")[1]) / 60
          : 17) + ceremonyDuration;
      const afternoonStart = afternoonTime
        ? parseInt(afternoonTime.split(":")[0]) +
          parseInt(afternoonTime.split(":")[1]) / 60
        : 17;
      earlyHours = Math.max(0, 17 - Math.min(ceremonyEnd, afternoonStart));
    }

bookedMemberCount =
  (isCeremony ? ceremonyPerformers.length : 0) +
  (isAfternoon ? afternoonPerformers.length : 0) +
  (isBoth ? (ceremonyPerformers.length + afternoonPerformers.length) : 0);

if (needsEngineer) {
  bookedMemberCount += 1; // cover engineer’s time if hired
}
    // Use already declared earlyArrivalRate
    if (earlyHours > 0 && earlyArrivalRate > 0) {
      const earlyArrivalFee = Math.round(
        earlyHours * earlyArrivalRate * bookedMemberCount
      );
      total += earlyArrivalFee;
    
    }

    // 🔹 Overnight Engineer Fee
    if (needsEngineer && endTimeDecimal < 12) {
      total += 150;
    }

  
    return Math.round(total / 0.75);
  };

  // --- NEW calculateCeremonyAndAfternoonPrice: handles "both" bookings with advanced early arrival gap logic ---
  const calculateCeremonyAndAfternoonPrice = (sizeKey) => {
    const sizeMap = { solo: 1, duo: 2, trio: 3, fourPiece: 4 };
    const normalisedKey = sizeKey?.toLowerCase();
    const allMembers = selectedLineupObj?.bandMembers || [];
    const instrumentAliases = {
      "acoustic guitar": "Electric Guitar",
      "acoustic bass guitar": "Bass Guitar",
      "double bass": "Bass Guitar",
      percussion: "Drums",
    };
    const normCeremony = ceremonyInstruments.map(
      (i) => instrumentAliases[i?.toLowerCase()] || i
    );
    const normAfternoon = afternoonInstruments.map(
      (i) => instrumentAliases[i?.toLowerCase()] || i
    );
    const ceremonyMembers = allMembers.filter((m) =>
      normCeremony.includes(m.instrument)
    );
    const afternoonMembers = allMembers.filter((m) =>
      normAfternoon.includes(m.instrument)
    );
    // Logging
   
    let total = 0;
    let hasSoloPA = false,
      hasDuoPA = false,
      hasSoundEngineer = false;
    ceremonyMembers.forEach((m) => {
      total += (m.fee || 0) * (ceremonyDuration / 2);
      if (m.haveSoloPa) hasSoloPA = true;
      if (m.haveDuoPa) hasDuoPA = true;
      if (m.additionalRoles?.some((r) => r.role === "Sound Engineering"))
        hasSoundEngineer = true;
    });
    afternoonMembers.forEach((m) => {
      total += (m.fee || 0) * (afternoonDuration / 2);
      if (m.haveSoloPa) hasSoloPA = true;
      if (m.haveDuoPa) hasDuoPA = true;
      if (m.additionalRoles?.some((r) => r.role === "Sound Engineering"))
        hasSoundEngineer = true;
    });
    if (normalisedKey === "solo" && hasSoloPA) total += 100;
    if (normalisedKey === "duo" && hasDuoPA) total += 100;
    // Engineer
    const fallbackEngineer = allMembers.find((m) =>
      m.additionalRoles?.some((r) => r.role === "Sound Engineering")
    );
    const engineerFee =
      fallbackEngineer?.additionalRoles?.find(
        (r) => r.role === "Sound Engineering"
      )?.additionalFee || 0;
    let bookedMemberCount = ceremonyMembers.length + afternoonMembers.length;
    let needsEngineer = false;
    // Determine if engineer needed for either segment
    let ampTypeCeremony = ceremonyAmp || amplificationType;
    let ampTypeAfternoon = currentAfternoonAmp || amplificationType;
    const ampCeremonyLower = ampTypeCeremony?.toLowerCase();
    const ampAfternoonLower = ampTypeAfternoon?.toLowerCase();
    if (
      (ampCeremonyLower !== "unplugged" &&
        ((normalisedKey === "solo" && !hasSoloPA) ||
          (normalisedKey === "duo" && !hasDuoPA) ||
          ((normalisedKey === "trio" || normalisedKey === "fourpiece") &&
            !hasSoundEngineer) ||
          ["amplified", "amplified with backing tracks"].includes(
            ampCeremonyLower
          ))) ||
      (ampAfternoonLower !== "unplugged" &&
        ((normalisedKey === "solo" && !hasSoloPA) ||
          (normalisedKey === "duo" && !hasDuoPA) ||
          ((normalisedKey === "trio" || normalisedKey === "fourpiece") &&
            !hasSoundEngineer) ||
          ["amplified", "amplified with backing tracks"].includes(
            ampAfternoonLower
          )))
    ) {
      needsEngineer = true;
      bookedMemberCount += 1;
      total += engineerFee;
    }
    // Early arrival: only charge for early arrival before the first segment (gap before 17:00)
    let ceremonyStart = ceremonyTime
      ? parseInt(ceremonyTime.split(":")[0]) +
        parseInt(ceremonyTime.split(":")[1]) / 60
      : 17;
    let ceremonyEnd = ceremonyStart + ceremonyDuration;
    let afternoonStart = afternoonTime
      ? parseInt(afternoonTime.split(":")[0]) +
        parseInt(afternoonTime.split(":")[1]) / 60
      : 17;
    // The earliest start time of both segments
    let earliestStart = Math.min(ceremonyStart, afternoonStart);
    let earliestDuration =
      ceremonyStart < afternoonStart ? ceremonyDuration : afternoonDuration;
    let earlyHours = Math.max(0, 17 - (earliestStart + earliestDuration));
    const earlyArrivalRate =
      actData?.extras?.early_arrival_60min_per_band_member?.price || 0;
    if (earlyHours > 0 && earlyArrivalRate > 0) {
      total += Math.round(earlyHours * earlyArrivalRate * bookedMemberCount);
     
    }
    // Engineer overnight fee
    if (needsEngineer && earliestStart < 12) {
      total += 150;
    }
   
    return Math.round(total / 0.75);
  };



  const sizeDisplay = {
    solo: "Solo",
    duo: "Duo",
    trio: "Trio",
    fourPiece: "4-Piece",
  };

  const ceremonyOptions = selectedLineupObj?.ceremonySets || {};
  const lineupSizeOptions =
    ceremonyOptions instanceof Map
      ? Array.from(ceremonyOptions.keys())
      : Object.keys(ceremonyOptions || {});

  const sizeMap = {
    solo: "Solo",
    duo: "Duo",
    trio: "Trio",
    fourPiece: "Four-Piece",
  };

  const formatTime = (timeStr) => {
    if (!timeStr) return "TBC";
    const [hour, minute] = timeStr.split(":").map(Number);
    const suffix = hour >= 12 ? "pm" : "am";
    const adjustedHour = hour % 12 || 12;
    return `${adjustedHour}:${minute.toString().padStart(2, "0")}${suffix}`;
  };

  const ceremonyDesc = `${sizeMap[ceremonySize]} (${ceremonyInstruments.join(", ")}) ${ceremonyAmp || amplificationType} Ceremony Performance, starting at ${formatTime(ceremonyTime)} for ${ceremonyDuration} hour${ceremonyDuration > 1 ? "s" : ""}`;
  const afternoonDesc = `${sizeMap[afternoonSize]} (${afternoonInstruments.join(", ")}) ${afternoonAmp || amplificationType} Afternoon Performance, starting at ${formatTime(afternoonTime)} for ${afternoonDuration} hour${afternoonDuration > 1 ? "s" : ""}`;

  const selectedAfternoonSets = [];

  if (performanceType === "ceremony") {
    selectedAfternoonSets.push({
      key: "ceremony_set",
      price: calculatePrice(ceremonySize),
      type: "ceremony",
      name: ceremonyDesc,
    });
  } else if (performanceType === "afternoon") {
    selectedAfternoonSets.push({
      key: "afternoon_set",
      price: calculatePrice(afternoonSize),
      type: "afternoon",
      name: afternoonDesc,
    });
 } else if (performanceType === "both") {
  selectedAfternoonSets.push(
    {
      key: "ceremony_set",
      price: calculatePrice(ceremonySize || lineupSize, "ceremony"),
      type: "ceremony",
      name: ceremonyDesc,
    },
    {
      key: "afternoon_set",
      price: calculatePrice(afternoonSize || lineupSize, "afternoon"),
      type: "afternoon",
      name: afternoonDesc,
    }
  );
}

  return (
    <div className="border  p-4 rounded bg-white">
      <h3 className="text-lg mb-2 text-gray-600 mb-3">
        Get an instant quote for your ceremony, drinks reception, or wedding
        breakfast acoustic sets. These are considered <strong>Add-Ons</strong>{" "}
        to the main performance provided by your{" "}
        <a
          href="#lineup-selector"
          className="text-[#ff6667] underline hover:text-black transition-colors duration-200"
        >
          selected lineup.
        </a>
      </h3>

      <label className="block mb-2 text-gray-600 font-bold">
        Select Performance Type:
      </label>
      <select
        value={performanceType}
        onChange={(e) => setPerformanceType(e.target.value)}
        className="border p-1 mb-6 w-full text-gray-600 "
      >
        <option value="">-- Select --</option>
        <option value="ceremony">Ceremony Only</option>
        <option value="afternoon">Afternoon Only</option>
        <option value="both">Ceremony & Afternoon</option>
      </select>

      {["ceremony", "both"].includes(performanceType) && (
        <div className="mb-4">
          <h2 className="text-xl font-semibold border-b-2 border-gray-300 pb-1 mb-3 text-gray-600">
            Ceremony Performance
          </h2>
          <label className="block mb-1 text-gray-600">
            Ceremony Start Time:
          </label>
          <input
            type="time"
            onChange={(e) => setCeremonyTime(e.target.value)}
            className="border p-1 w-full text-gray-600"
          />
        </div>
      )}

      {["ceremony", "both"].includes(performanceType) && (
        <div className="mb-4">
          <label className="block mb-2 text-gray-600">Ceremony Duration:</label>
          <select
            value={ceremonyDuration}
            onChange={(e) => setCeremonyDuration(Number(e.target.value))}
            className="border p-1 w-full text-gray-600"
          >
            <option value={1}>1 hour</option>
            <option value={1.5}>1.5 hours</option>
          </select>
        </div>
      )}

      {["ceremony", "both"].includes(performanceType) && (
        <p className="text-sm text-gray-600 mb-4 ">
          In place & performing as required for this length of time with breaks
          for the ceremony.
        </p>
      )}

      {["ceremony", "both"].includes(performanceType) && (
        <div className="mb-4">
          <label className="block mb-2 text-gray-600">
            Select Ceremony Lineup Size:
          </label>
          <select
            value={ceremonySize || lineupSize}
            onChange={(e) => setCeremonySize(e.target.value)}
            className="form-select mt-1 block w-full mb-4 border p-1  text-gray-600"
          >
            <option value="">Select Lineup Size</option>
            {lineupSizeOptions.map((size) => (
              <option key={size} value={size}>
                {size === "fourPiece"
                  ? "4-Piece"
                  : size.charAt(0).toUpperCase() + size.slice(1)}
              </option>
            ))}
          </select>
        </div>
      )}

      {["ceremony", "both"].includes(performanceType) && (
        <div className="mb-4">
          <label className="block mb-2 text-gray-600">
            Ceremony Amplification Type:
          </label>
          <select
            value={ceremonyAmp || amplificationType}
            onChange={(e) => setCeremonyAmp(e.target.value)}
            className="form-select mt-1 block w-full mb-4 border p-1 text-gray-600"
          >
            <option value="">Select Amplification Type</option>
            {["Unplugged", "Amplified", "Amplified with backing tracks"].map(
              (type) => (
                <option key={type} value={type}>
                  {type.charAt(0).toUpperCase() + type.slice(1)}
                </option>
              )
            )}
          </select>
        </div>
      )}

      {["ceremony", "both"].includes(performanceType) && (
        <div className="mb-4">
          <h3 className=" block mb-2 text-gray-600">
            Choose Instruments for the Ceremony:
          </h3>
          {ceremonyInstrumentsAvailable.length > 0 ? (
            ceremonyInstrumentsAvailable.map((instrument, index) => (
              <label key={index} className="block mb-1  text-gray-600">
                <input
                  type="checkbox"
                  checked={ceremonyInstruments.includes(instrument)}
                  onChange={() => toggleInstrument(instrument)}
                  disabled={
                    !ceremonyInstruments.includes(instrument) &&
                    ceremonyInstruments.length >=
                      ({ solo: 1, duo: 2, trio: 3, fourPiece: 4 }[
                        (ceremonySize || lineupSize)?.toLowerCase()
                      ] || 0)
                  }
                  className="mr-2 h-3 w-3 accent-[#ff6667] text-[#ff6667] disabled:opacity-50"
                />
                {instrument}
              </label>
            ))
          ) : (
            <p className="text-gray-500">
              No instruments available for this setup.
            </p>
          )}
        </div>
      )}

      {["ceremony"].includes(performanceType) && (
        <div className="mb-4">
          {ceremonyInstruments.length > 0 && (
            <div className="mt-4">
              <div className="flex justify-between items-center p-2 border rounded mb-2">
                <div>
                  <p>
                    {sizeDisplay[ceremonySize || lineupSize] ||
                      ceremonySize ||
                      lineupSize}{" "}
                    — £{calculatePrice(ceremonySize || lineupSize)}
                  </p>
                  <p className="text-sm text-gray-500">
                    Lineup: {ceremonyInstruments.join(", ")}
                  </p>
                  <p className="text-sm text-gray-500">Start: {ceremonyTime}</p>
                  <p className="text-sm text-gray-500">
                    Amplification: {ceremonyAmp || amplificationType}
                  </p>
                </div>
                <img
                  src={assets.add_to_cart_icon}
                  alt="Add to cart"
                  className="w-6 cursor-pointer"
                  onClick={() => {
                    const gross = calculatePrice(ceremonySize || lineupSize);
                    addCeremonyOrAfternoonToCart({
                      actId: actData._id,
                      lineupId: selectedLineupId,
                      type: "ceremony",
                      size: (ceremonySize || lineupSize) || "",
                      instruments: ceremonyInstruments,
                      time: ceremonyTime || afternoonTime || "",
                      amplification: ceremonyAmp || amplificationType || "",
                      grossTotal: gross,
                      durationHours: ceremonyDuration,
                    });
                    toast(
                      <CustomToast
                        type="success"
                        message="Ceremony performance added to cart!"
                      />,
                      {
                        position: "top-right",
                        autoClose: 2000,
                      }
                    );
                  }}
                />
              </div>
            </div>
          )}
        </div>
      )}

      {["afternoon", "both"].includes(performanceType) && (
        <div className="mb-4 ">
          <h2 className="text-xl font-semibold border-b-2 border-gray-300 pb-1 mb-3 mt-3 text-gray-600">
            Afternoon Performance
          </h2>
          <label className="block mb-1 text-gray-600">
            Afternoon Start Time:
          </label>
          <input
            type="time"
            onChange={(e) => setAfternoonTime(e.target.value)}
            className="border p-1 w-full text-gray-600"
          />
        </div>
      )}

      {["afternoon", "both"].includes(performanceType) && (
        <div className="mb-4">
          <label className="block text-gray-600">
            Afternoon Performance Duration:
          </label>
          <select
            value={afternoonDuration}
            onChange={(e) => setAfternoonDuration(Number(e.target.value))}
            className="border p-1 w-full text-gray-600"
          >
            <option value={1}>1 hour</option>
            <option value={1.5}>1.5 hours</option>
          </select>
        </div>
      )}

      {["afternoon", "both"].includes(performanceType) &&
        afternoonDuration === 1 && (
          <p className="text-sm text-gray-600 mb-4">(1x60 or 2x30mins sets)</p>
        )}

      {["afternoon", "both"].includes(performanceType) &&
        afternoonDuration === 1.5 && (
          <p className="text-sm text-gray-600 mb-4">(2x45 or 3x30mins sets)</p>
        )}
      {["afternoon", "both"].includes(performanceType) && (
        <div className="mb-4">
          <label className="block mb-2 text-gray-600">
            Select Afternoon Lineup Size:
          </label>
          <select
            value={afternoonSize || lineupSize}
            onChange={(e) => setAfternoonSize(e.target.value)}
            className="form-select mt-1 block w-full mb-4 border p-1 text-gray-600"
          >
            <option value="">Select Lineup Size</option>
            {lineupSizeOptions.map((size) => (
              <option key={size} value={size}>
                {size.charAt(0).toUpperCase() + size.slice(1)}
              </option>
            ))}
          </select>
        </div>
      )}

      {["afternoon", "both"].includes(performanceType) && (
        <div className="mb-4">
          <label className="block mb-2 text-gray-600">
            Afternoon Amplification Type:
          </label>
          <select
            value={afternoonAmp || amplificationType}
            onChange={(e) => setAfternoonAmp(e.target.value)}
            className="form-select mt-1 block w-full mb-4 border p-1 text-gray-600"
          >
            <option value="">Select Amplification Type</option>
            {["Unplugged", "Amplified", "Amplified with backing tracks"].map(
              (type) => (
                <option key={type} value={type}>
                  {type.charAt(0).toUpperCase() + type.slice(1)}
                </option>
              )
            )}
          </select>
        </div>
      )}
      {["afternoon", "both"].includes(performanceType) && (
        <div className="mb-4">
          <h3 className="font-semibold text-lg mb-2 text-gray-600">
            Choose Instruments for the Afternoon:
          </h3>
          {afternoonInstrumentsAvailable.length > 0 ? (
            afternoonInstrumentsAvailable.map((instrument, index) => (
              <label key={index} className="block mb-1 text-gray-600">
                <input
                  type="checkbox"
                  checked={afternoonInstruments.includes(instrument)}
                  onChange={() => toggleAfternoonInstrument(instrument)}
                  disabled={
                    !afternoonInstruments.includes(instrument) &&
                    afternoonInstruments.length >=
                      ({ solo: 1, duo: 2, trio: 3, fourPiece: 4 }[
                        (afternoonSize || lineupSize)?.toLowerCase()
                      ] || 0)
                  }
                  className="mr-2 text-gray-600 accent-[#ff6667] text-[#ff6667] disabled:opacity-50"
                />
                {instrument}
              </label>
            ))
          ) : (
            <p className="text-gray-500">
              No instruments available for this setup.
            </p>
          )}
        </div>
      )}

      {["both"].includes(performanceType) && (
        <div className="mt-4">
          <div className="flex justify-between items-center p-4 border rounded mb-4">
            <div>
              <p className="font-medium text-gray-600">
                Ceremony & Afternoon Performance — £
                {calculateCeremonyAndAfternoonPrice("both")}
              </p>
              {ceremonyInstruments.length > 0 && (
                <>
                  <p className="text-sm text-gray-500">
                    Ceremony Lineup: {ceremonyInstruments.join(", ")}
                  </p>
                  <p className="text-sm text-gray-500">Start: {ceremonyTime}</p>
                  <p className="text-sm text-gray-500">
                    Amplification: {ceremonyAmp || amplificationType}
                  </p>
                </>
              )}
              {afternoonInstruments.length > 0 && (
                <>
                  <p className="text-sm text-gray-500 mt-2">
                    Afternoon Lineup: {afternoonInstruments.join(", ")}
                  </p>
                  <p className="text-sm text-gray-500">
                    Start: {afternoonTime}
                  </p>
                  <p className="text-sm text-gray-500">
                    Amplification: {afternoonAmp || amplificationType}
                  </p>
                </>
              )}
            </div>
            <img
              src={assets.add_to_cart_icon}
              alt="Add to cart"
              className="w-6 h-6 cursor-pointer p=6"
              onClick={() => {
  const ceremonyGross = calculatePrice(ceremonySize || lineupSize, "ceremony");
  const afternoonGross = calculatePrice(afternoonSize || lineupSize, "afternoon");

  // Add CEREMONY line
  addCeremonyOrAfternoonToCart({
    actId: actData._id,
    lineupId: selectedLineupId,
    type: "ceremony",
    size: (ceremonySize || lineupSize) || "",
    instruments: ceremonyInstruments,
    time: ceremonyTime || "",
    amplification: ceremonyAmp || amplificationType || "",
    grossTotal: ceremonyGross,
    durationHours: ceremonyDuration, 
  });

  // Add AFTERNOON line
  addCeremonyOrAfternoonToCart({
    actId: actData._id,
    lineupId: selectedLineupId,
    type: "afternoon",
    size: (afternoonSize || lineupSize) || "",
    instruments: afternoonInstruments,
    time: afternoonTime || "",
    amplification: afternoonAmp || amplificationType || "",
    grossTotal: afternoonGross,
    durationHours: afternoonDuration,
  });

  toast(
    <CustomToast
      type="success"
      message="Ceremony &amp; Afternoon performances added to cart!"
    />,
    { position: "top-right", autoClose: 2000 }
  );
}}
            />
          </div>
        </div>
      )}

      {["afternoon"].includes(performanceType) && (
        <div className="mb-4">
          {afternoonInstruments.length > 0 && (
            <div className="mt-4">
              <div className="flex justify-between items-center p-2 border rounded mb-2 text-gray-600">
                <div>
                  <p>
                    {sizeDisplay[afternoonSize || lineupSize] ||
                      afternoonSize ||
                      lineupSize}{" "}
                    — £
                    {calculateCeremonyAndAfternoonPrice(
                      afternoonSize || lineupSize
                    )}
                  </p>
                  <p className="text-sm text-gray-500">
                    Lineup: {afternoonInstruments.join(", ")}
                  </p>
                  <p className="text-sm text-gray-500">
                    Start: {afternoonTime}
                  </p>
                  <p className="text-sm text-gray-500">
                    Amplification: {afternoonAmp}
                  </p>
                </div>
                <img
                  src={assets.add_to_cart_icon}
                  alt="Add to cart"
                  className="w-6 cursor-pointer"
                  onClick={() => {
                    const gross = calculateCeremonyAndAfternoonPrice(afternoonSize || lineupSize);
                    addCeremonyOrAfternoonToCart({
                      actId: actData._id,
                      lineupId: selectedLineupId,
                      type: "afternoon",
                      size: (afternoonSize || lineupSize) || "",
                      instruments: afternoonInstruments,
                      time: afternoonTime || "",
                      amplification: afternoonAmp || amplificationType || "",
                      grossTotal: gross,
                      durationHours: afternoonDuration,
                    });
                    toast(
                      <CustomToast
                        type="success"
                        message="Afternoon performance added to cart!"
                      />,
                      {
                        position: "top-right",
                        autoClose: 2000,
                      }
                    );
                  }}
                />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// Ensure addToCart is passed from parent and not shadowed
// (If you see "undefined" in the 🔧 addToCart function log above, check parent props!)
export default AcousticExtrasSelector;
