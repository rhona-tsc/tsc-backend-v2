import React, { useEffect, useState } from "react";
import { assets } from "../assets/assets"; // Ensure this imports the dropdown icon
import { postcodes } from "../assets/assets"; // Ensure this imports the postcode data

const ExtrasFilter = ({
  actData,
  currency,
  selectedExtras,
  setSelectedExtras,
  selectedLineup,
  state,
}) => {
  if (!actData) return null;

  // ✅ Extract ceremony extras dynamically
  const {
    ceremony_solo,
    duo_ceremony,
    trio_ceremony,
    four_piece_ceremony,
    afternoon_duo,
    afternoon_solo,
    afternoon_trio,
    afternoon_4piece,
    solo_ceremony_and_afternoon_duo,
    solo_ceremony_and_afternoon_trio,
    solo_ceremony_and_afternoon_4piece,
    duo_ceremony_and_afternoon_trio,
    duo_cermeony_and_4piece,
    djServices,
    extra_sets,
    late_stay,
    early_arrival,
    soundLimiters,
    fee_allocation,
    travel_fee,
    setupAndSoundcheck,
    israeli_sets,
    extra_song,
    sound_engineering_for_another_act,
  } = actData;

  // ✅ Manage dropdown toggle states
  const [showExtras, setShowExtras] = useState(false);
  const [showSoloExtras, setShowSoloExtras] = useState(false);
  const [showDuoExtras, setShowDuoExtras] = useState(false);
  const [showTrioExtras, setShowTrioExtras] = useState(false);
  const [showLateStayExtras, setShowLateStayExtras] = useState(false);
  const [showExtraSets, setShowExtraSets] = useState(false);
  const [showEarlyArrivalExtras, setShowEarlyArrivalExtras] = useState(false);
  const [showOtherExtras, setShowOtherExtras] = useState(false);
  const [showFourPieceExtras, setShowFourPieceExtras] = useState(false);
  const [showAfternoonSoloExtras, setShowAfternoonSoloExtras] = useState(false);
  const [showAfternoonDuoExtras, setShowAfternoonDuoExtras] = useState(false);
  const [showAfternoonTrioExtras, setShowAfternoonTrioExtras] = useState(false);
  const [showAfternoonFourPieceExtras, setShowAfternoonFourPieceExtras] =
    useState(false);
  const [
    showDuoCeremonyAfternoonFourPieceExtras,
    setShowDuoCeremonyAfternoonFourPieceExtras,
  ] = useState(false);
  const [
    showSoloCeremonyAfternoonTrioExtras,
    setShowSoloCeremonyAfternoonTrioExtras,
  ] = useState(false);
  const [
    showSoloCeremonyAfternoonDuoExtras,
    setShowSoloCeremonyAfternoonDuoExtras,
  ] = useState(false);
  const [
    showSoloCeremonyAfternoonFourPieceExtras,
    setShowSoloCeremonyAfternoonFourPieceExtras,
  ] = useState(false);
  const [
    showDuoCeremonyAfternoonTrioExtras,
    setShowDuoCeremonyAfternoonTrioExtras,
  ] = useState(false);
  const [showAfternoon60min, setShowAfternoon60min] = useState(false);
  const [showAfternoon90min, setShowAfternoon90min] = useState(false);
  const [showAfternoonCombo60min, setShowAfternoonCombo60min] = useState(false);
  const [showAfternoonCombo90min, setShowAfternoonCombo90min] = useState(false);
  const [showCeremonyExtras, setShowCeremonyExtras] = useState(false);
  const [showAfternoonExtras, setShowAfternoonExtras] = useState(false);
  const [showAfternoonComboExtras, setShowAfternoonComboExtras] =
    useState(false);
  const [showDjExtras, setShowDjExtras] = useState(false);

  const calculateTravelFeePerMusician = (act, selectedCounty, newLineup) => {
    if (!newLineup || !selectedCounty) {
      console.warn("⚠️ Missing lineup or county", {
        newLineup,
        selectedCounty,
      });
      return 0;
    }
    if (!act || !Array.isArray(act.travel_fee)) {
      console.warn("⚠️ Invalid act data:", { act });
      return 0;
    }

    // ✅ Normalize County & Lineup
    let normalizedCounty = selectedCounty?.trim().toLowerCase();
    let normalizedLineup = newLineup?.substring(0, 3).trim().toLowerCase();

    console.log("📌 Normalized Lineup:", normalizedLineup);

    // ✅ Find matching travel fee
    let travelFee = 0;
    const matchingTravelFee = act.travel_fee.find(
      (fee) =>
        fee.act_size.substring(0, 3).trim().toLowerCase() === normalizedLineup
    );

    if (matchingTravelFee && matchingTravelFee.travel_fees) {
      travelFee = matchingTravelFee.travel_fees[normalizedCounty] || 0;
    } else {
      console.warn(
        `⚠️ No travel fee found for ${normalizedLineup} in ${normalizedCounty}`
      );
    }

    console.log("🚗 Travel Fee for selected county:", travelFee);

    // ✅ Get lineup size from newLineup
    const lineupSizeMatch = newLineup.match(/\d+/);
    const lineupSize = lineupSizeMatch ? parseInt(lineupSizeMatch[0]) : 1;

    console.log(
      `🎼 Lineup Size: ${lineupSize}, Travel Fee: ${travelFee}, Per Musician: ${travelFee / lineupSize}`
    );

    return travelFee / lineupSize; // ✅ Divide travel fee per musician
  }; // ✅ Get travel fee directly from existing calculation (line 331)
  const totalTravelFee = 130; // 🚗 Travel Fee already calculated

  // ✅ Extract lineup size from the normalized lineup (line 301)
  const extractLineupSize = (lineup) => {
    const match = lineup.match(/\d+/);
    return match ? parseInt(match[0]) : 1; // Default to 1 if not found
  };

  // ✅ Compute travel fee per musician
  const lineupSize = extractLineupSize("4-p"); // 🎼 Extracted from line 301
  const travelFeePerMusician = Math.ceil(totalTravelFee / lineupSize); // 🔄 Round up

  console.log("🚗 Travel Fee Per Musician:", travelFeePerMusician);

  // ✅ Now use travelFeePerMusician in other calculations
  const removeDrumsFee = soundLimiters?.remove_drums
    ? (() => {
        const feeData = actData.fee_allocation.find((f) =>
          f.act_size.toLowerCase().includes(selectedLineup.toLowerCase())
        );
        const drumsFee = feeData?.fee_allocations?.drums || 0;
        return (drumsFee + travelFeePerMusician) * -1; // ✅ Convert to negative value
      })()
    : 0;

  const addVocalistFee = 300 + travelFeePerMusician;
  const speedySetupFee = setupAndSoundcheck?.speedy_setup
    ? setupAndSoundcheck.speedy_setup + travelFeePerMusician
    : 0;

 

  // ✅ Function to format "extra song request" labels
  const formatExtraSongLabel = () => "Extra Song Request";

  // ✅ Function to format "Israeli dancing" labels
  const formatIsraeliDancingLabel = () => "20mins Israeli Dancing Set";

  // ✅ Function to format "Speedy Setup" label
  const formatOtherExtrasLabel = (key) =>
    key === "speedy_setup" ? "Speedy 1hr Setup & Soundcheck" : key;


  // ✅ Ensures only one ceremony option can be selected at a time
  const handleCeremonySelection = (selectedKey) => {
    setSelectedExtras([selectedKey]); // ✅ Only the selected key remains
  };

  const formatCeremonyLabel = (key) => {
    return key
      .replace(/_/g, " ") // Replace underscores with spaces
      .replace("solo ceremony performance", "Solo from") // Adjust prefix
      .replace("duo ceremony performance", "Duo from") // Adjust prefix
      .replace("trio ceremony performance", "Trio from") // Adjust prefix
      .replace("four piece ceremony performance", "4-Piece from") // Adjust prefix
      .replace(/(\d{1,2})(\d{2})(am|pm)/, "$1.$2$3"); // Convert 1230pm → 12.30pm
  };

  // ✅ Ensures only one ceremony option can be selected at a time
  const handleAfternoonSelection = (selectedKey) => {
    setSelectedExtras([selectedKey]); // ✅ Only the selected key remains
  };

  const formatAfternoonLabel = (key) => {
    return key
      .replace(/_/g, " ") // Replace underscores with spaces
      .replace("solo 60min afternoon performance", "from") // Adjust prefix
      .replace("solo 90min afternoon performance", "from") // Adjust prefix
      .replace("duo 60min afternoon performance", "from") // Adjust prefix
      .replace("duo 90min afternoon performance", "from") // Adjust prefix
      .replace("trio 60min afternoon performance", "from") // Adjust prefix
      .replace("trio 90min afternoon performance", "from") // Adjust prefix
      .replace("four 60min piece afternoon performance", "from") // Adjust prefix
      .replace("four 90min piece afternoon performance", "from") // Adjust prefix
      .replace(/(\d{1,2})(\d{2})(am|pm)/, "$1.$2$3"); // Convert 1230pm → 12.30pm
  };

  // ✅ Ensures only one ceremony option can be selected at a time
  const handleAfternoonComboSelection = (selectedKey) => {
    setSelectedExtras([selectedKey]); // ✅ Only the selected key remains
  };

  const formatAfternoonComboLabel = (key) => {
    return key
      .replace(/_/g, " ") // Replace underscores with spaces
      .replace("solo ceremony 60min afternoon duo performance", "from") // Adjust prefix
      .replace("solo ceremony 90min afternoon duo performance", "from") // Adjust prefix
      .replace("solo ceremony 60min afternoon trio performance", "from") // Adjust prefix
      .replace("solo ceremony 90min afternoon trio performance", "from") // Adjust prefix
      .replace("solo ceremony 60min afternoon 4 piece performance", "from") // Adjust prefix
      .replace("solo ceremony 90min afternoon 4 piece performance", "from") // Adjust prefix
      .replace("duo ceremony 60min afternoon trio performance", "from") // Adjust prefix
      .replace("duo ceremony 90min afternoon trio performance", "from") // Adjust prefix
      .replace("duo ceremony 60min afternoon 4 piece performance", "from") // Adjust prefix
      .replace("duo ceremony 90min afternoon 4 piece performance", "from") // Adjust prefix
      .replace(/(\d{1,2})(\d{2})(am|pm)/, "$1.$2$3"); // Convert 1230pm → 12.30pm
  };

  // ✅ Ensures only one ceremony option can be selected at a time
  const handleDjExtrasSelection = (selectedKey) => {
    setSelectedExtras([selectedKey]); // ✅ Only the selected key remains
  };

  const formatLabel = (key) => {
    const formattedKey = key
      .replace(/_/g, " ") // Replace underscores with spaces
      .replace("background music playlist", "Playlist 'DJ Service'")
      .replace("up to 3 hours manned playlist", "Manned Playlist")
      .replace("up to 3 hours band member DJ", "Band Member DJing")
      .replace("DJ live sax 3x30mins", "DJ Live w Saxophone")
      .replace("DJ live bongos 3x30mins", "DJ Live w Bongos")
      .replace(
        "DJ live bongos and sax 3x30mins",
        "DJ Live w Saxophone & Bongos"
      );

    const extraInfo = key.includes("DJ live sax 3x30mins")
      ? "(up to 3 hrs w 3x30mins sax)"
      : key.includes("DJ live bongos 3x30mins")
        ? "(up to 3 hrs w 3x30mins bongos)"
        : key.includes("DJ live bongos and sax 3x30mins")
          ? "(up to 3 hrs w 3x30mins sax & bongos)"
          : "";

    return { mainText: formattedKey, extraText: extraInfo };
  };

  // ✅ Ensures only one ceremony option can be selected at a time
  const handleExtraSetsSelection = (selectedKey) => {
    setSelectedExtras([selectedKey]); // ✅ Only the selected key remains
  };

  const formatExtraSetsLabel = (key) => {
    const match = key.match(/extra_(\d{2})min_performance_\d+_piece/);
    if (match) {
      return `${match[1]}mins extra`;
    }
    return key.replace(/_/g, " "); // Fallback for keys that don't match
  };

  // ✅ Function to filter extra sets based on the first 3 letters of the selected lineup
  const getFilteredExtraSets = (selectedLineup, extra_sets) => {
    if (!selectedLineup) return extra_sets; // If no lineup is selected, return all extra sets.

    const lineupPrefix = selectedLineup.slice(0, 3).toLowerCase(); // Extract first 3 characters in lowercase.

    return Object.fromEntries(
      Object.entries(extra_sets).filter(([key]) =>
        key.toLowerCase().includes(lineupPrefix)
      )
    );
  };

  // ✅ Get filtered extra sets dynamically based on selected lineup
  const filteredExtraSets = getFilteredExtraSets(selectedLineup, extra_sets);

  // ✅ Ensures only one ceremony option can be selected at a time
  const handleLateStaySelection = (selectedKey) => {
    setSelectedExtras([selectedKey]); // ✅ Only the selected key remains
  };

  // Function to filter based on selected lineup
  const getFilteredLateStay = (selectedLineup, late_stay) => {
    if (!selectedLineup) return late_stay; // If no lineup is selected, return all

    const lineupPrefix = selectedLineup
      ? selectedLineup.slice(0, 3).toLowerCase()
      : "";

    return Object.fromEntries(
      Object.entries(late_stay).filter(([key]) =>
        key.toLowerCase().includes(lineupPrefix)
      )
    );
  };

  const filteredLateStayExtras = getFilteredLateStay(selectedLineup, late_stay);

  // Function to format labels dynamically
  const formatLateStayLabel = (key) => {
    const match = key.match(/late_stay_(\d{2})min_\d+_piece/);

    if (match) {
      return match[1] === "30" ? "until 12.30am" : "until 1am";
    }
    return key.replace(/_/g, " "); // Fallback for unknown keys
  };

  // Function to filter based on selected lineup
  const getFilteredEarlyArrival = (selectedLineup, early_arrival) => {
    if (!selectedLineup) return early_arrival; // If no lineup is selected, return all

    const lineupPrefix = selectedLineup
      ? selectedLineup.slice(0, 3).toLowerCase()
      : "";

    return Object.fromEntries(
      Object.entries(early_arrival).filter(([key]) =>
        key.toLowerCase().includes(lineupPrefix)
      )
    );
  };

  const filteredEarlyArrivalExtras = getFilteredEarlyArrival(
    selectedLineup,
    early_arrival
  );

  const formatEarlyArrivalLabel = (key) => {
    const match = key.match(/early_arrival_(\d+)min_\d+_piece/); // Match any number of digits

    if (match) {
      const minutes = match[1]; // Extract matched minutes (as string)

      // Map minutes to readable format
      const timeMap = {
        30: "30mins",
        60: "1hr",
        90: "1.5hrs",
        120: "2hrs",
        150: "2.5hrs",
        180: "3hrs",
        210: "3.5hrs",
        240: "4hrs",
      };

      return timeMap[minutes] || key; // Return formatted time or fallback to key
    }

    return key.replace(/_/g, " "); // Fallback if regex doesn't match
  };

  useEffect(() => {
    if (typeof onExtrasPricesUpdate === "function") {
      const dynamicExtras = {};
  
      if (extra_song) {
        Object.entries(extra_song).forEach(([key, price]) => {
          dynamicExtras[key] = price;
        });
      }
  
      if (israeli_sets) {
        Object.entries(israeli_sets).forEach(([key, price]) => {
          dynamicExtras[key] = price;
        });
      }
  
      onExtrasPricesUpdate({
        remove_drums: removeDrumsFee,
        sound_engineering_for_another_act: sound_engineering_for_another_act || 0, // ✅ dynamically added here
        add_another_vocalist: addVocalistFee,
        speedy_setup: speedySetupFee,
        ...dynamicExtras,
      });
    }
  }, [removeDrumsFee, addVocalistFee, speedySetupFee, extra_song, israeli_sets, sound_engineering_for_another_act]);
  

  

  const exclusiveCategories = {
    ceremonyAndAfternoonSets: [
      "solo_ceremony_performance_12pm",
"solo_ceremony_performance_1230pm",
"solo_ceremony_performance_1pm",
"solo_ceremony_performance_130pm",
"duo_ceremony_performance_12pm",
"duo_ceremony_performance_1230pm",
"duo_ceremony_performance_1pm",
"duo_ceremony_performance_130pm",
"trio_ceremony_performance_12pm",
"trio_ceremony_performance_1230pm",
"trio_ceremony_performance_1pm",
"trio_ceremony_performance_130pm",
"four_piece_ceremony_performance_12pm",
"four_piece_ceremony_performance_1230pm",
"four_piece_ceremony_performance_1pm",
"four_piece_ceremony_performance_130pm",
"solo_60min_afternoon_performance_1pm",
"solo_60min_afternoon_performance_130pm",
"solo_60min_afternoon_performance_2pm",
"solo_60min_afternoon_performance_230pm",
"solo_60min_afternoon_performance_3pm",
"solo_60min_afternoon_performance_330pm",
"solo_60min_afternoon_performance_4pm",
"solo_90min_afternoon_performance_1pm",
"solo_90min_afternoon_performance_130pm",
"solo_90min_afternoon_performance_2pm",
"solo_90min_afternoon_performance_230pm",
"solo_90min_afternoon_performance_3pm",
"solo_90min_afternoon_performance_330pm",
"duo_60min_afternoon_performance_1pm",
"duo_60min_afternoon_performance_130pm",
"duo_60min_afternoon_performance_2pm",
"duo_60min_afternoon_performance_230pm",
"duo_60min_afternoon_performance_3pm",
"duo_60min_afternoon_performance_330pm",
"duo_60min_afternoon_performance_4pm",
"duo_90min_afternoon_performance_1pm",
"duo_90min_afternoon_performance_130pm",
"duo_90min_afternoon_performance_2pm",
"duo_90min_afternoon_performance_230pm",
"duo_90min_afternoon_performance_3pm",
"duo_90min_afternoon_performance_330pm",
"trio_60min_afternoon_performance_1pm",
"trio_60min_afternoon_performance_130pm",
"trio_60min_afternoon_performance_2pm",
"trio_60min_afternoon_performance_230pm",
"trio_60min_afternoon_performance_3pm",
"trio_60min_afternoon_performance_330pm",
"trio_60min_afternoon_performance_4pm",
"trio_90min_afternoon_performance_1pm",
"trio_90min_afternoon_performance_130pm",
"trio_90min_afternoon_performance_2pm",
"trio_90min_afternoon_performance_230pm",
"trio_90min_afternoon_performance_3pm",
"trio_90min_afternoon_performance_330pm",
"four_60min_piece_afternoon_performance_1pm",
"four_60min_piece_afternoon_performance_130pm",
"four_60min_piece_afternoon_performance_2pm",
"four_60min_piece_afternoon_performance_230pm",
"four_60min_piece_afternoon_performance_3pm",
"four_60min_piece_afternoon_performance_330pm",
"four_60min_piece_afternoon_performance_4pm",
"four_90min_piece_afternoon_performance_1pm",
"four_90min_piece_afternoon_performance_130pm",
"four_90min_piece_afternoon_performance_2pm",
"four_90min_piece_afternoon_performance_230pm",
"four_90min_piece_afternoon_performance_3pm",
"four_90min_piece_afternoon_performance_330pm",
"solo_ceremony_60min_afternoon_duo_performance_12pm",
"solo_ceremony_60min_afternoon_duo_performance_1230pm",
"solo_ceremony_60min_afternoon_duo_performance_1pm",
"solo_ceremony_60min_afternoon_duo_performance_130pm",
"solo_ceremony_60min_afternoon_duo_performance_2pm",
"solo_ceremony_60min_afternoon_duo_performance_230pm",
"solo_ceremony_60min_afternoon_duo_performance_3pm",
"solo_ceremony_60min_afternoon_duo_performance_330pm",
"solo_ceremony_90min_afternoon_duo_performance_12pm",
"solo_ceremony_90min_afternoon_duo_performance_1230pm",
"solo_ceremony_90min_afternoon_duo_performance_1pm",
"solo_ceremony_90min_afternoon_duo_performance_130pm",
"solo_ceremony_90min_afternoon_duo_performance_2pm",
"solo_ceremony_90min_afternoon_duo_performance_230pm",
"solo_ceremony_90min_afternoon_duo_performance_3pm",
"solo_ceremony_90min_afternoon_duo_performance_330pm",
"solo_ceremony_60min_afternoon_trio_performance_12pm",
"solo_ceremony_60min_afternoon_trio_performance_1230pm",
"solo_ceremony_60min_afternoon_trio_performance_1pm",
"solo_ceremony_60min_afternoon_trio_performance_130pm",
"solo_ceremony_60min_afternoon_trio_performance_2pm",
"solo_ceremony_60min_afternoon_trio_performance_230pm",
"solo_ceremony_60min_afternoon_trio_performance_3pm",
"solo_ceremony_60min_afternoon_trio_performance_330pm",
"solo_ceremony_90min_afternoon_trio_performance_12pm",
"solo_ceremony_90min_afternoon_trio_performance_1230pm",
"solo_ceremony_90min_afternoon_trio_performance_1pm",
"solo_ceremony_90min_afternoon_trio_performance_130pm",
"solo_ceremony_90min_afternoon_trio_performance_2pm",
"solo_ceremony_90min_afternoon_trio_performance_230pm",
"solo_ceremony_90min_afternoon_trio_performance_3pm",
"solo_ceremony_90min_afternoon_trio_performance_330pm",
"solo_ceremony_60min_afternoon_4_piece_performance_12pm",
"solo_ceremony_60min_afternoon_4_piece_performance_1230pm",
"solo_ceremony_60min_afternoon_4_piece_performance_1pm",
"solo_ceremony_60min_afternoon_4_piece_performance_130pm",
"solo_ceremony_60min_afternoon_4_piece_performance_230pm",
"solo_ceremony_60min_afternoon_4_piece_performance_3pm",
"solo_ceremony_60min_afternoon_4_piece_performance_330pm",
"solo_ceremony_90min_afternoon_4_piece_performance_12pm",
"solo_ceremony_90min_afternoon_4_piece_performance_1230pm",
"solo_ceremony_90min_afternoon_4_piece_performance_1pm",
"solo_ceremony_90min_afternoon_4_piece_performance_130pm",
"solo_ceremony_90min_afternoon_4_piece_performance_2pm",
"solo_ceremony_90min_afternoon_4_piece_performance_230pm",
"solo_ceremony_90min_afternoon_4_piece_performance_3pm",
"solo_ceremony_90min_afternoon_4_piece_performance_330pm",
"duo_ceremony_60min_afternoon_trio_performance_12pm",
"duo_ceremony_60min_afternoon_trio_performance_1230pm",
"duo_ceremony_60min_afternoon_trio_performance_1pm",
"duo_ceremony_60min_afternoon_trio_performance_130pm",
"duo_ceremony_60min_afternoon_trio_performance_2pm",
"duo_ceremony_60min_afternoon_trio_performance_230pm",
"duo_ceremony_60min_afternoon_trio_performance_3pm",
"duo_ceremony_60min_afternoon_trio_performance_330pm",
"duo_ceremony_90min_afternoon_trio_performance_12pm",
"duo_ceremony_90min_afternoon_trio_performance_1230pm",
"duo_ceremony_90min_afternoon_trio_performance_1pm",
"duo_ceremony_90min_afternoon_trio_performance_130pm",
"duo_ceremony_90min_afternoon_trio_performance_2pm",
"duo_ceremony_90min_afternoon_trio_performance_230pm",
"duo_ceremony_90min_afternoon_trio_performance_3pm",
"duo_ceremony_90min_afternoon_trio_performance_330pm",
"solo_ceremony_60min_afternoon_4_piece_performance_2pm",
"duo_ceremony_60min_afternoon_4_piece_performance_12pm",
"duo_ceremony_60min_afternoon_4_piece_performance_1230pm",
"duo_ceremony_60min_afternoon_4_piece_performance_1pm",
"duo_ceremony_60min_afternoon_4_piece_performance_130pm",
"duo_ceremony_60min_afternoon_4_piece_performance_2pm",
"duo_ceremony_60min_afternoon_4_piece_performance_230pm",
"duo_ceremony_60min_afternoon_4_piece_performance_3pm",
"duo_ceremony_60min_afternoon_4_piece_performance_330pm",
"duo_ceremony_90min_afternoon_4_piece_performance_12pm",
"duo_ceremony_90min_afternoon_4_piece_performance_1230pm",
"duo_ceremony_90min_afternoon_4_piece_performance_1pm",
"duo_ceremony_90min_afternoon_4_piece_performance_130pm",
"duo_ceremony_90min_afternoon_4_piece_performance_2pm",
"duo_ceremony_90min_afternoon_4_piece_performance_230pm",
"duo_ceremony_90min_afternoon_4_piece_performance_3pm",
"duo_ceremony_90min_afternoon_4_piece_performance_330pm",
    ],
    djServices: [
"up_to_3_hours_manned_playlist",
"background_music_playlist",
"up_to_3_hours_band_member_DJ",
"DJ_live_sax_3x30mins",
"DJ_live_bongos_3x30mins",
"DJ_live_bongos_and_sax_3x30mins",
    ],
    extraMainPerformanceSets: [
"extra_30min_performance_4_piece",
"extra_30min_performance_5_piece",
"extra_30min_performance_6_piece",
"extra_40min_performance_4_piece",
"extra_40min_performance_5_piece",
"extra_40min_performance_6_piece",
"extra_60min_performance_4_piece",
"extra_60min_performance_5_piece",
"extra_60min_performance_6_piece",
    ],
    lateStay: [
"late_stay_30min_4_piece",
"late_stay_60min_4_piece",
"late_stay_30min_5_piece",
"late_stay_60min_5_piece",
"late_stay_30min_6_piece",
"late_stay_60min_6_piece",
"playlist_only_late_stay_30min",
"playlist_only_late_stay_60min",
"manned_playlist_only_late_stay_30min",
"manned_playlist_only_late_stay_60min",
"band_member_DJ_only_late_stay_30min",
"band_member_DJ_only_late_stay_60min",
    ],
    earlyArrival: [
"early_arrival_30min_4_piece",
"early_arrival_60min_4_piece",
"early_arrival_90min_4_piece",
"early_arrival_120min_4_piece",
"early_arrival_150min_4_piece",
"early_arrival_180min_4_piece",
"early_arrival_210min_4_piece",
"early_arrival_240min_4_piece",
"early_arrival_30min_5_piece",
"early_arrival_60min_5_piece",
"early_arrival_90min_5_piece",
"early_arrival_120min_5_piece",
"early_arrival_150min_5_piece",
"early_arrival_180min_5_piece",
"early_arrival_210min_5_piece",
"early_arrival_240min_5_piece",
"early_arrival_30min_6_piece",
"early_arrival_60min_6_piece",
"early_arrival_90min_6_piece",
"early_arrival_120min_6_piece",
"early_arrival_150min_6_piece",
"early_arrival_180min_6_piece",
"early_arrival_210min_6_piece",
"early_arrival_240min_6_piece",
    ],
  };

  const findCategory = (extra) => {
    for (const category in exclusiveCategories) {
      if (exclusiveCategories[category].includes(extra)) {
        return category;
      }
    }
    return null;
  };


  return (
    <div className="  w-full">
      {/* 🔽 MAIN TOGGLE FOR ALL CEREMONY EXTRAS */}
      <p
        onClick={() => setShowCeremonyExtras(!showCeremonyExtras)}
        className="text-m font-semibold flex items-center text-left cursor-pointer gap-2"
      >
        Ceremony Sets
        <img
          className={`h-3 transition-transform duration-300 ${
            showCeremonyExtras ? "rotate-90" : ""
          }`}
          src={assets.dropdown_icon}
          alt=""
        />
      </p>

     {/* ✅ Content Only Shows When Expanded */}
{showCeremonyExtras && (
  <div className="mt-1">
    {[
      ceremony_solo,
      duo_ceremony,
      trio_ceremony,
      four_piece_ceremony,
    ].map(
      (category, index) =>
        category && (
          <div key={index}>
            <p
              onClick={() => {
                if (index === 0) setShowSoloExtras(!showSoloExtras);
                if (index === 1) setShowDuoExtras(!showDuoExtras);
                if (index === 2) setShowTrioExtras(!showTrioExtras);
                if (index === 3) setShowFourPieceExtras(!showFourPieceExtras);
              }}
              className="mt-2 ml-3 text-sm font-medium flex items-center cursor-pointer gap-2"
            >
              {["Solo", "Duo", "Trio", "4-Piece"][index]}
              <img
                className={`h-3 transition-transform duration-300 ${
                  (index === 0 && showSoloExtras) ||
                  (index === 1 && showDuoExtras) ||
                  (index === 2 && showTrioExtras) ||
                  (index === 3 && showFourPieceExtras)
                    ? "rotate-90"
                    : ""
                }`}
                src={assets.dropdown_icon}
                alt=""
              />
            </p>

            {(index === 0 && showSoloExtras) ||
            (index === 1 && showDuoExtras) ||
            (index === 2 && showTrioExtras) ||
            (index === 3 && showFourPieceExtras) ? (
              <div className="flex flex-col text-sm font-light w-11/12 text-gray-700 mt-1 ml-6">
                {Object.entries(category).map(([key, price]) => (
                  <div
                    key={key}
                    className="flex justify-between items-center w-full"
                  >
                    {/* Left: checkbox Button & Label */}
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        id={key}
                        name="ceremonyPerformance"
                        className="w-3 cursor-pointer"
                        value={key}
                        onChange={(e) => {
                          const checked = e.target.checked;
                          const categoryName = findCategory(key); // ✅ use key here

                          setSelectedExtras((prev) => {
                            let updatedExtras = [...prev];

                            if (checked) {
                              if (categoryName) {
                                // ✅ Remove other selections from the same category
                                updatedExtras = updatedExtras.filter(
                                  (item) =>
                                    !exclusiveCategories[categoryName].includes(
                                      item
                                    )
                                );
                              }
                              updatedExtras.push(key);
                            } else {
                              updatedExtras = updatedExtras.filter(
                                (item) => item !== key
                              );
                            }

                            return updatedExtras;
                          });
                        }}
                        checked={selectedExtras.includes(key)}
                      />
                      <label htmlFor={key} className="cursor-pointer">
                        {formatCeremonyLabel(key)}
                      </label>
                    </div>

                    {/* Right: Price */}
                    <span className="text-gray-600 text-xs font-medium">
                      {currency}
                      {Math.ceil(price / 0.8)}
                    </span>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        )
    )}
  </div>
)}

     {/* 🔽 MAIN TOGGLE FOR ALL AFTERNOON EXTRAS */}
<p
  onClick={() => setShowAfternoonExtras(!showAfternoonExtras)}
  className="text-m font-semibold flex items-center text-left cursor-pointer gap-2"
>
  Afternoon Reception Sets
  <img
    className={`h-3 transition-transform duration-300 ${
      showAfternoonExtras ? "rotate-90" : ""
    }`}
    src={assets.dropdown_icon}
    alt=""
  />
</p>

{/* ✅ Content Only Shows When Expanded */}
{showAfternoonExtras && (
  <div className="mt-3">
    {[
      afternoon_solo,
      afternoon_duo,
      afternoon_trio,
      afternoon_4piece,
    ].map(
      (category, index) =>
        category && (
          <div key={index}>
            <p
              onClick={() => {
                if (index === 0)
                  setShowAfternoonSoloExtras(!showAfternoonSoloExtras);
                if (index === 1)
                  setShowAfternoonDuoExtras(!showAfternoonDuoExtras);
                if (index === 2)
                  setShowAfternoonTrioExtras(!showAfternoonTrioExtras);
                if (index === 3)
                  setShowAfternoonFourPieceExtras(
                    !showAfternoonFourPieceExtras
                  );
              }}
              className="mt-2 text-sm font-medium flex items-center cursor-pointer gap-2 ml-3"
            >
              {["Solo", "Duo", "Trio", "4-Piece"][index]}
              <img
                className={`h-3 transition-transform duration-300 ${
                  (index === 0 && showAfternoonSoloExtras) ||
                  (index === 1 && showAfternoonDuoExtras) ||
                  (index === 2 && showAfternoonTrioExtras) ||
                  (index === 3 && showAfternoonFourPieceExtras)
                    ? "rotate-90"
                    : ""
                }`}
                src={assets.dropdown_icon}
                alt=""
              />
            </p>

            {/* ✅ Dropdown for 2x30mins or 1x60mins */}
            {(index === 0 && showAfternoonSoloExtras) ||
            (index === 1 && showAfternoonDuoExtras) ||
            (index === 2 && showAfternoonTrioExtras) ||
            (index === 3 && showAfternoonFourPieceExtras) ? (
              <div>
                <p
                  onClick={() =>
                    setShowAfternoon60min(!showAfternoon60min)
                  }
                  className="text-sm font-medium flex items-center cursor-pointer gap-2 mt-2 ml-6"
                >
                  2x30mins or 1x60mins
                  <img
                    className={`h-3 transition-transform duration-300 ${
                      showAfternoon60min ? "rotate-90" : ""
                    }`}
                    src={assets.dropdown_icon}
                    alt=""
                  />
                </p>

                {showAfternoon60min && (
                  <div className="flex flex-col text-sm font-light w-11/12 text-gray-700 mt-1 ml-9">
                    {Object.entries(category)
                      .filter(([key]) => key.includes("60min"))
                      .map(([key, price]) => (
                        <div
                          key={key}
                          className="flex justify-between items-center w-full"
                        >
                          {/* Left: checkbox Button & Label */}
                          <div className="flex items-center gap-2">
                            <input
                              type="checkbox"
                              id={key}
                              name="afternoonPerformance"
                              className="w-3 cursor-pointer"
                              value={key}
                              onChange={(e) => {
                                const checked = e.target.checked;
                                const categoryName = findCategory(key);

                                setSelectedExtras((prev) => {
                                  let updatedExtras = [...prev];

                                  if (checked) {
                                    if (categoryName) {
                                      updatedExtras = updatedExtras.filter(
                                        (item) =>
                                          !exclusiveCategories[
                                            categoryName
                                          ].includes(item)
                                      );
                                    }
                                    updatedExtras.push(key);
                                  } else {
                                    updatedExtras = updatedExtras.filter(
                                      (item) => item !== key
                                    );
                                  }

                                  return updatedExtras;
                                });
                              }}
                              checked={selectedExtras.includes(key)}
                            />
                            <label htmlFor={key} className="cursor-pointer">
                              {formatAfternoonLabel(key)}
                            </label>
                          </div>

                          {/* Right: Price */}
                          <span className="text-gray-600 text-xs font-medium mr-3">
                            {currency}
                            {Math.ceil(price / 0.8)}
                          </span>
                        </div>
                      ))}
                  </div>
                )}
              </div>
            ) : null}

            {/* ✅ Dropdown for 3x30mins or 2x45mins */}
            {(index === 0 && showAfternoonSoloExtras) ||
            (index === 1 && showAfternoonDuoExtras) ||
            (index === 2 && showAfternoonTrioExtras) ||
            (index === 3 && showAfternoonFourPieceExtras) ? (
              <div>
                <p
                  onClick={() =>
                    setShowAfternoon90min(!showAfternoon90min)
                  }
                  className="text-sm font-medium flex items-center cursor-pointer gap-2 mt-2 ml-6"
                >
                  3x30mins or 2x45mins
                  <img
                    className={`h-3 transition-transform duration-300 ${
                      showAfternoon90min ? "rotate-90" : ""
                    }`}
                    src={assets.dropdown_icon}
                    alt=""
                  />
                </p>

                {showAfternoon90min && (
                  <div className="flex flex-col text-sm font-light w-11/12 text-gray-700 mt-1 ml-9">
                    {Object.entries(category)
                      .filter(([key]) => key.includes("90min"))
                      .map(([key, price]) => (
                        <div
                          key={key}
                          className="flex justify-between items-center w-full"
                        >
                          {/* Left: checkbox Button & Label */}
                          <div className="flex items-center gap-2">
                            <input
                              type="checkbox"
                              id={key}
                              name="afternoonPerformance"
                              className="w-3 cursor-pointer"
                              value={key}
                              onChange={(e) => {
                                const checked = e.target.checked;
                                const categoryName = findCategory(key);

                                setSelectedExtras((prev) => {
                                  let updatedExtras = [...prev];

                                  if (checked) {
                                    if (categoryName) {
                                      updatedExtras = updatedExtras.filter(
                                        (item) =>
                                          !exclusiveCategories[
                                            categoryName
                                          ].includes(item)
                                      );
                                    }
                                    updatedExtras.push(key);
                                  } else {
                                    updatedExtras = updatedExtras.filter(
                                      (item) => item !== key
                                    );
                                  }

                                  return updatedExtras;
                                });
                              }}
                              checked={selectedExtras.includes(key)}
                            />
                            <label htmlFor={key} className="cursor-pointer">
                              {formatAfternoonLabel(key)}
                            </label>
                          </div>

                          {/* Right: Price */}
                          <span className="text-gray-600 text-xs font-medium mr-3">
                            {currency}
                            {Math.ceil(price / 0.8)}
                          </span>
                        </div>
                      ))}
                  </div>
                )}
              </div>
            ) : null}
          </div>
        )
    )}
  </div>
)}
{/* 🔽 MAIN TOGGLE FOR ALL CEREMONY & AFTERNOON COMBO EXTRAS */}
<p
  onClick={() => setShowAfternoonComboExtras(!showAfternoonComboExtras)}
  className="text-m font-semibold flex items-center text-left cursor-pointer gap-2"
>
  Ceremony & Afternoon Combo Sets
  <img
    className={`h-3 transition-transform duration-300 ${
      showAfternoonComboExtras ? "rotate-90" : ""
    }`}
    src={assets.dropdown_icon}
    alt=""
  />
</p>

{/* ✅ Content Only Shows When Expanded */}
{showAfternoonComboExtras && (
  <div className="mt-2 flex flex-col text-sm font-light w-full text-gray-700">
    {[
      solo_ceremony_and_afternoon_duo,
      solo_ceremony_and_afternoon_trio,
      solo_ceremony_and_afternoon_4piece,
      duo_ceremony_and_afternoon_trio,
      duo_cermeony_and_4piece,
    ].map(
      (category, index) =>
        category && (
          <div key={index} className="mt-1">
            {/* ✅ Subcategory Title */}
            <p
              onClick={() => {
                if (index === 0) setShowSoloCeremonyAfternoonDuoExtras(!showSoloCeremonyAfternoonDuoExtras);
                if (index === 1) setShowSoloCeremonyAfternoonTrioExtras(!showSoloCeremonyAfternoonTrioExtras);
                if (index === 2) setShowSoloCeremonyAfternoonFourPieceExtras(!showSoloCeremonyAfternoonFourPieceExtras);
                if (index === 3) setShowDuoCeremonyAfternoonTrioExtras(!showDuoCeremonyAfternoonTrioExtras);
                if (index === 4) setShowDuoCeremonyAfternoonFourPieceExtras(!showDuoCeremonyAfternoonFourPieceExtras);
              }}
              className="text-sm font-medium flex items-center cursor-pointer gap-2 mt-1 ml-3"
            >
              {
                [
                  "Ceremony Solo & Afternoon Duo",
                  "Ceremony Solo & Afternoon Trio",
                  "Ceremony Solo & Afternoon 4-Piece",
                  "Ceremony Duo & Afternoon Trio",
                  "Ceremony Duo & Afternoon 4-Piece",
                ][index]
              }
              <img
                className={`h-3 transition-transform duration-300 ${
                  (index === 0 && showSoloCeremonyAfternoonDuoExtras) ||
                  (index === 1 && showSoloCeremonyAfternoonTrioExtras) ||
                  (index === 2 && showSoloCeremonyAfternoonFourPieceExtras) ||
                  (index === 3 && showDuoCeremonyAfternoonTrioExtras) ||
                  (index === 4 && showDuoCeremonyAfternoonFourPieceExtras)
                    ? "rotate-90"
                    : ""
                }`}
                src={assets.dropdown_icon}
                alt=""
              />
            </p>

            {/* ✅ Dropdown for 2x30 or 1x60mins */}
            {(index === 0 && showSoloCeremonyAfternoonDuoExtras) ||
            (index === 1 && showSoloCeremonyAfternoonTrioExtras) ||
            (index === 2 && showSoloCeremonyAfternoonFourPieceExtras) ||
            (index === 3 && showDuoCeremonyAfternoonTrioExtras) ||
            (index === 4 && showDuoCeremonyAfternoonFourPieceExtras) ? (
              <div className="mt-1">
                <p
                  onClick={() => setShowAfternoonCombo60min(!showAfternoonCombo60min)}
                  className="text-sm font-medium flex items-center cursor-pointer gap-2 mt-2 ml-6"
                >
                  2x30 or 1x60mins Afternoon Sets
                  <img
                    className={`h-3 transition-transform duration-300 ${
                      showAfternoonCombo60min ? "rotate-90" : ""
                    }`}
                    src={assets.dropdown_icon}
                    alt=""
                  />
                </p>

                {showAfternoonCombo60min && (
                  <div className="flex flex-col text-sm font-light w-full text-gray-700 mt-1 ml-9">
                    {Object.entries(category)
                      .filter(([key]) => key.includes("60min"))
                      .map(([key, price]) => (
                        <div key={key} className="flex justify-between items-center w-full">
                          <div className="flex items-center gap-2 w-full text-left">
                            <input
                              type="checkbox"
                              id={key}
                              name="afternoonComboPerformance"
                              className="w-3 cursor-pointer"
                              value={key}
                              onChange={(e) => {
                                const checked = e.target.checked;
                                const categoryName = findCategory(key);

                                setSelectedExtras((prev) => {
                                  let updatedExtras = [...prev];

                                  if (checked) {
                                    if (categoryName) {
                                      updatedExtras = updatedExtras.filter(
                                        (item) =>
                                          !exclusiveCategories[
                                            categoryName
                                          ].includes(item)
                                      );
                                    }
                                    updatedExtras.push(key);
                                  } else {
                                    updatedExtras = updatedExtras.filter(
                                      (item) => item !== key
                                    );
                                  }

                                  return updatedExtras;
                                });
                              }}
                              checked={selectedExtras.includes(key)}
                            />
                            <label htmlFor={key} className="cursor-pointer w-full">
                              {formatAfternoonComboLabel(key)}
                            </label>
                          </div>

                          <span className="text-gray-600 text-xs font-medium text-right mr-12">
                            {currency}
                            {Math.ceil(price / 0.8)}
                          </span>
                        </div>
                      ))}
                  </div>
                )}
              </div>
            ) : null}

            {/* ✅ Dropdown for 3x30 or 2x45mins */}
            {(index === 0 && showSoloCeremonyAfternoonDuoExtras) ||
            (index === 1 && showSoloCeremonyAfternoonTrioExtras) ||
            (index === 2 && showSoloCeremonyAfternoonFourPieceExtras) ||
            (index === 3 && showDuoCeremonyAfternoonTrioExtras) ||
            (index === 4 && showDuoCeremonyAfternoonFourPieceExtras) ? (
              <div className="mt-1">
                <p
                  onClick={() => setShowAfternoonCombo90min(!showAfternoonCombo90min)}
                  className="text-sm font-medium flex items-center cursor-pointer gap-2 mt-1 ml-6"
                >
                  3x30 or 2x45mins Afternoon Sets
                  <img
                    className={`h-3 transition-transform duration-300 ${
                      showAfternoonCombo90min ? "rotate-90" : ""
                    }`}
                    src={assets.dropdown_icon}
                    alt=""
                  />
                </p>

                {showAfternoonCombo90min && (
                  <div className="flex flex-col text-sm font-light w-full text-gray-700 mt-1 ml-9">
                    {Object.entries(category)
                      .filter(([key]) => key.includes("90min"))
                      .map(([key, price]) => (
                        <div key={key} className="flex justify-between items-center w-full">
                          <div className="flex items-center gap-2 w-full text-left">
                            <input
                              type="checkbox"
                              id={key}
                              name="afternoonComboPerformance"
                              className="w-3 cursor-pointer"
                              value={key}
                              onChange={(e) => {
                                const checked = e.target.checked;
                                const categoryName = findCategory(key);

                                setSelectedExtras((prev) => {
                                  let updatedExtras = [...prev];

                                  if (checked) {
                                    if (categoryName) {
                                      updatedExtras = updatedExtras.filter(
                                        (item) =>
                                          !exclusiveCategories[
                                            categoryName
                                          ].includes(item)
                                      );
                                    }
                                    updatedExtras.push(key);
                                  } else {
                                    updatedExtras = updatedExtras.filter(
                                      (item) => item !== key
                                    );
                                  }

                                  return updatedExtras;
                                });
                              }}
                              checked={selectedExtras.includes(key)}
                            />
                            <label htmlFor={key} className="cursor-pointer w-full">
                              {formatAfternoonComboLabel(key)}
                            </label>
                          </div>

                          <span className="text-gray-600 text-xs font-medium text-right mr-12">
                            {currency}
                            {Math.ceil(price / 0.8)}
                          </span>
                        </div>
                      ))}
                  </div>
                )}
              </div>
            ) : null}
          </div>
        )
    )}
  </div>
)}
{/* 🔽 MAIN TOGGLE FOR ALL DJ SERVICES EXTRAS */}
<p
  onClick={() => setShowDjExtras(!showDjExtras)}
  className="text-m font-semibold flex items-center text-left cursor-pointer gap-2"
>
  DJ Services
  <img
    className={`h-3 transition-transform duration-300 ${
      showDjExtras ? "rotate-90" : ""
    }`}
    src={assets.dropdown_icon}
    alt=""
  />
</p>

{/* ✅ Content Only Shows When Expanded */}
{showDjExtras && (
  <div className="flex flex-col text-sm font-light w-full text-gray-700 mt-1 ml-3">
    {Object.entries(djServices).map(([key, price]) => (
      <div key={key} className="flex justify-between items-center w-full">
        {/* Left: checkbox Button & Label */}
        <div className="flex items-center gap-2 w-full text-left">
          <input
            type="checkbox"
            id={key}
            name="djExtras"
            className="w-3 cursor-pointer"
            value={key}
            onChange={(e) => {
              const checked = e.target.checked;
              const categoryName = findCategory(key);

              setSelectedExtras((prev) => {
                let updatedExtras = [...prev];

                if (checked) {
                  if (categoryName) {
                    updatedExtras = updatedExtras.filter(
                      (item) =>
                        !exclusiveCategories[categoryName].includes(item)
                    );
                  }
                  updatedExtras.push(key);
                } else {
                  updatedExtras = updatedExtras.filter((item) => item !== key);
                }

                return updatedExtras;
              });
            }}
            checked={selectedExtras.includes(key)}
          />
          <label htmlFor={key} className="cursor-pointer w-full">
            <div className="flex flex-col">
              <span>{formatLabel(key).mainText}</span>
              {formatLabel(key).extraText && (
                <span className="text-xs text-gray-500 leading-tight">
                  {formatLabel(key).extraText}
                </span>
              )}
            </div>
          </label>
        </div>

        {/* Right: Price */}
        <span className="text-gray-600 text-xs font-medium text-right mr-6">
          {currency}
          {Math.ceil(price / 0.8)}
        </span>
      </div>
    ))}
  </div>
)}
    {/* 🔽 MAIN TOGGLE FOR ALL EXTRA SETS */}
<p
  onClick={() => setShowExtraSets(!showExtraSets)}
  className="text-m font-semibold flex items-center text-left cursor-pointer gap-2"
>
  Extra Main Performance Sets
  <img
    className={`h-3 transition-transform duration-300 ${
      showExtraSets ? "rotate-90" : ""
    }`}
    src={assets.dropdown_icon}
    alt=""
  />
</p>

{/* ✅ Content Only Shows When Expanded */}
{showExtraSets && (
  <div className="flex flex-col text-sm font-light w-full text-gray-700 mt-1 ml-3">
    {Object.entries(filteredExtraSets).map(([key, price]) => (
      <div key={key} className="flex justify-between items-center w-full">
        {/* Left: checkbox Button & Label (Always Left-Aligned) */}
        <div className="flex items-center gap-2 w-full text-left">
          <input
            type="checkbox"
            id={key}
            name="extra_sets"
            className="w-3 cursor-pointer"
            value={key}
            onChange={(e) => {
              const checked = e.target.checked;
              const category = findCategory(key); // Get the category for this extra

              setSelectedExtras((prev) => {
                let updatedExtras = [...prev];

                if (checked) {
                  if (category) {
                    // Remove other selections from the same category
                    updatedExtras = updatedExtras.filter(
                      (item) => !exclusiveCategories[category].includes(item)
                    );
                  }
                  updatedExtras.push(key);
                } else {
                  updatedExtras = updatedExtras.filter((item) => item !== key);
                }

                return updatedExtras;
              });
            }}
            checked={selectedExtras.includes(key)}
          />
          <label htmlFor={key} className="cursor-pointer w-full">
            {formatExtraSetsLabel(key)}
          </label>
        </div>

        {/* Right: Price (Always Right-Aligned) */}
        <span className="text-gray-600 text-xs font-medium text-right mr-6">
          {currency}
          {Math.ceil(price / 0.8)}
        </span>
      </div>
    ))}
  </div>
)}

   {/* 🔽 MAIN TOGGLE FOR LATE STAY EXTRAS */}
<p
  onClick={() => setShowLateStayExtras(!showLateStayExtras)}
  className="text-m font-semibold flex items-center text-left cursor-pointer gap-2"
>
  <span className="whitespace-nowrap">Late Stay<span className="text-gray-800 font-normal text-sm"> (from midnight)</span></span>
  <img
    className={`h-3 transition-transform duration-300 ${
      showLateStayExtras ? "rotate-90" : ""
    }`}
    src={assets.dropdown_icon}
    alt=""
  />
</p>

{/* ✅ Content Only Shows When Expanded */}
{showLateStayExtras &&
filteredLateStayExtras &&
Object.entries(filteredLateStayExtras).length > 0 ? (
  <div className="flex flex-col text-sm font-light w-full text-gray-700 mt-1 ml-3">
    {Object.entries(filteredLateStayExtras).map(([key, price]) => (
      <div key={key} className="flex justify-between items-center w-full">
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id={key}
            name="late_stay"
            className="w-3 cursor-pointer"
            value={key}
            onChange={(e) => {
              const checked = e.target.checked;
              const category = findCategory(key); // Get the category

              setSelectedExtras((prev) => {
                let updatedExtras = [...prev];

                if (checked) {
                  if (category) {
                    // Remove other selections from the same category
                    updatedExtras = updatedExtras.filter(
                      (item) => !exclusiveCategories[category].includes(item)
                    );
                  }
                  updatedExtras.push(key);
                } else {
                  updatedExtras = updatedExtras.filter((item) => item !== key);
                }

                return updatedExtras;
              });
            }}
            checked={selectedExtras.includes(key)}
          />
          <label htmlFor={key} className="cursor-pointer">
            {formatLateStayLabel(key)}
          </label>
        </div>
        <span className="text-gray-600 text-xs font-medium text-right mr-6">
          {currency}
          {Math.ceil(price / 0.8)}
        </span>
      </div>
    ))}
  </div>
) : null}

     {/* 🔽 MAIN TOGGLE FOR EARLY ARRIVAL */}
<p
  onClick={() => setShowEarlyArrivalExtras(!showEarlyArrivalExtras)}
  className="text-m font-semibold flex items-center text-left cursor-pointer gap-2"
>
  Early Arrival
  <img
    className={`h-3 transition-transform duration-300 ${
      showEarlyArrivalExtras ? "rotate-90" : ""
    }`}
    src={assets.dropdown_icon}
    alt=""
  />
</p>

{/* ✅ Content Only Shows When Expanded */}
{showEarlyArrivalExtras &&
filteredEarlyArrivalExtras &&
Object.entries(filteredEarlyArrivalExtras).length > 0 ? (
  <div className="flex flex-col text-sm font-light w-full text-gray-700 mt-1 ml-3">
    {Object.entries(filteredEarlyArrivalExtras).map(([key, price]) => (
      <div key={key} className="flex justify-between items-center w-full">
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id={key}
            name="early_arrival"
            className="w-3 cursor-pointer"
            value={key}
            onChange={(e) => {
              const checked = e.target.checked;
              const category = findCategory(key); // Find the category for exclusivity

              setSelectedExtras((prev) => {
                let updatedExtras = [...prev];

                if (checked) {
                  if (category) {
                    // Remove others from the same category
                    updatedExtras = updatedExtras.filter(
                      (item) => !exclusiveCategories[category].includes(item)
                    );
                  }
                  updatedExtras.push(key);
                } else {
                  updatedExtras = updatedExtras.filter((item) => item !== key);
                }

                return updatedExtras;
              });
            }}
            checked={selectedExtras.includes(key)}
          />
          <label htmlFor={key} className="cursor-pointer">
            {formatEarlyArrivalLabel(key)}
          </label>
        </div>
        <span className="text-gray-600 text-xs font-medium mr-6">
          {currency}
          {Math.ceil(price / 0.8)}
        </span>
      </div>
    ))}
  </div>
) : null}

      {/* 🔽 MAIN TOGGLE FOR OTHER EXTRAS */}
      <p
        onClick={() => setShowOtherExtras(!showOtherExtras)}
        className="text-m font-semibold flex items-center text-left cursor-pointer gap-2"
      >
        Other Extras
        <img
          className={`h-3 transition-transform duration-300 ${
            showOtherExtras ? "rotate-90" : ""
          }`}
          src={assets.dropdown_icon}
          alt=""
        />
      </p>

      {/* ✅ Content Only Shows When Expanded */}
      {showOtherExtras && (
        <div className="flex flex-col text-sm font-light w-full text-gray-700 mt-1">
          {/* Remove Drums Checkbox */}
          {soundLimiters?.remove_drums && (
            <div className="flex justify-between items-center w-full">
              <label className="cursor-pointer flex items-center gap-2 w-full text-left ml-3">
                <input
                  type="checkbox"
                  onChange={(e) => {
                    const checked = e.target.checked;
                    setSelectedExtras((prev) =>
                      checked ? [...prev, "remove_drums"] : prev.filter((item) => item !== "remove_drums")
                    );
                  }}                  checked={selectedExtras.includes("remove_drums")}
                />
                Remove Drums
              </label>
              <span className="whitespace-nowrap text-gray-600 text-xs font-medium mr-3">
              {removeDrumsFee < 0
  ? `- ${currency}${Math.abs(Math.ceil(removeDrumsFee / 0.8))}`
  : `${currency}${Math.ceil(removeDrumsFee / 0.8)}`}</span>
            </div>
          )}

          {/* Sound Engineering for Another Act */}
         {/* Sound Engineering for Another Act */}
{sound_engineering_for_another_act && (
  <div className="flex justify-between items-center w-full">
    <label
      htmlFor="sound_engineering_for_another_act"
      className="cursor-pointer flex items-center gap-2 w-full text-left ml-3"
    >
      <input
        type="checkbox"
        id="sound_engineering_for_another_act"
        onChange={(e) => {
            const checked = e.target.checked;
            setSelectedExtras((prev) =>
              checked ? [...prev, "sound_engineering_for_another_act"] : prev.filter((item) => item !== "sound_engineering_for_another_act")
            );
          }}
        checked={selectedExtras.includes(
          "sound_engineering_for_another_act"
        )}
      />
      Sound Engineering for Another Act
    </label>
    <span className="text-gray-600 text-xs font-medium text-right mr-3">
      {currency}
      {Math.ceil(sound_engineering_for_another_act / 0.8)}
    </span>
  </div>
)}

          {/* Add Another Vocalist */}
<div className="flex justify-between items-center w-full">
  <label className="cursor-pointer flex items-center gap-2 w-full text-left ml-3">
    <input
      type="checkbox"
      onChange={(e) => {
        const checked = e.target.checked;
        setSelectedExtras((prev) =>
          checked
            ? [...prev, "add_another_vocalist"]
            : prev.filter((item) => item !== "add_another_vocalist")
        );
      }}
      checked={selectedExtras.includes("add_another_vocalist")}
    />
    Add Another Vocalist
  </label>
  <span className="text-gray-600 text-xs font-medium text-right mr-3">
    {currency}
    {Math.ceil(addVocalistFee / 0.8)}
  </span>
</div>

          {/* Speedy Setup */}
          {setupAndSoundcheck?.speedy_setup && (
            <div className="flex justify-between items-center w-full">
              <label className="cursor-pointer flex items-center gap-2 w-full text-left ml-3">
                <input
                  type="checkbox"
                  onChange={(e) => {
                    const checked = e.target.checked;
                    setSelectedExtras((prev) =>
                      checked ? [...prev, "speedy_setup"] : prev.filter((item) => item !== "speedy_setup")
                    );
                  }}                  checked={selectedExtras.includes("speedy_setup")}
                />
                {formatOtherExtrasLabel("speedy_setup")}{" "}
              </label>
              <span className="text-gray-600 text-xs font-medium text-right mr-3">
                {currency}
                {Math.ceil(speedySetupFee / 0.8)}
              </span>
            </div>
          )}

          {/* Israeli Sets */}
          {israeli_sets &&
  Object.entries(israeli_sets).map(([key, price]) => (
    <div
      key={key}
      className="flex justify-between items-center w-full"
    >
      <label className="cursor-pointer flex items-center gap-2 w-full text-left ml-3">
        <input
          type="checkbox"
          onChange={(e) => {
            const checked = e.target.checked;
            setSelectedExtras((prev) =>
              checked ? [...prev, key] : prev.filter((item) => item !== key)
            );
          }}
          checked={selectedExtras.includes(key)}
        />
        {formatIsraeliDancingLabel()}{" "}
      </label>
      <span className="text-gray-600 text-xs font-medium text-right mr-3">
        {currency}
        {Math.ceil(price / 0.8)}
      </span>
    </div>
))}

          {/* Extra Song Requests */}
          {extra_song &&
            Object.entries(extra_song).map(([key, price]) => (
              <div
                key={key}
                className="flex justify-between items-center w-full"
              >
                <label className="cursor-pointer flex items-center gap-2 w-full text-left ml-3">
                  <input
                    type="checkbox"
                    onChange={(e) => {
                        const checked = e.target.checked;
                        setSelectedExtras((prev) =>
                          checked ? [...prev, key] : prev.filter((item) => item !== key)
                        );
                      }}  checked={selectedExtras.includes(key)}
                  />
                  {formatExtraSongLabel()}{" "}
                </label>
                <span className="text-gray-600 text-xs font-medium text-right mr-3">
                  {currency}
                  {Math.ceil(price / 0.8)}
                </span>
              </div>
            ))}
        </div>
      )}
    </div>
  );
};

export default ExtrasFilter;
