import React, { useContext, useEffect, useState, useRef } from "react";
import { ShopContext } from "../context/ShopContext";
import { assets } from "../assets/assets";
import Title from "../components/Title";
import ActItem from "../components/ActItem";
import { useNavigate } from "react-router-dom";
import { postcodes } from "../assets/assets";
import calculateActPricing from "./utils/pricing";
import axios from "axios";

const backendUrl = import.meta.env.VITE_BACKEND_URL;

// Ensure all API requests hit the backend origin, not the Netlify origin
const api = (p) => `${backendUrl}/${String(p).replace(/^\/+/, "")}`;


const Acts = () => {
  const [filteredActs, setFilteredActs] = useState([]);
  const {
    acts,
    search,
    showSearch,
    setShowSearch,
    shortlistedActs,
    setShortlistedActs,
    toggleShortlist,
    selectedLineup,
    actId,
    shortlistItems,
    shortlistAct,
    userId, isShortlisted, selectedDate,
    setSelectedDate,
    selectedAddress,
    setSelectedAddress,
  } = useContext(ShopContext);
  // Only use approved acts for filtering and display
  const approvedActs = acts.filter(
    (act) =>
      act.status === "approved" || act.status === "Approved, changes pending"
  );
  // --- Add isLoading state for fetching acts ---
    const filterRunIdRef = useRef(0);
const [initializing, setInitializing] = useState(true);
const [updatingResults, setUpdatingResults] = useState(false);
  const [showFilter, setShowFilter] = useState(false);
  const [showGenreFilter, setShowGenreFilter] = useState(false);
  const [showSoundLimiterFilter, setShowSoundLimitersFilter] = useState(false);
  const [showPliFilter, setShowPliFilter] = useState(false);
  const [showSongFilter, setShowSongFilter] = useState(false);
  const [showActFilter, setShowActFilter] = useState(false);
  const [showPaAndLightsFilter, setShowPaAndLightsFilter] = useState(false);
  const [showDjServicesFilter, setShowDjServicesFilter] = useState(false);
  const [showInstrumentsFilter, setShowInstrumentsFilter] = useState(false);
  const [showExtraServicesFilter, setShowExtraServicesFilter] = useState(false);
  const [showSetupAndSoundcheckFilter, setShowSetupAndSoundcheckFilter] =
    useState(false);
  const [showActSizeFilter, setShowActSizeFilter] = useState(false);
  const [showWirelessFilter, setShowWirelessFilter] = useState(false);
  const [filterProducts, setFilterProducts] = useState([]);
  const [genre, setGenre] = useState([]);
  const [act_size, setActSize] = useState([]);
  const [djServices, setDjServices] = useState([]);
  const [instruments, setInstruments] = useState([]);
  const [songSearch, setSongSearch] = useState([]);
  const [actSearch, setActSearch] = useState([]);
  const [soundLimiters, setSoundLimiters] = useState([]);
  const [setupAndSoundcheck, setSetupAndSoundcheck] = useState([]);
  const [paAndLights, setPaAndLights] = useState([]);
  const [pli, setPli] = useState([]);
  const [extraServices, setExtraServices] = useState([]);
  const [wireless, setWireless] = useState([]);
  const [isGenreSelected, setIsGenreSelected] = useState(false); // Track if any checkbox is checked
  const [isActSizeSelected, setIsActSizeSelected] = useState(false); // Track if any checkbox is checked
  const [isDjServicesSelected, setIsDjServicesSelected] = useState(false); // Track if any checkbox is checked
  const [isInstrumentsSelected, setIsInstrumentsSelected] = useState(false); // Track if any checkbox is checked
  const [isWirelessSelected, setIsWirelessSelected] = useState(false); // Track if any checkbox is checked
  const [isSongSearchSelected, setIsSongSearchSelected] = useState(false); // Track if any checkbox is checked
  const [isActSearchSelected, setIsActSearchSelected] = useState(false); // Track if any checkbox is checked
  const [isSoundLimitersSelected, setIsSoundLimitersSelected] = useState(false); // Track if any checkbox is checked
  const [isSetupAndSoundcheckSelected, setIsSetupAndSoundcheckSelected] =
    useState(false); // Track if any checkbox is checked
  const [isPaAndLightsSelected, setIsPaAndLightsSelected] = useState(false); // Track if any checkbox is checked
  const [isPliSelected, setIsPliSelected] = useState(false); // Track if any checkbox is checked
  const [isExtraServicesSelected, setIsExtraServicesSelected] = useState(false); // Track if any checkbox is checked
  const [sortType, setSortType] = useState("relavent");
  const [actData, setActData] = useState(null);
const [availableMap, setAvailableMap] = useState({}); 
const [availLoading, setAvailLoading] = useState(false); 
  /* Removed duplicate getShortlistCountForAct to fix redeclaration error */

  
  const [selectedCounty, setSelectedCounty] = useState(
    sessionStorage.getItem("selectedCounty")?.trim().toLowerCase() || ""
  );
  const storedPlace = sessionStorage.getItem("selectedPlace") || "";

  const [adjustedTotal, setAdjustedTotal] = useState(null);
  const navigate = useNavigate();

  const availableCounties =
    postcodes?.length > 0 ? Object.keys(postcodes[0]) : [];

  const user = JSON.parse(localStorage.getItem("user"));

  const calculateActPricing = async (
    act,
    selectedCounty,
    selectedAddress,
    selectedDate,
    selectedLineup
  ) => {
    // Canonical backend base (never the Netlify origin)
    const BASE = (
      import.meta.env.VITE_BACKEND_URL || "https://tsc-backend-v2.onrender.com"
    ).replace(/\/+$/, "");

    // Helper: fetch travel JSON safely; supports new + legacy shapes
    const fetchTravel = async (origin, destination, dateISO) => {
      const url =
        `${BASE}/api/v2/travel/travel-data` +
        `?origin=${encodeURIComponent(origin)}` +
        `&destination=${encodeURIComponent(destination)}` +
        `&date=${encodeURIComponent(String(dateISO).slice(0, 10))}`;

      const res = await fetch(url, { headers: { accept: "application/json" } });
      const text = await res.text();

      let data = {};
      try {
        data = text ? JSON.parse(text) : {};
      } catch {
        data = {};
      }
      if (!res.ok) throw new Error(`travel http ${res.status}`);

      // --- Normalize shapes ---
      // Legacy: { rows:[{ elements:[{ distance, duration, fare? }] }] }
      const legacyEl = data?.rows?.[0]?.elements?.[0];

      // Prefer new shape if present; otherwise build outbound from legacy element
      const outbound =
        data?.outbound ||
        (legacyEl?.distance && legacyEl?.duration
          ? {
              distance: legacyEl.distance,
              duration: legacyEl.duration,
              fare: legacyEl.fare,
            }
          : undefined);

      // returnTrip only exists in the new shape
      const returnTrip = data?.returnTrip;

      return { outbound, returnTrip, raw: data };
    };

    let travelFee = 0;

    // ---- choose lineup (smallest or provided) ----
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
      return null;
    }

    // ---- northern logic (for team swap) ----
    const northernCounties = new Set([
      "ceredigion",
      "cheshire",
      "cleveland",
      "conway",
      "cumbria",
      "denbighshire",
      "derbyshire",
      "durham",
      "flintshire",
      "greater manchester",
      "gwynedd",
      "herefordshire",
      "lancashire",
      "leicestershire",
      "lincolnshire",
      "merseyside",
      "north humberside",
      "north yorkshire",
      "northumberland",
      "nottinghamshire",
      "rutland",
      "shropshire",
      "south humberside",
      "south yorkshire",
      "staffordshire",
      "tyne and wear",
      "warwickshire",
      "west midlands",
      "west yorkshire",
      "worcestershire",
      "wrexham",
      "rhondda cynon taf",
      "torfaen",
      "neath port talbot",
      "bridgend",
      "blaenau gwent",
      "caerphilly",
      "cardiff",
      "merthyr tydfil",
      "newport",
      "aberdeen city",
      "aberdeenshire",
      "angus",
      "argyll and bute",
      "clackmannanshire",
      "dumfries and galloway",
      "dundee city",
      "east ayrshire",
      "east dunbartonshire",
      "east lothian",
      "east renfrewshire",
      "edinburgh",
      "falkirk",
      "fife",
      "glasgow",
      "highland",
      "inverclyde",
      "midlothian",
      "moray",
      "na h eileanan siar",
      "north ayrshire",
      "north lanarkshire",
      "orkney islands",
      "perth and kinross",
      "renfrewshire",
      "scottish borders",
      "shetland islands",
      "south ayrshire",
      "south lanarkshire",
      "stirling",
      "west dunbartonshire",
      "west lothian",
    ]);

    const isNorthernGig = northernCounties.has(
      String(selectedCounty || "").toLowerCase().trim()
    );

    const bandMembers =
      act.useDifferentTeamForNorthernGigs && isNorthernGig
        ? act.northernTeam || []
        : smallestLineup.bandMembers || [];

    // ---- essential fees (net) ----
    const essentialFees = smallestLineup.bandMembers.flatMap((member) => {
      const baseFee = member.isEssential ? Number(member.fee) || 0 : 0;
      const additionalEssentialFees = (member.additionalRoles || [])
        .filter((role) => role.isEssential)
        .map((role) => Number(role.additionalFee) || 0);
      return [baseFee, ...additionalEssentialFees];
    });

    const fee = essentialFees.reduce((sum, n) => sum + n, 0);

    // ---- travel fee paths ----
    const memberPostcodes = (bandMembers || [])
      .map((m) => m?.postCode)
      .filter(Boolean);

    // 1) County table
    if (act.useCountyTravelFee && act.countyFees) {
      const countyKey = String(selectedCounty || "").toLowerCase();
      const feePerMember = Number(act.countyFees[countyKey]) || 0;
      travelFee = feePerMember * memberPostcodes.length;
    }
    // 2) Per-mile
    else if (Number(act.costPerMile) > 0) {
      for (const postCode of memberPostcodes) {
        const destination =
          typeof selectedAddress === "string"
            ? selectedAddress
            : selectedAddress?.postcode || selectedAddress?.address || "";
        if (!destination) continue;

        try {
          const { outbound, raw } = await fetchTravel(
            postCode,
            destination,
            selectedDate
          );
          const meters =
            outbound?.distance?.value ??
            raw?.rows?.[0]?.elements?.[0]?.distance?.value ??
            0;
          const miles = meters / 1609.34;
          travelFee += miles * Number(act.costPerMile) * 25; // your round-trip multiplier
        } catch (e) {
          console.warn("⚠️ travel fetch failed (per-mile):", e?.message || e);
        }
      }
    }
    // 3) MU-style (fuel/time/late/tolls) using outbound+returnTrip
    else {
      for (const member of smallestLineup.bandMembers) {
        const postCode = member?.postCode;
        const destination =
          typeof selectedAddress === "string"
            ? selectedAddress
            : selectedAddress?.postcode || selectedAddress?.address || "";
        if (!postCode || !destination) continue;

        try {
          const { outbound, returnTrip } = await fetchTravel(
            postCode,
            destination,
            selectedDate
          );
          if (!outbound || !returnTrip) continue;

          const outboundDistance = outbound?.distance?.value;
          const returnDistance = returnTrip?.distance?.value;
          const outboundDuration = outbound?.duration?.value;
          const returnDuration = returnTrip?.duration?.value;

          if (
            typeof outboundDistance !== "number" ||
            typeof returnDistance !== "number" ||
            typeof outboundDuration !== "number" ||
            typeof returnDuration !== "number"
          ) {
            continue;
          }

          const totalDistanceMiles =
            (outboundDistance + returnDistance) / 1609.34;
          const totalDurationHours =
            (outboundDuration + returnDuration) / 3600;

          const fuelFee = totalDistanceMiles * 0.56;
          const timeFee = totalDurationHours * 13.23;
          const lateFee = returnDuration / 3600 > 1 ? 136 : 0;
          const tollFee =
            (outbound.fare?.value || 0) + (returnTrip.fare?.value || 0);

          travelFee += fuelFee + timeFee + lateFee + tollFee;
        } catch (e) {
          console.warn("⚠️ travel fetch failed (MU):", e?.message || e);
        }
      }
    }

    const totalPrice = Math.ceil((fee + travelFee) / 0.75);
    return `${totalPrice}`;
  };

useEffect(() => {
  const loadAvail = async () => {
    setAvailLoading(true);
    try {
      const d = String(selectedDate || "").slice(0, 10);
      if (!d) {
        setAvailableMap({});
        setAvailLoading(false);
        return;
      }

      // ⚡ Try cache first for instant feedback
      const cacheKey = `availMap:${d}`;
      try {
        const cached = sessionStorage.getItem(cacheKey);
        if (cached) {
          const parsed = JSON.parse(cached);
          if (parsed && typeof parsed === "object") {
            setAvailableMap(parsed);
          }
        }
      } catch {}

      // Helper: normalize various backend response shapes into a tri-state map
      const toMap = (payload = {}) => {
        const map = {};
        const unavailable = Array.isArray(payload.unavailableActIds) ? payload.unavailableActIds : [];
        const available   = Array.isArray(payload.availableActIds)   ? payload.availableActIds   : [];
        const actIds      = Array.isArray(payload.actIds)            ? payload.actIds            : [];

        for (const id of unavailable) map[id] = false;
        for (const id of available)   if (!(id in map)) map[id] = true;

        // Compat: if only actIds present, treat those as available
        if (!payload.unavailableActIds && actIds.length) {
          for (const id of actIds) if (!(id in map)) map[id] = true;
        }
        return map;
      };

      // 1) Try canonical endpoint
      let res = await fetch(
        api(`api/v2/availability/acts-by-dateV2?date=${encodeURIComponent(d)}`),
        { headers: { accept: "application/json" } }
      );
      let bodyText = "";
      try { bodyText = await res.text(); } catch {}
      let json = {};
      try { json = bodyText ? JSON.parse(bodyText) : {}; } catch {}

      // 2) Fallback to legacy alias if needed
      if (!res.ok) {
        if (res.status === 404) {
          res = await fetch(
            api(`api/v2/availability/acts-available?date=${encodeURIComponent(d)}`),
            { headers: { accept: "application/json" } }
          );
          bodyText = "";
          try { bodyText = await res.text(); } catch {}
          try { json = bodyText ? JSON.parse(bodyText) : {}; } catch {}
        }
        if (!res.ok) {
          const msg = json?.message || json?.error || bodyText || `HTTP ${res.status}`;
          throw new Error(msg);
        }
      }

      // Some backends wrap in { data: {...} }
      const payload = (json && typeof json === "object" && (json.data || json)) || {};

      // Build base map from API
      const map = toMap(payload);

      // --- Merge availability from Act docs as a fallback/source-of-truth ---
      const dateKey = d; // "YYYY-MM-DD"
      for (const a of approvedActs) {
        const rows = Array.isArray(a.availabilityByDate) ? a.availabilityByDate : [];
        const matches = rows.filter(r => String(r.dateISO || "").slice(0,10) === dateKey);
        if (matches.length) {
          matches.sort((x,y) => new Date(x.setAt||0) - new Date(y.setAt||0));
          const latest = matches[matches.length - 1];
          const st = (latest?.status || "").toLowerCase(); // "available" | "unavailable"
          if (st === "unavailable") {
            map[a._id] = false;              // ❌ hide
          } else if (st === "available" && map[a._id] !== false) {
            map[a._id] = true;               // ✅ show (unless already false)
          }
        }
      }

      try { sessionStorage.setItem(cacheKey, JSON.stringify(map)); } catch {}
      setAvailableMap(map);
    } catch (e) {
      console.warn("[avail] load failed:", e?.message || e);
      // Keep any cached UI; don't clobber with empty map on error
    } finally {
      setAvailLoading(false);
    }
  };

  loadAvail();
}, [selectedDate, acts]);  // ← include acts


  const triggerSearch = () => {
    setShowSearch(true); // ✅ Open the search box
    navigate("/acts");
    window.scrollTo(0, 0); // ✅ Ensure it stays on the acts page
  };

  const toggleGenre = (e) => {
    const value = e.target.value;

    setGenre((prev) => {
      const newGenre = prev.includes(value)
        ? prev.filter((item) => item !== value)
        : [...prev, value];

      // ✅ Hide the asset if at least one checkbox is checked
      setIsGenreSelected(newGenre.length > 0);

      return newGenre;
    });
  };

  const toggleActSize = (e) => {
    const value = e.target.value;

    setActSize((prev) => {
      const newActSize = prev.includes(value)
        ? prev.filter((item) => item !== value)
        : [...prev, value];

      // ✅ Hide the asset if at least one checkbox is checked
      setIsActSizeSelected(newActSize.length > 0);

      return newActSize;
    });
  };

  const toggleDjServices = (e) => {
    const value = e.target.value;

    setDjServices((prev) => {
      const newDjServices = prev.includes(value)
        ? prev.filter((item) => item !== value)
        : [...prev, value];

      // ✅ Hide the asset if at least one checkbox is checked
      setIsDjServicesSelected(newDjServices.length > 0);

      return newDjServices;
    });
  };

  const toggleInstruments = (e) => {
    const value = e.target.value;

    setInstruments((prev) => {
      const newInstruments = prev.includes(value)
        ? prev.filter((item) => item !== value)
        : [...prev, value];

      // ✅ Hide the asset if at least one checkbox is checked
      setIsInstrumentsSelected(newInstruments.length > 0);

      return newInstruments;
    });
  };



  const toggleSoundLimiters = (e) => {
    const value = e.target.value;

    setSoundLimiters((prev) => {
      const newSoundLimiters = prev.includes(value)
        ? prev.filter((item) => item !== value)
        : [...prev, value];

      // ✅ Hide the asset if at least one checkbox is checked
      setIsSoundLimitersSelected(newSoundLimiters.length > 0);

      return newSoundLimiters;
    });
  };

  const toggleSetupAndSoundcheck = (e) => {
    const value = e.target.value;

    setSetupAndSoundcheck((prev) => {
      const newSetupAndSoundcheck = prev.includes(value)
        ? prev.filter((item) => item !== value)
        : [...prev, value];

      // ✅ Hide the asset if at least one checkbox is checked
      setIsSetupAndSoundcheckSelected(newSetupAndSoundcheck.length > 0);

      return newSetupAndSoundcheck;
    });
  };

  const togglePaAndLights = (e) => {
    const value = e.target.value;

    setPaAndLights((prev) => {
      const newPaAndLights = prev.includes(value)
        ? prev.filter((item) => item !== value)
        : [...prev, value];

      // ✅ Hide the asset if at least one checkbox is checked
      setIsPaAndLightsSelected(newPaAndLights.length > 0);

      return newPaAndLights;
    });
  };

  const togglePli = (e) => {
    const value = e.target.value;

    setPli((prev) => {
      const newPli = prev.includes(value)
        ? prev.filter((item) => item !== value)
        : [...prev, value];

      // ✅ Hide the asset if at least one checkbox is checked
      setIsPliSelected(newPli.length > 0);

      return newPli;
    });
  };

  const toggleExtraServices = (e) => {
    const value = e.target.value;

    setExtraServices((prev) => {
      const newExtraServices = prev.includes(value)
        ? prev.filter((item) => item !== value)
        : [...prev, value];

      // ✅ Hide the asset if at least one checkbox is checked
      setIsExtraServicesSelected(newExtraServices.length > 0);

      return newExtraServices;
    });
  };

  const toggleWireless = (e) => {
    const value = e.target.value;

    setWireless((prev) => {
      const newWireless = prev.includes(value)
        ? prev.filter((item) => item !== value)
        : [...prev, value];

      // ✅ Hide the asset if at least one checkbox is checked
      setIsWirelessSelected(newWireless.length > 0);

      return newWireless;
    });
  };

  const labelMap = {
    electric_drums: "Has electric drum kit",
    iems: "Uses in-ear monitoring",
    can_you_make_act_acoustic: "Can make act acoustic",
    remove_drums: "Can remove drums from lineup",

    // DJ Serrvices
    up_to_3_hours_band_member_DJ: "Band member DJ",
    DJ_live_sax_3x30mins: "DJ Live with saxophone",
    DJ_live_bongos_3x30mins: "DJ Live with bongos",
    DJ_live_bongos_and_sax_3x30mins: "DJ Live with saxophone and bongos",
    background_music_playlist: "Background music playlist",
    up_to_3_hours_manned_playlist: "Manned playlist",

    // Setup and Soundcheck
    setup_and_soundcheck_time_60min: "60min setup & soundcheck",
    setup_and_soundcheck_time_90min: "90min setup & soundcheck",
    speedy_setup: "60min speedy setup & soundcheck",

    // PA & Lights
    small_pa_size: "Small PA system",
    medium_pa_size: "Medium PA system",
    large_pa_size: "Large PA system",
    small_light_size: "Small light system",
    medium_light_size: "Medium light system",
    large_light_size: "Large light system",

    // PLI
    1: "Up to £1m",
    2: "Up to £2m",
    3: "Up to £3m",
    4: "Up to £4m",
    5: "Up to £5m",
    10: "Up to £10m",
    15: "Up to £15m",
    20: "Up to £20m",

    // Extra Services
    ceremony_solo: "Ceremony Solo",
    duo_ceremony: "Ceremony Duo",
    trio_ceremony: "Ceremony Trio",
    four_piece_ceremony: "Ceremony 4-piece",
    afternoon_solo: "Afternoon Reception Solo",
    afternoon_duo: "Afternoon Reception Duo",
    afternoon_trio: "Afternoon Reception Trio",
    afternoon_4piece: "Afternoon Reception 4-piece",
    early_arrival: "Early Arrival",
    late_stay: "Late Stay",
    extra_song: "Extra Song Requests",
    extra_sets: "Extra Main Performance Sets",
    add_another_vocalist: "Add another vocalist",
    sound_engineering_for_another_act: "Sound engineering for another act",
    israeli_sets: "Israeli dancing sets",
  };



  // ----- Instruments normalisation helpers -----
const INSTR_ALIAS = new Map([
  ["lead female vocal", "Lead Female Vocal"],
  ["lead male vocal", "Lead Male Vocal"],
  ["lead vocal", "Lead Vocal"],

  ["mc", "MC/Rapper"],
  ["rapper", "MC/Rapper"],
  ["mc/rapper", "MC/Rapper"],

  ["vocalist-guitarist", "Vocalist-Guitarist"],
  ["vocalist-bassist", "Vocalist-Bassist"],

  ["electric guitar", "Guitar"],
  ["bass guitar", "Bass"],
  ["double bass", "Bass"],
  ["acoustic bass", "Bass"],

  ["violin", "Violin / Fiddle"],
  ["fiddle", "Violin / Fiddle"],

  ["flute", "Flute & Clarinet"],
  ["clarinet", "Flute & Clarinet"],
]);




// Split combos like "Trumpet/Trombone/Rapper", "Lead Male Vocal/Rapper & Guitarist"
const splitInstrumentTokens = (s) =>
  String(s || "")
    .split(/[,/;&]|\\band\\b|\\bwith\\b|\\+|\\s*-\\s*/i) // / , ; & and with + hyphen separators
    .map((t) => t.trim())
    .filter(Boolean);

// Canonicalise a single token to your filter labels
const canonicaliseInstrument = (raw) => {
  const key = String(raw || "").trim().toLowerCase();
  const mapped = INSTR_ALIAS.get(key);
  if (mapped) return mapped;

  // tidy common variants
  if (key === "guitarist") return "Guitar";
  if (key === "sax") return "Saxophone";
  if (key === "keys") return "Keyboard";
  if (key === "drummer") return "Drums";
  if (key === "trumpet/trombone/rapper") return "MC/Rapper"; // handled by splitter anyway

  // leave as-is (e.g., "Trumpet", "Trombone", "Cello", etc.)
  return String(raw).trim();
};

// Build a deduped list of instruments an act actually offers
const deriveActInstruments = (act) => {
  const fromTop = Array.isArray(act.instruments) ? act.instruments : [];
  const fromLineups = (act.lineups || []).flatMap((l) =>
    (Array.isArray(l.bandMembers) ? l.bandMembers : [])
      .map((m) => m?.instrument)
      .filter(Boolean)
  );

  const all = [...fromTop, ...fromLineups];

  // Expand combos then canonicalise and dedupe
  const expanded = all.flatMap((name) => splitInstrumentTokens(name));
  const canonical = expanded.map((v) => {
    const c = canonicaliseInstrument(v);
    // final tweak: plain "Rapper" should count under MC/Rapper
    return c === "Rapper" ? "MC/Rapper" : c;
  });

  return Array.from(new Set(canonical));
};

  const formatDate = (dateString) => {
    if (!dateString) return "";

    const date = new Date(dateString);
    const day = date.getDate();
    const month = date.toLocaleString("en-GB", { month: "long" });
    const year = date.getFullYear();

    // Convert day to "1st", "2nd", "3rd", etc.
    const suffix = ["th", "st", "nd", "rd"][
      day % 10 > 3 ? 0 : ((day % 100) - (day % 10) !== 10) * (day % 10)
    ];

    return `${day}${suffix} of ${month} ${year}`;
  };

const applyFilter = async () => {
  const runId = ++filterRunIdRef.current;

  const actLabel = (a) => `${a?.tscName || a?.name || "(no-name)"} [${a?._id}]`;
  const hasAvailMap = !!availableMap && Object.keys(availableMap).length > 0;

  // If availability map is loading, skip ONLY the availability gate
  const skipAvailGate = Boolean(selectedDate && availLoading);
  if (skipAvailGate) {
  }

  // Start with approved acts only
  let actsCopy = approvedActs.slice();

  // --- AVAILABILITY GATE ----------------------------------------------------
  if (selectedDate && !skipAvailGate) {
    const explicitUnavailable = hasAvailMap
      ? Object.entries(availableMap).filter(([, v]) => v === false).map(([k]) => k)
      : [];
    const explicitAvailable = hasAvailMap
      ? Object.entries(availableMap).filter(([, v]) => v === true).map(([k]) => k)
      : [];

   

    if (hasAvailMap) {
      const removedByUnavailable = [];
      const keptByTrueOrUnknown = [];

      for (const a of actsCopy) {
        const flag = availableMap[a._id]; // true | false | undefined
        if (flag === false) removedByUnavailable.push(actLabel(a));
        else keptByTrueOrUnknown.push({ label: actLabel(a), flag });
      }

   

      // Only hide explicitly false; keep true and undefined
      actsCopy = actsCopy.filter((a) => availableMap[a._id] !== false);
    } else {
      // leave actsCopy unchanged
    }
  }


  // --- OTHER FILTERS (unchanged) -------------------------------------------
  if (showSearch && search) {
    const q = String(search).toLowerCase();
    actsCopy = actsCopy.filter((item) => item.name?.toLowerCase().includes(q));
  }

  if (genre.length > 0) {
    actsCopy = actsCopy.filter(
      (item) => Array.isArray(item.genre) && genre.some((g) => item.genre.includes(g))
    );
  }

  const norm = (s) => {
    if (!s) return "";
    let v = String(s).toLowerCase().trim();
    v = v.replace(/\s+/g, " ");
    v = v.replace(/\s*\+\s*$/, "+");
    if (v === "trio" || v === "3-piece") return "3-piece";
    if (v === "duo" || v === "2-piece") return "2-piece";
    if (v === "solo" || v === "1-piece") return "solo";
    return v;
  };

  if (act_size.length > 0) {
    const selected = act_size.map(norm);
    actsCopy = actsCopy.filter((item) => {
      const sizesFromLineups = Array.isArray(item.lineups)
        ? item.lineups.map((l) => l?.actSize).filter(Boolean)
        : [];
      const sizes = sizesFromLineups.map(norm);
      return selected.some((sel) => sizes.includes(sel));
    });
  }

  if (djServices.length > 0) {
    actsCopy = actsCopy.filter((item) =>
      djServices.some((service) => {
        const extra = item.extras?.[service];
        if (!extra) return false;
        if (extra.complimentary === true) return false;
        if (!extra.price || extra.price <= 0) return false;
        return true;
      })
    );
  }

  if (instruments.length > 0) {
    actsCopy = actsCopy.filter((act) => {
      const actInstruments = deriveActInstruments(act);
      return instruments.some((sel) => actInstruments.includes(sel));
    });
  }

  if (songSearch.length > 0) {
    actsCopy = actsCopy.filter((act) => {
      const songs = Array.isArray(act.selectedSongs)
        ? act.selectedSongs
        : Array.isArray(act.repertoire)
        ? act.repertoire
        : [];
      return songs.some((song) =>
        songSearch.some((term) => {
          const q = String(term).trim().toLowerCase();
          const title = String(song.title ?? song.song_name ?? "").toLowerCase();
          const artist = String(song.artist ?? "").toLowerCase();
          return title.includes(q) || artist.includes(q);
        })
      );
    });
  }

  if (actSearch.length > 0) {
    actsCopy = actsCopy.filter((act) =>
      actSearch.some((searchTerm) =>
        act.name?.toLowerCase().includes(String(searchTerm).toLowerCase())
      )
    );
  }


  // --- PRICING --------------------------------------------------------------
  const updatedActs = await Promise.all(
    actsCopy.map(async (act) => {
      try {
        // avoid noisy errors if inputs aren’t ready yet
        if (!selectedDate || !selectedAddress) {
          return { ...act, formattedPrice: null };
        }
        const price = await calculateActPricing(
          act,
          selectedCounty,
          selectedAddress,
          selectedDate
        );
        return { ...act, formattedPrice: price };
      } catch (e) {
        return { ...act, formattedPrice: null };
      }
    })
  );

  // Only let the latest run win
  if (runId === filterRunIdRef.current) {
    // ⬇️ Sort here to avoid a separate state-update loop later
    let finalActs = [...updatedActs];

    const num = (v) => {
      const n = Number(v);
      return Number.isFinite(n) ? n : NaN;
    };

    if (sortType === "low-high") {
      finalActs.sort((a, b) => {
        const A = num(a.formattedPrice);
        const B = num(b.formattedPrice);
        // NaNs go to the end
        if (Number.isNaN(A) && Number.isNaN(B)) return 0;
        if (Number.isNaN(A)) return 1;
        if (Number.isNaN(B)) return -1;
        return A - B;
      });
    } else if (sortType === "high-low") {
      finalActs.sort((a, b) => {
        const A = num(a.formattedPrice);
        const B = num(b.formattedPrice);
        if (Number.isNaN(A) && Number.isNaN(B)) return 0;
        if (Number.isNaN(A)) return 1;
        if (Number.isNaN(B)) return -1;
        return B - A;
      });
    }

    setFilterProducts(finalActs);
  } else {
    console.log(`Skipping stale filter run #${runId}`);
  }

  if (approvedActs.length > 0 && updatedActs.length === 0) {
  
  }
};


 // 1) Initial boot — keep as-is
useEffect(() => {
  const init = async () => { 
    setInitializing(true);
    const storedDate = sessionStorage.getItem("selectedDate");
    const storedAddress = sessionStorage.getItem("selectedAddress");
    const storedCounty = sessionStorage.getItem("selectedCounty");

    if (storedCounty) setSelectedCounty(storedCounty);
    if (storedDate) setSelectedDate(storedDate);
    if (storedAddress) setSelectedAddress(storedAddress);

    // warm availability from cache
    try {
      const d = (storedDate || "").slice(0, 10);
      if (d) {
        const cached = sessionStorage.getItem(`availMap:${d}`);
        if (cached) {
          const parsed = JSON.parse(cached);
          if (parsed && typeof parsed === "object") {
            setAvailableMap(parsed);
          }
        }
      }
    } catch {}

    await applyFilter();
    setInitializing(false);
  };
  init();
}, []);

// 2) When acts arrive (0 → N), run filter
useEffect(() => {
  if (!initializing) {
    applyFilter();
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [approvedActs.length]);

// 3) When availability loading state flips, run filter again
useEffect(() => {
  if (!initializing) {
    applyFilter();
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [availLoading]);

// 4) Main “filters changed” effect
useEffect(() => {
  const asyncApply = async () => {
    setUpdatingResults(true);
    await applyFilter();
    setUpdatingResults(false);
  };
  asyncApply();
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [
  // search & UI toggles
  search, showSearch,
  genre, act_size, djServices, instruments,
  songSearch, actSearch,
  soundLimiters, setupAndSoundcheck, paAndLights,
  pli, extraServices, wireless,

  // availability & date
  selectedDate,
  availableMap,       // identity changes on setAvailableMap(map)
  availLoading,       // re-run after it finishes

  // acts arriving
  approvedActs.length // 0 → N triggers re-run
]);

// ✅ Lightweight re-sort when the sort dropdown changes
useEffect(() => {
  // do nothing for default relevance
  if (sortType === "relavent") return;
  if (!Array.isArray(filterProducts) || filterProducts.length === 0) return;

  const toNum = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : NaN;
  };

  const sorted = [...filterProducts].sort((a, b) => {
    const A = toNum(a?.formattedPrice);
    const B = toNum(b?.formattedPrice);

    // Missing/NaN prices go to the end consistently
    const bothNaN = Number.isNaN(A) && Number.isNaN(B);
    if (bothNaN) return 0;
    if (Number.isNaN(A)) return 1;
    if (Number.isNaN(B)) return -1;

    return sortType === "low-high" ? A - B : B - A;
  });

  setFilterProducts(sorted);
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [sortType]);



  // --- Spinner conditional rendering for loading or no acts ---
if (initializing && acts.length === 0) {
  return (
    <div className="flex flex-col items-center justify-center h-96">
      <svg className="animate-spin h-10 w-10 text-gray-500 mb-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"></path>
      </svg>
      <p className="text-gray-700">Fetching acts and calculating your precise quotes…</p>
    </div>
  );
}

  return (
    <div className="flex flex-col sm:flex-row gap-1 sm:gap-10 pt-10 border-t ">
      
      {/* Filter options */}
      <div className="min-w-60 max-w-60">
        <p
          onClick={() => setShowFilter(!showFilter)}
          className="my-2 text-l flex items-center cursor-pointer gap-2 text-gray-600"
        >
          FILTERS
          <img
            className={`h-3 sm:hidden transition-transform duration-300 ${showFilter ? "rotate-90" : ""}`}
            src={assets.dropdown_icon}
            alt=""
          />
        </p>

        <div
          className={`border border-gray-300 pl-5 py-3 my-5 ${showFilter ? "" : "hidden"} sm:block`}
        >
          {/* Genre filter */}
          <p
            onClick={() => setShowGenreFilter(!showGenreFilter)}
            className="mb-3 mt-3 text-sm font-medium flex items-center cursor-pointer gap-2"
          >
            GENRES
            <img
              className={`h-3 transition-transform duration-300 ${showGenreFilter ? "rotate-90" : ""}`}
              src={assets.dropdown_icon}
              alt=""
            />
          </p>

          {/* Genre options dropdown */}
          {showGenreFilter && (
            <div className="flex flex-col gap-2 text-sm font-light w-11/12 text-gray-700">
              <label className="flex gap-2">
                <input
                  className="w-3"
                  type="checkbox"
                  value={"Soul & Motown"}
                  onChange={toggleGenre}
                  checked={genre.includes("Soul & Motown")}
                />{" "}
                Soul & Motown
              </label>
              <label className="flex gap-2">
                <input
                  className="w-3"
                  type="checkbox"
                  value="Funk & Disco"
                  onChange={toggleGenre}
                  checked={genre.includes("Funk & Disco")}
                />{" "}
                Funk & Disco
              </label>
              <label className="flex gap-2">
                <input
                  className="w-3"
                  type="checkbox"
                  value="Indie & Rock"
                  onChange={toggleGenre}
                  checked={genre.includes("Indie & Rock")}
                />{" "}
                Indie & Rock
              </label>
              <label className="flex gap-2">
                <input
                  className="w-3"
                  type="checkbox"
                  value="Alternative & Punk"
                  onChange={toggleGenre}
                  checked={genre.includes("Alternative & Punk")}
                />{" "}
                Alternative & Punk
              </label>
              <label className="flex gap-2">
                <input
                  className="w-3"
                  type="checkbox"
                  value="Pop & Classic Pop"
                  onChange={toggleGenre}
                  checked={genre.includes("Pop & Classic Pop")}
                />{" "}
                Pop & Classic Pop
              </label>
              <label className="flex gap-2">
                <input
                  className="w-3"
                  type="checkbox"
                  value="Dance & Electronic"
                  onChange={toggleGenre}
                  checked={genre.includes("Dance & Electronic")}
                />{" "}
                Dance & Electronic
              </label>
              <label className="flex gap-2">
                <input
                  className="w-3"
                  type="checkbox"
                  value="Reggae & Afrobeat"
                  onChange={toggleGenre}
                  checked={genre.includes("Reggae & Afrobeat")}
                />{" "}
                Reggae & Afrobeat
              </label>
              <label className="flex gap-2">
                <input
                  className="w-3"
                  type="checkbox"
                  value="RnB, HipHop & Garage"
                  onChange={toggleGenre}
                  checked={genre.includes("RnB, HipHop & Garage")}
                />{" "}
                RnB, HipHop & Garage
              </label>
              <label className="flex gap-2">
                <input
                  className="w-3"
                  type="checkbox"
                  value="90s"
                  onChange={toggleGenre}
                  checked={genre.includes("90s")}
                />{" "}
                90s
              </label>
              <label className="flex gap-2">
                <input
                  className="w-3"
                  type="checkbox"
                  value="Latin"
                  onChange={toggleGenre}
                  checked={genre.includes("Latin")}
                />{" "}
                Latin
              </label>
              <label className="flex gap-2">
                <input
                  className="w-3"
                  type="checkbox"
                  value="Folk & Acoustic"
                  onChange={toggleGenre}
                  checked={genre.includes("Folk & Acoustic")}
                />{" "}
                Folk & Acoustic
              </label>
              <label className="flex gap-2">
                <input
                  className="w-3"
                  type="checkbox"
                  value="Roaming"
                  onChange={toggleGenre}
                  checked={genre.includes("Roaming")}
                />{" "}
                Roaming
              </label>
              <label className="flex gap-2">
                <input
                  className="w-3"
                  type="checkbox"
                  value="Jazz & Swing"
                  onChange={toggleGenre}
                  checked={genre.includes("Jazz & Swing")}
                />{" "}
                Jazz & Swing
              </label>
              <label className="flex gap-2">
                <input
                  className="w-3"
                  type="checkbox"
                  value="Classical"
                  onChange={toggleGenre}
                  checked={genre.includes("Classical")}
                />{" "}
                Classical
              </label>
              <label className="flex gap-2">
                <input
                  className="w-3"
                  type="checkbox"
                  value="Israeli"
                  onChange={toggleGenre}
                  checked={genre.includes("Israeli")}
                />{" "}
                Israeli
              </label>{" "}
            </div>
          )}

          {/* Act Size filter */}
          <p
            onClick={() => setShowActSizeFilter(!showActSizeFilter)}
            className="mb-3 mt-3 text-sm font-medium flex items-center cursor-pointer gap-2"
          >
            ACT SIZE
            <img
              className={`h-3 transition-transform duration-300 ${showActSizeFilter ? "rotate-90" : ""}`}
              src={assets.dropdown_icon}
              alt=""
            />
          </p>

          {/* Acts Size options dropdown */}
          {showActSizeFilter && (
            <div className="flex flex-col gap-2 text-sm font-light w-11/12 text-gray-700">
              <label className="flex gap-2">
                <input
                  className="w-3"
                  type="checkbox"
                  value={"Solo"}
                  onChange={toggleActSize}
                  checked={act_size.includes("Solo")}
                />{" "}
                Solo
              </label>
              <label className="flex gap-2">
                <input
                  className="w-3"
                  type="checkbox"
                  value={"Duo"}
                  onChange={toggleActSize}
                  checked={act_size.includes("Duo")}
                />{" "}
                Duo
              </label>
              <label className="flex gap-2">
                <input
                  className="w-3"
                  type="checkbox"
                  value={"Trio"}
                  onChange={toggleActSize}
                  checked={act_size.includes("Trio")}
                />{" "}
                Trio
              </label>
              <label className="flex gap-2">
                <input
                  className="w-3"
                  type="checkbox"
                  value={"4-Piece"}
                  onChange={toggleActSize}
                  checked={act_size.includes("4-Piece")}
                />{" "}
                4-Piece
              </label>
              <label className="flex gap-2">
                <input
                  className="w-3"
                  type="checkbox"
                  value={"5-Piece"}
                  onChange={toggleActSize}
                  checked={act_size.includes("5-Piece")}
                />{" "}
                5-Piece
              </label>
              <label className="flex gap-2">
                <input
                  className="w-3"
                  type="checkbox"
                  value={"6-Piece"}
                  onChange={toggleActSize}
                  checked={act_size.includes("6-Piece")}
                />{" "}
                6-Piece
              </label>
              <label className="flex gap-2">
                <input
                  className="w-3"
                  type="checkbox"
                  value={"7-Piece"}
                  onChange={toggleActSize}
                  checked={act_size.includes("7-Piece")}
                />{" "}
                7-Piece
              </label>
              <label className="flex gap-2">
                <input
                  className="w-3"
                  type="checkbox"
                  value={"8-Piece"}
                  onChange={toggleActSize}
                  checked={act_size.includes("8-Piece")}
                />{" "}
                8-Piece
              </label>
              <label className="flex gap-2">
                <input
                  className="w-3"
                  type="checkbox"
                  value={"9-Piece"}
                  onChange={toggleActSize}
                  checked={act_size.includes("9-Piece")}
                />{" "}
                9-Piece
              </label>
              <label className="flex gap-2">
                <input
                  className="w-3"
                  type="checkbox"
                  value={"10-Piece +"}
                  onChange={toggleActSize}
                  checked={act_size.includes("10-Piece +")}
                />{" "}
                10-Piece +
              </label>
            </div>
          )}

          {/* DJ Services filter */}
          <p
            onClick={() => setShowDjServicesFilter(!showDjServicesFilter)}
            className="mb-3 mt-3 text-sm font-medium flex items-center cursor-pointer gap-2"
          >
            DJ SERVICES
            <img
              className={`h-3 transition-transform duration-300 ${showDjServicesFilter ? "rotate-90" : ""}`}
              src={assets.dropdown_icon}
              alt=""
            />
          </p>

          {/*DJ Service Dropdown Options */}
          {showDjServicesFilter && (
            <div className="flex flex-col gap-2 text-sm font-light w-11/12 text-gray-700">
              <p className="flex gap-2">
                <input
                  className="w-3"
                  type="checkbox"
                  value={"background_music_playlist"}
                  onChange={toggleDjServices}
                  checked={djServices.includes("background_music_playlist")}
                />{" "}
                Background Playlist Music
              </p>
              <p className="flex gap-2">
                <input
                  className="w-3"
                  type="checkbox"
                  value={"up_to_3_hours_manned_playlist"}
                  onChange={toggleDjServices}
                  checked={djServices.includes("up_to_3_hours_manned_playlist")}
                />{" "}
                Manned Playlist
              </p>
              <p className="flex gap-2">
                <input
                  className="w-3"
                  type="checkbox"
                  value={"up_to_3_hours_band_member_DJ"}
                  onChange={toggleDjServices}
                  checked={djServices.includes("up_to_3_hours_band_member_DJ")}
                />{" "}
                Band Member DJing
              </p>
              <p className="flex gap-2">
                <input
                  className="w-3"
                  type="checkbox"
                  value={"DJ_live_sax_3x30mins"}
                  onChange={toggleDjServices}
                  checked={djServices.includes("DJ_live_sax_3x30mins")}
                />{" "}
                DJ Live with Saxophone
              </p>
              <p className="flex gap-2">
                <input
                  className="w-3"
                  type="checkbox"
                  value={"DJ_live_bongos_3x30mins"}
                  onChange={toggleDjServices}
                  checked={djServices.includes("DJ_live_bongos_3x30mins")}
                />{" "}
                DJ Live with Bongos
              </p>
              <p className="flex gap-2">
                <input
                  className="w-3"
                  type="checkbox"
                  value={"DJ_live_bongos_and_sax_3x30mins"}
                  onChange={toggleDjServices}
                  checked={djServices.includes(
                    "DJ_live_bongos_and_sax_3x30mins"
                  )}
                />{" "}
                DJ Live with Saxophone & Bongos
              </p>
            </div>
          )}

          {/* Instruments filter */}
          <p
            onClick={() => setShowInstrumentsFilter(!showInstrumentsFilter)}
            className="mb-3 mt-3 text-sm font-medium flex items-center cursor-pointer gap-2"
          >
            INSTRUMENTS
            <img
              className={`h-3 transition-transform duration-300 ${showInstrumentsFilter ? "rotate-90" : ""}`}
              src={assets.dropdown_icon}
              alt=""
            />
          </p>

          {/* Instruments Dropdown Options */}
          {showInstrumentsFilter && (
            <div className="flex flex-col gap-2 text-sm font-light w-11/12 text-gray-700">
              <p className="flex gap-2">
                <input
                  className="w-3"
                  type="checkbox"
                  value={"Lead Female Vocal"}
                  onChange={toggleInstruments}
                  checked={instruments.includes("Lead Female Vocal")}
                />{" "}
                Female Vocalist
              </p>
              <p className="flex gap-2">
                <input
                  className="w-3"
                  type="checkbox"
                  value={"Lead Male Vocal"}
                  onChange={toggleInstruments}
                  checked={instruments.includes("Lead Male Vocal")}
                />{" "}
                Male Vocalist
              </p>
              <p className="flex gap-2">
                <input
                  className="w-3"
                  type="checkbox"
                  value={"Lead Vocal"}
                  onChange={toggleInstruments}
                  checked={instruments.includes("Lead Vocal")}
                />{" "}
                Lead Vocalist
              </p>
              <p className="flex gap-2">
                <input
                  className="w-3"
                  type="checkbox"
                  value={"MC/Rapper"}
                  onChange={toggleInstruments}
                  checked={instruments.includes("MC/Rapper")}
                />{" "}
                MC/Rapper
              </p>
              <p className="flex gap-2">
                <input
                  className="w-3"
                  type="checkbox"
                  value={"Vocalist-Guitarist"}
                  onChange={toggleInstruments}
                  checked={instruments.includes("Vocalist-Guitarist")}
                />{" "}
                Vocalist-Guitarist
              </p>
              <p className="flex gap-2">
                <input
                  className="w-3"
                  type="checkbox"
                  value={"Guitar"}
                  onChange={toggleInstruments}
                  checked={instruments.includes("Guitar")}
                />{" "}
                Guitar
              </p>
              <p className="flex gap-2">
                <input
                  className="w-3"
                  type="checkbox"
                  value={"Keyboard"}
                  onChange={toggleInstruments}
                  checked={instruments.includes("Keyboard")}
                />{" "}
                Keyboard
              </p>
              <p className="flex gap-2">
                <input
                  className="w-3"
                  type="checkbox"
                  value={"Drums"}
                  onChange={toggleInstruments}
                  checked={instruments.includes("Drums")}
                />{" "}
                Drums
              </p>
              <p className="flex gap-2">
                <input
                  className="w-3"
                  type="checkbox"
                  value={"Bass"}
                  onChange={toggleInstruments}
                  checked={instruments.includes("Bass")}
                />{" "}
                Bass
              </p>
              <p className="flex gap-2">
                <input
                  className="w-3"
                  type="checkbox"
                  value={"Saxophone"}
                  onChange={toggleInstruments}
                  checked={instruments.includes("Saxophone")}
                />{" "}
                Saxophone
              </p>
              <p className="flex gap-2">
                <input
                  className="w-3"
                  type="checkbox"
                  value={"Trumpet"}
                  onChange={toggleInstruments}
                  checked={instruments.includes("Trumpet")}
                />{" "}
                Trumpet
              </p>
              <p className="flex gap-2">
                <input
                  className="w-3"
                  type="checkbox"
                  value={"Trombone"}
                  onChange={toggleInstruments}
                  checked={instruments.includes("Trombone")}
                />{" "}
                Trombone
              </p>
              <p className="flex gap-2">
                <input
                  className="w-3"
                  type="checkbox"
                  value={"Violin / Fiddle"}
                  onChange={toggleInstruments}
                  checked={instruments.includes("Violin / Fiddle")}
                />{" "}
                Violin / Fiddle
              </p>
              <p className="flex gap-2">
                <input
                  className="w-3"
                  type="checkbox"
                  value={"Banjo"}
                  onChange={toggleInstruments}
                  checked={instruments.includes("Banjo")}
                />{" "}
                Banjo
              </p>
              <p className="flex gap-2">
                <input
                  className="w-3"
                  type="checkbox"
                  value={"Mandolin"}
                  onChange={toggleInstruments}
                  checked={instruments.includes("Mandolin")}
                />{" "}
                Mandolin
              </p>
              <p className="flex gap-2">
                <input
                  className="w-3"
                  type="checkbox"
                  value={"Acoustic Guitar"}
                  onChange={toggleInstruments}
                  checked={instruments.includes("Acoustic Guitar")}
                />{" "}
                Acoustic Guitar
              </p>
              <p className="flex gap-2">
                <input
                  className="w-3"
                  type="checkbox"
                  value={"Percussion"}
                  onChange={toggleInstruments}
                  checked={instruments.includes("Percussion")}
                />{" "}
                Percussion
              </p>
              <p className="flex gap-2">
                <input
                  className="w-3"
                  type="checkbox"
                  value={"Cello"}
                  onChange={toggleInstruments}
                  checked={instruments.includes("Cello")}
                />{" "}
                Cello
              </p>
              <p className="flex gap-2">
                <input
                  className="w-3"
                  type="checkbox"
                  value={"Flute & Clarinet"}
                  onChange={toggleInstruments}
                  checked={instruments.includes("Flute & Clarinet")}
                />{" "}
                Flute & Clarinet
              </p>
            </div>
          )}
          {/* Wireless filter */}
          <p
            onClick={() => setShowWirelessFilter(!showWirelessFilter)}
            className="mb-3 mt-3 text-sm font-medium flex items-center cursor-pointer gap-2"
          >
            WIRELESS
            <img
              className={`h-3 transition-transform duration-300 ${showWirelessFilter ? "rotate-90" : ""}`}
              src={assets.dropdown_icon}
              alt=""
            />
          </p>

          {/* Wireless options dropdown */}
          {showWirelessFilter && (
            <div className="flex flex-col gap-2 text-sm font-light w-11/12 text-gray-700">
              <label className="flex gap-2">
                <input
                  className="w-3"
                  type="checkbox"
                  value={"Vocal"}
                  onChange={toggleWireless}
                  checked={wireless.includes("Vocal")}
                />{" "}
                Vocal
              </label>
              <label className="flex gap-2">
                <input
                  className="w-3"
                  type="checkbox"
                  value={"Saxophone"}
                  onChange={toggleWireless}
                  checked={wireless.includes("Saxophone")}
                />{" "}
                Saxophone
              </label>
              <label className="flex gap-2">
                <input
                  className="w-3"
                  type="checkbox"
                  value={"Guitar"}
                  onChange={toggleWireless}
                  checked={wireless.includes("Guitar")}
                />{" "}
                Guitar
              </label>
              <label className="flex gap-2">
                <input
                  className="w-3"
                  type="checkbox"
                  value={"Bass"}
                  onChange={toggleWireless}
                  checked={wireless.includes("Bass")}
                />{" "}
                Bass
              </label>
              <label className="flex gap-2">
                <input
                  className="w-3"
                  type="checkbox"
                  value={"Keytar"}
                  onChange={toggleWireless}
                  checked={wireless.includes("Keytar")}
                />{" "}
                Keytar
              </label>
              <label className="flex gap-2">
                <input
                  className="w-3"
                  type="checkbox"
                  value={"Trumpet"}
                  onChange={toggleWireless}
                  checked={wireless.includes("Trumpet")}
                />{" "}
                Trumpet
              </label>{" "}
            </div>
          )}

          {/*Repertoire filter */}
          <p
            onClick={() => setShowSongFilter(!showSongFilter)}
            className="mb-3 mt-3 text-sm font-medium flex items-center cursor-pointer gap-2"
          >
            SONG & ARTIST SEARCH
            <img
              className={`h-3 transition-transform duration-300 ${showSongFilter ? "rotate-90" : ""}`}
              src={assets.dropdown_icon}
              alt=""
            />
          </p>

          {/* Song & Artist Search Input */}
          {showSongFilter && (
            <div className="flex flex-col gap-2 text-sm font-light w-11/12 text-gray-700">
              <input
                type="text"
                placeholder="Search song or artist..."
                value={songSearch.join(", ")}
                onChange={(e) =>
                  setSongSearch(
                    e.target.value
                      .split(",")
                      .map((searchTerm) => searchTerm.trimStart())
                  )
                }
                className="border p-1 w-11/12"
              />
            </div>
          )}

          {/*Act Name filter */}
          <p
            onClick={() => setShowActFilter(!showActFilter)}
            className="mb-3 mt-3 text-sm font-medium flex items-center cursor-pointer gap-2"
          >
            ACT NAME SEARCH
            <img
              className={`h-3 transition-transform duration-300 ${showActFilter ? "rotate-90" : ""}`}
              src={assets.dropdown_icon}
              alt=""
            />
          </p>

          {/* Act Search Input */}
          {showActFilter && (
            <div className="flex flex-col gap-2 text-sm font-light w-11/12 text-gray-700">
              <input
                type="text"
                placeholder="Search for act by name..."
                value={actSearch.join(", ")}
                onChange={(e) =>
                  setActSearch(
                    e.target.value
                      .split(",")
                      .map((searchTerm) => searchTerm.trimStart())
                  )
                }
                className="border p-1 w-11/12"
              />
            </div>
          )}

          {/* Soundlimiter filter */}
          <p
            onClick={() => setShowSoundLimitersFilter(!showSoundLimiterFilter)}
            className="mb-3 mt-3 text-sm font-medium flex items-center cursor-pointer gap-2"
          >
            SOUND LIMITERS
            <img
              className={`h-3 transition-transform duration-300 ${showSoundLimiterFilter ? "rotate-90" : ""}`}
              src={assets.dropdown_icon}
              alt=""
            />
          </p>

          {/* soundlimiter options dropdown */}
          {showSoundLimiterFilter && (
            <div className="flex flex-col gap-2 text-sm font-light w-11/12 text-gray-700">
              <label className="flex gap-2">
                <input
                  className="w-3"
                  type="checkbox"
                  value={"electric_drums"}
                  onChange={toggleSoundLimiters}
                  checked={soundLimiters.includes("electric_drums")}
                />{" "}
                Has Electric Drum Kit
              </label>
              <label className="flex gap-2">
                <input
                  className="w-3"
                  type="checkbox"
                  value={"iems"}
                  onChange={toggleSoundLimiters}
                  checked={soundLimiters.includes("iems")}
                />{" "}
                Uses In-ear Monitoring
              </label>
              <label className="flex gap-2">
                <input
                  className="w-3"
                  type="checkbox"
                  value={"can_you_make_act_acoustic"}
                  onChange={toggleSoundLimiters}
                  checked={soundLimiters.includes("can_you_make_act_acoustic")}
                />{" "}
                Can Make Act Acoustic
              </label>
              <label className="flex gap-2">
                <input
                  className="w-3"
                  type="checkbox"
                  value={"remove_drums"}
                  onChange={toggleSoundLimiters}
                  checked={soundLimiters.includes("remove_drums")}
                />{" "}
                Can Remove Drums From Lineup
              </label>
              <label className="flex gap-2">
                <input
                  className="w-3"
                  type="checkbox"
                  value={"80-89db"}
                  onChange={toggleSoundLimiters}
                  checked={soundLimiters.includes("80-89db")}
                />{" "}
                80-89db
              </label>
              <label className="flex gap-2">
                <input
                  className="w-3"
                  type="checkbox"
                  value={"90db"}
                  onChange={toggleSoundLimiters}
                  checked={soundLimiters.includes("90db")}
                />{" "}
                90db
              </label>
              <label className="flex gap-2">
                <input
                  className="w-3"
                  type="checkbox"
                  value={"91db"}
                  onChange={toggleSoundLimiters}
                  checked={soundLimiters.includes("91db")}
                />{" "}
                91db
              </label>
              <label className="flex gap-2">
                <input
                  className="w-3"
                  type="checkbox"
                  value={"92db"}
                  onChange={toggleSoundLimiters}
                  checked={soundLimiters.includes("92db")}
                />{" "}
                92db
              </label>
              <label className="flex gap-2">
                <input
                  className="w-3"
                  type="checkbox"
                  value={"93db"}
                  onChange={toggleSoundLimiters}
                  checked={soundLimiters.includes("93db")}
                />{" "}
                93db
              </label>
              <label className="flex gap-2">
                <input
                  className="w-3"
                  type="checkbox"
                  value={"94db"}
                  onChange={toggleSoundLimiters}
                  checked={soundLimiters.includes("94db")}
                />{" "}
                94db
              </label>
              <label className="flex gap-2">
                <input
                  className="w-3"
                  type="checkbox"
                  value={"95db"}
                  onChange={toggleSoundLimiters}
                  checked={soundLimiters.includes("95db")}
                />{" "}
                95db
              </label>
              <label className="flex gap-2">
                <input
                  className="w-3"
                  type="checkbox"
                  value={"96db"}
                  onChange={toggleSoundLimiters}
                  checked={soundLimiters.includes("96db")}
                />{" "}
                96db
              </label>
              <label className="flex gap-2">
                <input
                  className="w-3"
                  type="checkbox"
                  value={"97db"}
                  onChange={toggleSoundLimiters}
                  checked={soundLimiters.includes("97db")}
                />{" "}
                97db
              </label>
              <label className="flex gap-2">
                <input
                  className="w-3"
                  type="checkbox"
                  value={"98db"}
                  onChange={toggleSoundLimiters}
                  checked={soundLimiters.includes("98db")}
                />{" "}
                98db
              </label>
              <label className="flex gap-2">
                <input
                  className="w-3"
                  type="checkbox"
                  value={"99db"}
                  onChange={toggleSoundLimiters}
                  checked={soundLimiters.includes("99db")}
                />{" "}
                99db
              </label>
              <label className="flex gap-2">
                <input
                  className="w-3"
                  type="checkbox"
                  value={"100db"}
                  onChange={toggleSoundLimiters}
                  checked={soundLimiters.includes("100db")}
                />{" "}
                100db
              </label>
              <label className="flex gap-2">
                <input
                  className="w-3"
                  type="checkbox"
                  value={"101db"}
                  onChange={toggleSoundLimiters}
                  checked={soundLimiters.includes("101db")}
                />{" "}
                101db
              </label>
              <label className="flex gap-2">
                <input
                  className="w-3"
                  type="checkbox"
                  value={"102db"}
                  onChange={toggleSoundLimiters}
                  checked={soundLimiters.includes("102db")}
                />{" "}
                102db
              </label>
              <label className="flex gap-2">
                <input
                  className="w-3"
                  type="checkbox"
                  value={"103db"}
                  onChange={toggleSoundLimiters}
                  checked={soundLimiters.includes("103db")}
                />{" "}
                103db
              </label>
              <label className="flex gap-2">
                <input
                  className="w-3"
                  type="checkbox"
                  value={"104db"}
                  onChange={toggleSoundLimiters}
                  checked={soundLimiters.includes("104db")}
                />{" "}
                104db
              </label>
              <label className="flex gap-2">
                <input
                  className="w-3"
                  type="checkbox"
                  value={"105db"}
                  onChange={toggleSoundLimiters}
                  checked={soundLimiters.includes("105db")}
                />{" "}
                105db
              </label>
              <label className="flex gap-2">
                <input
                  className="w-3"
                  type="checkbox"
                  value={"106db"}
                  onChange={toggleSoundLimiters}
                  checked={soundLimiters.includes("106db")}
                />{" "}
                106db
              </label>
              <label className="flex gap-2">
                <input
                  className="w-3"
                  type="checkbox"
                  value={"107db"}
                  onChange={toggleSoundLimiters}
                  checked={soundLimiters.includes("107db")}
                />{" "}
                107db +
              </label>{" "}
            </div>
          )}

          {/* Setup & Soundcheck Time filter */}
          <p
            onClick={() =>
              setShowSetupAndSoundcheckFilter(!showSetupAndSoundcheckFilter)
            }
            className="mb-3 mt-3 text-sm font-medium flex items-center cursor-pointer gap-2"
          >
            SETUP & SOUNDCHECK
            <img
              className={`h-3 transition-transform duration-300 ${showSetupAndSoundcheckFilter ? "rotate-90" : ""}`}
              src={assets.dropdown_icon}
              alt=""
            />
          </p>

          {/* Setup and Soundcheck filter */}
          {showSetupAndSoundcheckFilter && (
            <div className="flex flex-col gap-2 text-sm font-light w-11/12 text-gray-700">
              <p className="flex gap-2">
                <input
                  className="w-3"
                  type="checkbox"
                  value={"setup_and_soundcheck_time_60min"}
                  onChange={toggleSetupAndSoundcheck}
                  checked={setupAndSoundcheck.includes(
                    "setup_and_soundcheck_time_60min"
                  )}
                />{" "}
                60min Setup & Soundcheck
              </p>
              <p className="flex gap-2">
                <input
                  className="w-3"
                  type="checkbox"
                  value={"setup_and_soundcheck_time_90min"}
                  onChange={toggleSetupAndSoundcheck}
                  checked={setupAndSoundcheck.includes(
                    "setup_and_soundcheck_time_90min"
                  )}
                />{" "}
                90min Setup & Soundcheck
              </p>
              <p className="flex gap-2">
                <input
                  className="w-3"
                  type="checkbox"
                  value={"speedy_setup"}
                  onChange={toggleSetupAndSoundcheck}
                  checked={setupAndSoundcheck.includes("speedy_setup")}
                />{" "}
                60min Speedy Setup & Soundcheck
              </p>
            </div>
          )}

          {/* PA and Lights filter */}
          <p
            onClick={() => setShowPaAndLightsFilter(!showPaAndLightsFilter)}
            className="mb-3 mt-3 text-sm font-medium flex items-center cursor-pointer gap-2"
          >
            PA & LIGHTS
            <img
              className={`h-3 transition-transform duration-300 ${showPaAndLightsFilter ? "rotate-90" : ""}`}
              src={assets.dropdown_icon}
              alt=""
            />
          </p>

          {/* PA and Lights  dropdown */}
          {showPaAndLightsFilter && (
            <div className="flex flex-col gap-2 text-sm font-light w-11/12 text-gray-700">
              <p className="flex gap-2">
                <input
                  className="w-3"
                  type="checkbox"
                  value={"small_pa_size"}
                  onChange={togglePaAndLights}
                  checked={paAndLights.includes("small_pa_size")}
                />{" "}
                Small PA System
              </p>
              <p className="flex gap-2">
                <input
                  className="w-3"
                  type="checkbox"
                  value={"medium_pa_size"}
                  onChange={togglePaAndLights}
                  checked={paAndLights.includes("medium_pa_size")}
                />{" "}
                Medium PA System
              </p>
              <p className="flex gap-2">
                <input
                  className="w-3"
                  type="checkbox"
                  value={"large_pa_size"}
                  onChange={togglePaAndLights}
                  checked={paAndLights.includes("large_pa_size")}
                />{" "}
                Large PA System
              </p>
              <p className="flex gap-2">
                <input
                  className="w-3"
                  type="checkbox"
                  value={"small_light_size"}
                  onChange={togglePaAndLights}
                  checked={paAndLights.includes("small_light_size")}
                />{" "}
                Small Light System
              </p>
              <p className="flex gap-2">
                <input
                  className="w-3"
                  type="checkbox"
                  value={"medium_light_size"}
                  onChange={togglePaAndLights}
                  checked={paAndLights.includes("medium_light_size")}
                />{" "}
                Medium Light System
              </p>
              <p className="flex gap-2">
                <input
                  className="w-3"
                  type="checkbox"
                  value={"large_light_size"}
                  onChange={togglePaAndLights}
                  checked={paAndLights.includes("large_light_size")}
                />{" "}
                Large Light System
              </p>
            </div>
          )}

          {/* PLI filter */}
          <p
            onClick={() => setShowPliFilter(!showPliFilter)}
            className="mb-3 mt-3 text-sm font-medium flex items-center cursor-pointer gap-2"
          >
            PLI
            <img
              className={`h-3 transition-transform duration-300 ${showPliFilter ? "rotate-90" : ""}`}
              src={assets.dropdown_icon}
              alt=""
            />
          </p>

          {/* pli options dropdown */}
          {showPliFilter && (
            <div className="flex flex-col gap-2 text-sm font-light w-11/12 text-gray-700">
              <label className="flex gap-2">
                <input
                  className="w-3"
                  type="checkbox"
                  value={1}
                  onChange={togglePli}
                  checked={pli.some((value) => value >= 1)}
                />{" "}
                Up to £1m
              </label>
              <label className="flex gap-2">
                <input
                  className="w-3"
                  type="checkbox"
                  value={2}
                  onChange={togglePli}
                  checked={pli.some((value) => value >= 2)}
                />{" "}
                Up to £2m
              </label>
              <label className="flex gap-2">
                <input
                  className="w-3"
                  type="checkbox"
                  value={3}
                  onChange={togglePli}
                  checked={pli.some((value) => value >= 3)}
                />{" "}
                Up to £3m
              </label>
              <label className="flex gap-2">
                <input
                  className="w-3"
                  type="checkbox"
                  value={4}
                  onChange={togglePli}
                  checked={pli.some((value) => value >= 4)}
                />{" "}
                Up to £4m
              </label>
              <label className="flex gap-2">
                <input
                  className="w-3"
                  type="checkbox"
                  value={5}
                  onChange={togglePli}
                  checked={pli.some((value) => value >= 5)}
                />{" "}
                Up to £5m
              </label>
              <label className="flex gap-2">
                <input
                  className="w-3"
                  type="checkbox"
                  value={10}
                  onChange={togglePli}
                  checked={pli.some((value) => value >= 10)}
                />{" "}
                Up to £10m
              </label>
              <label className="flex gap-2">
                <input
                  className="w-3"
                  type="checkbox"
                  value={15}
                  onChange={togglePli}
                  checked={pli.some((value) => value >= 15)}
                />{" "}
                Up to £15m
              </label>
              <label className="flex gap-2">
                <input
                  className="w-3"
                  type="checkbox"
                  value={20}
                  onChange={togglePli}
                  checked={pli.some((value) => value >= 20)}
                />{" "}
                Up to £20m
              </label>
            </div>
          )}

          {/*Extra services filter */}
          <p
            onClick={() => setShowExtraServicesFilter(!showExtraServicesFilter)}
            className="mb-3 mt-3 text-sm font-medium flex items-center cursor-pointer gap-2"
          >
            EXTRA SERVICES
            <img
              className={`h-3 transition-transform duration-300 ${showExtraServicesFilter ? "rotate-90" : ""}`}
              src={assets.dropdown_icon}
              alt=""
            />
          </p>

          {/*Extra services filter */}
          {showExtraServicesFilter && (
            <div className="flex flex-col gap-2 text-sm font-light w-11/12 text-gray-700">
              <p className="flex gap-2">
                <input
                  className="w-3"
                  type="checkbox"
                  value={"ceremony_solo"}
                  onChange={toggleExtraServices}
                  checked={extraServices.includes("ceremony_solo")}
                />{" "}
                Ceremony Solo
              </p>
              <p className="flex gap-2">
                <input
                  className="w-3"
                  type="checkbox"
                  value={"duo_ceremony"}
                  onChange={toggleExtraServices}
                  checked={extraServices.includes("duo_ceremony")}
                />{" "}
                Ceremony Duo
              </p>
              <p className="flex gap-2">
                <input
                  className="w-3"
                  type="checkbox"
                  value={"trio_ceremony"}
                  onChange={toggleExtraServices}
                  checked={extraServices.includes("trio_ceremony")}
                />{" "}
                Ceremony Trio
              </p>
              <p className="flex gap-2">
                <input
                  className="w-3"
                  type="checkbox"
                  value={"four_piece_ceremony"}
                  onChange={toggleExtraServices}
                  checked={extraServices.includes("four_piece_ceremony")}
                />{" "}
                Ceremony 4-piece
              </p>
              <p className="flex gap-2">
                <input
                  className="w-3"
                  type="checkbox"
                  value={"afternoon_solo"}
                  onChange={toggleExtraServices}
                  checked={extraServices.includes("afternoon_solo")}
                />{" "}
                Afternoon Reception Solo
              </p>
              <p className="flex gap-2">
                <input
                  className="w-3"
                  type="checkbox"
                  value={"afternoon_duo"}
                  onChange={toggleExtraServices}
                  checked={extraServices.includes("afternoon_duo")}
                />{" "}
                Afternoon Reception Duo
              </p>
              <p className="flex gap-2">
                <input
                  className="w-3"
                  type="checkbox"
                  value={"afternoon_trio"}
                  onChange={toggleExtraServices}
                  checked={extraServices.includes("afternoon_trio")}
                />{" "}
                Afternoon Reception Trio
              </p>
              <p className="flex gap-2">
                <input
                  className="w-3"
                  type="checkbox"
                  value={"afternoon_4piece"}
                  onChange={toggleExtraServices}
                  checked={extraServices.includes("afternoon_4piece")}
                />{" "}
                Afternoon Reception 4-piece
              </p>
              <p className="flex gap-2">
                <input
                  className="w-3"
                  type="checkbox"
                  value={"early_arrival"}
                  onChange={toggleExtraServices}
                  checked={extraServices.includes("early_arrival")}
                />{" "}
                Early Arrival
              </p>
              <p className="flex gap-2">
                <input
                  className="w-3"
                  type="checkbox"
                  value={"late_stay"}
                  onChange={toggleExtraServices}
                  checked={extraServices.includes("late_stay")}
                />{" "}
                Late Stay
              </p>
              <p className="flex gap-2">
                <input
                  className="w-3"
                  type="checkbox"
                  value={"extra_song"}
                  onChange={toggleExtraServices}
                  checked={extraServices.includes("extra_song")}
                />{" "}
                Extra Song Requests
              </p>
              <p className="flex gap-2">
                <input
                  className="w-3"
                  type="checkbox"
                  value={"extra_sets"}
                  onChange={toggleExtraServices}
                  checked={extraServices.includes("extra_sets")}
                />{" "}
                Extra Main Performance Sets
              </p>
              <p className="flex gap-2">
                <input
                  className="w-3"
                  type="checkbox"
                  value={"add_another_vocalist"}
                  onChange={toggleExtraServices}
                  checked={extraServices.includes("add_another_vocalist")}
                />{" "}
                Add Another Vocalist
              </p>
              <p className="flex gap-2">
                <input
                  className="w-3"
                  type="checkbox"
                  value={"sound_engineering_for_another_act"}
                  onChange={toggleExtraServices}
                  checked={extraServices.includes(
                    "sound_engineering_for_another_act"
                  )}
                />{" "}
                Sound Engineering for Another Act
              </p>
              <p className="flex gap-2">
                <input
                  className="w-3"
                  type="checkbox"
                  value={"israeli_sets"}
                  onChange={toggleExtraServices}
                  checked={extraServices.includes("israeli_sets")}
                />{" "}
                Israeli Dancing Sets
              </p>
            </div>
          )}
        </div>
      </div>
      {/* Right side */}
      <div className="flex-1">
        <div className="flex justify-left text-base justify-between sm:text-2xl mb-4">
          <Title text1={"ALL"} text2={"ACTS"} />

          {/* Current Address in State */}
          <div className="flex text-base sm:text-2xl justify-between gap-6">
            {/* Product/Act Sort */}
            <select
              className="border-2 border-gray-300 text-sm px-2"
              onChange={(e) => setSortType(e.target.value)}
              value={sortType}
            >
              <option value="relevent">Sort by: Relevant</option>
              <option value="low-high">Sort by: Low to High</option>
              <option value="high-low">Sort by: High to Low</option>
            </select>
          </div>
        </div>
        {/* ✅ Now dynamically shows selected date & address */}
        <div>
          {selectedDate && selectedAddress ? (
            <p className="text-sm mt-3 justify-right p-2 text-gray-500">
              Showing Results for:
              <span className="text-gray-700">
                {" "}
                {formatDate(selectedDate)} at{" "}
                {storedPlace && `${storedPlace}, `}
                {selectedAddress}{" "}
              </span>
              <span
                onClick={() => triggerSearch()}
                className="text-blue-600 cursor-pointer underline ml-2"
              >
                edit search
              </span>
            </p>
          ) : (
            <p className="text-sm mt-3 justify-right p-2 text-gray-500">
              Please select a date and location for an accurate quote!
              <span
                onClick={() => triggerSearch()}
                className="text-blue-600 cursor-pointer underline ml-2"
              >
                Begin Search
              </span>
            </p>
          )}
        </div>
        
        <div>
          
          {(genre.length > 0 ||
            act_size.length > 0 ||
            djServices.length > 0 ||
            songSearch.length > 0 ||
            actSearch.length > 0 ||
            instruments.length > 0 ||
            wireless.length > 0 ||
            soundLimiters.length > 0 ||
            setupAndSoundcheck.length > 0 ||
            paAndLights.length > 0 ||
            pli.length > 0 ||
            extraServices.length > 0) && (
            <div className="flex flex-wrap gap-2 p-2 mb-4 border-b">
              {updatingResults && (
  <div className="w-full sm:ml-0 mb-2 px-3 py-2 text-sm text-gray-600 bg-gray-100 border border-gray-200 rounded">
    Updating results…
  </div>
)}

              
              {[
                ...genre,
                ...act_size,
                ...djServices,
                ...instruments,
                ...wireless,
                ...soundLimiters,
                ...setupAndSoundcheck,
                ...paAndLights,
                ...pli,
                ...extraServices,
              ].map((item) => (
                <span
                  key={item}
                  className="bg-gray-200 text-gray-700 text-xs px-2 py-1 rounded flex items-center gap-2"
                >
                  {labelMap[item] || item}{" "}
                  {/* Use labelMap to show a friendly name */}
                  <button
                    onClick={() => {
                      if (genre.includes(item))
                        toggleGenre({ target: { value: item } });
                      else if (act_size.includes(item))
                        toggleActSize({ target: { value: item } });
                      else if (djServices.includes(item))
                        toggleDjServices({ target: { value: item } });
                      else if (instruments.includes(item))
                        toggleInstruments({ target: { value: item } });
                      else if (wireless.includes(item))
                        toggleWireless({ target: { value: item } });
                      else if (soundLimiters.includes(item))
                        toggleSoundLimiters({ target: { value: item } });
                      else if (setupAndSoundcheck.includes(item))
                        toggleSetupAndSoundcheck({ target: { value: item } });
                      else if (paAndLights.includes(item))
                        togglePaAndLights({ target: { value: item } });
                      else if (pli.includes(item))
                        togglePli({ target: { value: item } });
                      else if (extraServices.includes(item))
                        toggleExtraServices({ target: { value: item } });
                    }}
                    className="text-gray-100 text-xs font-bold"
                  >
                    ✖️
                  </button>
                </span>
              ))}

              {/* Song or Artist Search */}
              {songSearch.map((item) => (
                <span
                  key={item}
                  className="bg-gray-200 text-gray-700 text-xs px-2 py-1 rounded flex items-center gap-2"
                >
                  {item} {/* User input appears as a tag */}
                  <button
                    onClick={() =>
                      setSongSearch(songSearch.filter((song) => song !== item))
                    }
                    className="text-gray-100 text-xs font-bold"
                  >
                    ✖️
                  </button>
                </span>
              ))}

              {/* Act Name Search */}
              {actSearch.map((item) => (
                <span
                  key={item}
                  className="bg-gray-200 text-gray-700 text-xs px-2 py-1 rounded flex items-center gap-2"
                >
                  {item} {/* User input appears as a tag */}
                  <button
                    onClick={() =>
                      setActSearch(actSearch.filter((act) => act !== item))
                    }
                    className="text-gray-100 text-xs font-bold"
                  >
                    ✖️
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>
        {/* Map products / acts */}
        
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 gap-y-6">
        {selectedDate && availLoading ? (
          <div className="col-span-2 md:col-span-3 lg:col-span-4 p-6 text-center text-gray-600">
            Checking availability…
          </div>
        ) : (
          filterProducts.map((item, index) => (
           <ActItem
  key={item._id}
  actData={item}
  isShortlisted={isShortlisted(item._id)}
  onShortlistToggle={() => shortlistAct(userId, item._id)}
  price={item.formattedPrice}
/>
          ))
        )}
      </div>
      </div>
    </div>
  );
};

export default Acts;
