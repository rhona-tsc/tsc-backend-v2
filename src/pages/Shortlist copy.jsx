import React, { useContext, useEffect, useState, useRef } from "react";
import { ShopContext } from "../context/ShopContext";
import Title from "../components/Title";
import { useParams, useNavigate, Link } from "react-router-dom";
import "slick-carousel/slick/slick.css";
import "slick-carousel/slick/slick-theme.css";
import { assets } from "../assets/assets";
import { postcodes } from "../assets/assets";
import ExtrasFilter from "../components/ExtrasFilter";
import DynamicTimetable from "../components/DynamicTimetable";

const Shortlist = () => {
  const {
    acts,
    state,
    currency,
    shortlistItems,
    updateShortlistQuantity,
    updateQuantity,
    selectedDate,
    selectedAddress,
    setShowSearch,
  } = useContext(ShopContext);
  const { actId } = useParams();
  const [actData, setActData] = useState(null);
  const [selectedLineup, setSelectedLineup] = useState("");
  const [video, setVideo] = useState("");
  const [selectedCounty, setSelectedCounty] = useState(
    sessionStorage.getItem("selectedCounty") || ""
  );
  const [adjustedTotal, setAdjustedTotal] = useState(null);
  const [shortlistData, setShortlistData] = useState([]);
  const storedPlace = sessionStorage.getItem("selectedPlace") || "";
  const navigate = useNavigate();
  const [sortType, setSortType] = useState("relavent");
  const [filterProducts, setFilterProducts] = useState([]);
  const [selectedExtras, setSelectedExtras] = useState([]);
  const [extrasPrices, setExtrasPrices] = useState({});
const [tscVideos, setTscVideos] = useState([]);
const [selectedVideoMap, setSelectedVideoMap] = useState({});
const [videoManuallySelectedMap, setVideoManuallySelectedMap] = useState({});

// Set selectedVideo after tscVideos is loaded
useEffect(() => {
  const initialVideoMap = {};
  const initialManualMap = {};

  shortlistData.forEach((item) => {
    const act = acts.find((a) => a._id === item._id);
    if (act?.tscVideos?.[0]?.url) {
      initialVideoMap[item._id] = act.tscVideos[0].url;
      initialManualMap[item._id] = false;
    }
  });

  setSelectedVideoMap(initialVideoMap);
  setVideoManuallySelectedMap(initialManualMap);
}, [acts, shortlistData]);


// ✅ Trigger sorting whenever sortType changes
  useEffect(() => {
    sortProducts();
  }, [sortType]); // Runs when sortType OR filterProducts changes

  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);
  useEffect(() => {
    if (actData && selectedLineup) {
      console.log("✅ Running calculatePrice AFTER state update...");
      const newPrice = calculatePrice(
        actData,
        selectedCounty,
        item.selectedLineup,
        selectedExtras[item._id] || [],
        extrasPrices[item._id] || {}
      );
      setAdjustedTotal(newPrice);
    }
  }, [selectedExtras, selectedLineup, selectedCounty]); // Make sure all dependencies are tracked

    useEffect(() => {
    console.log(
      "🛒 Syncing shortlistData with shortlistItems:",
      shortlistItems
    );
    const tempData = Object.keys(shortlistItems).map((actId) => ({
      _id: actId,
      selectedLineup: Object.keys(shortlistItems[actId])[0],
      quantity: shortlistItems[actId][Object.keys(shortlistItems[actId])[0]],
    }));
    setShortlistData(tempData);
  }, [shortlistItems]);

   useEffect(() => {
    console.log("🛠 Recalculating Price due to Extras Change...");

    if (actData && selectedLineup) {
      setTimeout(() => {
        console.log("✅ Running calculatePrice AFTER state update...");
        const newPrice = calculatePrice(
          actData,
          selectedCounty,
          selectedLineup,
          selectedExtras,
          extrasPrices
        );
        console.log("💰 Updated Adjusted Total with Extras:", newPrice);
        setAdjustedTotal(newPrice);
      }, 0); // Ensures state updates before calling function
    }
  }, [selectedExtras, selectedLineup, selectedCounty]);


const handleThumbnailClick = (videoUrl) => {
  setSelectedVideo(videoUrl);
  setVideoManuallySelected(true); // Autoplay now
};


const extractYouTubeId = (url) => {
  try {
    const idMatch = url.match(/(?:youtu\.be\/|v=)([^&]+)/);
    return idMatch ? idMatch[1] : null;
  } catch {
    return null;
  }
};


  const thumbnailRef = useRef();

  const availableCounties =
    postcodes?.length > 0 ? Object.keys(postcodes[0]) : [];

  const handleExtrasPricesUpdate = (actId, prices) => {
    setExtrasPrices((prev) => ({ ...prev, [actId]: prices }));
  };
  const handleExtrasChange = (actId, extras) => {
    setSelectedExtras((prev) => ({ ...prev, [actId]: extras }));
  };

  const dynamicExtraCategories = [
    "ceremony_solo",
    "duo_ceremony",
    "trio_ceremony",
    "four_piece_ceremony",
    "afternoon_solo",
    "afternoon_duo",
    "afternoon_trio",
    "afternoon_4piece",
    "solo_ceremony_and_afternoon_duo",
    "solo_ceremony_and_afternoon_trio",
    "solo_ceremony_and_afternoon_4piece",
    "duo_ceremony_and_afternoon_trio",
    "duo_cermeony_and_4piece",
    "late_stay",
    "early_arrival",
    "extra_sets",
    "israeli_sets",
    "extra_song",
    "djServices",
  ];

  const labelMap = {
    solo_ceremony_performance_12pm: "Ceremony Solo starting from 12pm",
    solo_ceremony_performance_1230pm: "Ceremony Solo starting from 12.30pm",
    solo_ceremony_performance_1pm: "Ceremony Solo starting from 1pm",
    solo_ceremony_performance_130pm: "Ceremony Solo starting from 1.30pm",
    duo_ceremony_performance_12pm: "Ceremony Duo starting from 12pm",
    duo_ceremony_performance_1230pm: "Ceremony Duo starting from 12.30pm",
    duo_ceremony_performance_1pm: "Ceremony Duo starting from 1pm",
    duo_ceremony_performance_130pm: "Ceremony Duo starting from 1.30pm",
    trio_ceremony_performance_12pm: "Ceremony Trio starting from 12pm",
    trio_ceremony_performance_1230pm: "Ceremony Trio starting from 12.30pm",
    trio_ceremony_performance_1pm: "Ceremony Trio starting from 1pm",
    trio_ceremony_performance_130pm: "Ceremony Trio starting from 1.30pm",
    four_piece_ceremony_performance_12pm: "Ceremony 4-Piece starting from 12pm",
    four_piece_ceremony_performance_1230pm:
      "Ceremony 4-Piece starting from 12.30pm",
    four_piece_ceremony_performance_1pm: "Ceremony 4-Piece starting from 1pm",
    four_piece_ceremony_performance_130pm:
      "Ceremony 4-Piece starting from 1.30pm",

    solo_60min_afternoon_performance_1pm:
      "2x30 or 1x60mins Afternoon Solo set starting from 1pm",
    solo_60min_afternoon_performance_130pm:
      "2x30 or 1x60mins Afternoon Solo set starting from 1.30pm",
    solo_60min_afternoon_performance_2pm:
      "2x30 or 1x60mins Afternoon Solo set starting from 2pm",
    solo_60min_afternoon_performance_230pm:
      "2x30 or 1x60mins Afternoon Solo set starting from 2.30pm",
    solo_60min_afternoon_performance_3pm:
      "2x30 or 1x60mins Afternoon Solo set starting from 3pm",
    solo_60min_afternoon_performance_330pm:
      "2x30 or 1x60mins Afternoon Solo set starting from 3.30pm",
    solo_60min_afternoon_performance_4pm:
      "2x30 or 1x60mins Afternoon Solo set starting from 4pm",

    solo_90min_afternoon_performance_1pm:
      "3x30 or 2x45mins Afternoon Solo set starting from 1pm",
    solo_90min_afternoon_performance_130pm:
      "3x30 or 2x45mins Afternoon Solo set starting from 1.30pm",
    solo_90min_afternoon_performance_2pm:
      "3x30 or 2x45mins Afternoon Solo set starting from 2pm",
    solo_90min_afternoon_performance_230pm:
      "3x30 or 2x45mins Afternoon Solo set starting from 2.30pm",
    solo_90min_afternoon_performance_3pm:
      "3x30 or 2x45mins Afternoon Solo set starting from 3pm",
    solo_90min_afternoon_performance_330pm:
      "3x30 or 2x45mins Afternoon Solo set starting from 3.30pm",

    duo_60min_afternoon_performance_1pm:
      "2x30 or 1x60mins Afternoon Duo set starting from 1pm",
    duo_60min_afternoon_performance_130pm:
      "2x30 or 1x60mins Afternoon Duo set starting from 1.30pm",
    duo_60min_afternoon_performance_2pm:
      "2x30 or 1x60mins Afternoon Duo set starting from 2pm",
    duo_60min_afternoon_performance_230pm:
      "2x30 or 1x60mins Afternoon Duo set starting from 2.30pm",
    duo_60min_afternoon_performance_3pm:
      "2x30 or 1x60mins Afternoon Duo set starting from 3pm",
    duo_60min_afternoon_performance_330pm:
      "2x30 or 1x60mins Afternoon Duo set starting from 3.30pm",
    duo_60min_afternoon_performance_4pm:
      "2x30 or 1x60mins Afternoon Duo set starting from 4pm",

    duo_90min_afternoon_performance_1pm:
      "3x30 or 2x45mins Afternoon Duo set starting from 1pm",
    duo_90min_afternoon_performance_130pm:
      "3x30 or 2x45mins Afternoon Duo set starting from 1.30pm",
    duo_90min_afternoon_performance_2pm:
      "3x30 or 2x45mins Afternoon Duo set starting from 2pm",
    duo_90min_afternoon_performance_230pm:
      "3x30 or 2x45mins Afternoon Duo set starting from 2.30pm",
    duo_90min_afternoon_performance_3pm:
      "3x30 or 2x45mins Afternoon Duo set starting from 3pm",
    duo_90min_afternoon_performance_330pm:
      "3x30 or 2x45mins Afternoon Duo set starting from 3.30pm",

    trio_60min_afternoon_performance_1pm:
      "2x30 or 1x60mins Afternoon Trio set starting from 1pm",
    trio_60min_afternoon_performance_130pm:
      "2x30 or 1x60mins Afternoon Trio set starting from 1.30pm",
    trio_60min_afternoon_performance_2pm:
      "2x30 or 1x60mins Afternoon Trio set starting from 2pm",
    trio_60min_afternoon_performance_230pm:
      "2x30 or 1x60mins Afternoon Trio set starting from 2.30pm",
    trio_60min_afternoon_performance_3pm:
      "2x30 or 1x60mins Afternoon Trio set starting from 3pm",
    trio_60min_afternoon_performance_330pm:
      "2x30 or 1x60mins Afternoon Trio set starting from 3.30pm",
    trio_60min_afternoon_performance_4pm:
      "2x30 or 1x60mins Afternoon Trio set starting from 4pm",

    four_60min_piece_afternoon_performance_1pm:
      "2x30 or 1x60mins Afternoon 4-Piece set starting from 1pm",
    four_60min_piece_afternoon_performance_130pm:
      "2x30 or 1x60mins Afternoon 4-Piece set starting from 1.30pm",
    four_60min_piece_afternoon_performance_2pm:
      "2x30 or 1x60mins Afternoon 4-Piece set starting from 2pm",
    four_60min_piece_afternoon_performance_230pm:
      "2x30 or 1x60mins Afternoon 4-Piece set starting from 2.30pm",
    four_60min_piece_afternoon_performance_3pm:
      "2x30 or 1x60mins Afternoon 4-Piece set starting from 3pm",
    four_60min_piece_afternoon_performance_330pm:
      "2x30 or 1x60mins Afternoon 4-Piece set starting from 3.30pm",
    four_60min_piece_afternoon_performance_4pm:
      "2x30 or 1x60mins Afternoon 4-Piece set starting from 4pm",

    solo_ceremony_60min_afternoon_duo_performance_12pm:
      "Ceremony Solo & 1x60 or 2x30mins Afternoon Duo starting from 12pm",
    solo_ceremony_60min_afternoon_duo_performance_1230pm:
      "Ceremony Solo & 1x60 or 2x30mins Afternoon Duo starting from 12.30pm",
    solo_ceremony_60min_afternoon_duo_performance_1pm:
      "Ceremony Solo & 1x60 or 2x30mins Afternoon Duo starting from 1pm",
    solo_ceremony_60min_afternoon_duo_performance_130pm:
      "Ceremony Solo & 1x60 or 2x30mins Afternoon Duo starting from 1.30pm",
    solo_ceremony_60min_afternoon_duo_performance_2pm:
      "Ceremony Solo & 1x60 or 2x30mins Afternoon Duo starting from 2pm",
    solo_ceremony_60min_afternoon_duo_performance_230pm:
      "Ceremony Solo & 1x60 or 2x30mins Afternoon Duo starting from 2.30pm",
    solo_ceremony_60min_afternoon_duo_performance_3pm:
      "Ceremony Solo & 1x60 or 2x30mins Afternoon Duo starting from 3pm",
    solo_ceremony_60min_afternoon_duo_performance_330pm:
      "Ceremony Solo & 1x60 or 2x30mins Afternoon Duo starting from 3.30pm",

    solo_ceremony_90min_afternoon_duo_performance_12pm:
      "Ceremony Solo & 3x30 or 2x45mins Afternoon Duo starting from 12pm",
    solo_ceremony_90min_afternoon_duo_performance_1230pm:
      "Ceremony Solo & 3x30 or 2x45mins Afternoon Duo starting from 12.30pm",
    solo_ceremony_90min_afternoon_duo_performance_1pm:
      "Ceremony Solo & 3x30 or 2x45mins Afternoon Duo starting from 1pm",
    solo_ceremony_90min_afternoon_duo_performance_130pm:
      "Ceremony Solo & 3x30 or 2x45mins Afternoon Duo starting from 1.30pm",
    solo_ceremony_90min_afternoon_duo_performance_2pm:
      "Ceremony Solo & 3x30 or 2x45mins Afternoon Duo starting from 2pm",
    solo_ceremony_90min_afternoon_duo_performance_230pm:
      "Ceremony Solo & 3x30 or 2x45mins Afternoon Duo starting from 2.30pm",
    solo_ceremony_90min_afternoon_duo_performance_3pm:
      "Ceremony Solo & 3x30 or 2x45mins Afternoon Duo starting from 3pm",
    solo_ceremony_90min_afternoon_duo_performance_330pm:
      "Ceremony Solo & 3x30 or 2x45mins Afternoon Duo starting from 3.30pm",

    solo_ceremony_60min_afternoon_trio_performance_12pm:
      "Ceremony Solo & 1x60 or 2x30mins Afternoon Trio starting from 12pm",
    solo_ceremony_60min_afternoon_trio_performance_1230pm:
      "Ceremony Solo & 1x60 or 2x30mins Afternoon Trio starting from 12.30pm",
    solo_ceremony_60min_afternoon_trio_performance_1pm:
      "Ceremony Solo & 1x60 or 2x30mins Afternoon Trio starting from 1pm",
    solo_ceremony_60min_afternoon_trio_performance_130pm:
      "Ceremony Solo & 1x60 or 2x30mins Afternoon Trio starting from 1.30pm",
    solo_ceremony_60min_afternoon_trio_performance_2pm:
      "Ceremony Solo & 1x60 or 2x30mins Afternoon Trio starting from 2pm",
    solo_ceremony_60min_afternoon_trio_performance_230pm:
      "Ceremony Solo & 1x60 or 2x30mins Afternoon Trio starting from 2.30pm",
    solo_ceremony_60min_afternoon_trio_performance_3pm:
      "Ceremony Solo & 1x60 or 2x30mins Afternoon Trio starting from 3pm",
    solo_ceremony_60min_afternoon_trio_performance_330pm:
      "Ceremony Solo & 1x60 or 2x30mins Afternoon Trio starting from 3.30pm",

    solo_ceremony_90min_afternoon_trio_performance_12pm:
      "Ceremony Solo & 3x30 or 2x45mins Afternoon Trio starting from 12pm",
    solo_ceremony_90min_afternoon_trio_performance_1230pm:
      "Ceremony Solo & 3x30 or 2x45mins Afternoon Trio starting from 12.30pm",
    solo_ceremony_90min_afternoon_trio_performance_1pm:
      "Ceremony Solo & 3x30 or 2x45mins Afternoon Trio starting from 1pm",
    solo_ceremony_90min_afternoon_trio_performance_130pm:
      "Ceremony Solo & 3x30 or 2x45mins Afternoon Trio starting from 1.30pm",
    solo_ceremony_90min_afternoon_trio_performance_2pm:
      "Ceremony Solo & 3x30 or 2x45mins Afternoon Trio starting from 2pm",
    solo_ceremony_90min_afternoon_trio_performance_230pm:
      "Ceremony Solo & 3x30 or 2x45mins Afternoon Trio starting from 2.30pm",
    solo_ceremony_90min_afternoon_trio_performance_3pm:
      "Ceremony Solo & 3x30 or 2x45mins Afternoon Trio starting from 3pm",
    solo_ceremony_90min_afternoon_trio_performance_330pm:
      "Ceremony Solo & 3x30 or 2x45mins Afternoon Trio starting from 3.30pm",

    solo_ceremony_60min_afternoon_4_piece_performance_12pm:
      "Ceremony Solo & 1x60 or 2x30mins Afternoon 4-Piece starting from 12pm",
    solo_ceremony_60min_afternoon_4_piece_performance_1230pm:
      "Ceremony Solo & 1x60 or 2x30mins Afternoon 4-Piece starting from 12.30pm",
    solo_ceremony_60min_afternoon_4_piece_performance_1pm:
      "Ceremony Solo & 1x60 or 2x30mins Afternoon 4-Piece starting from 1pm",
    solo_ceremony_60min_afternoon_4_piece_performance_130pm:
      "Ceremony Solo & 1x60 or 2x30mins Afternoon 4-Piece starting from 1.30pm",
    solo_ceremony_60min_afternoon_4_piece_performance_230pm:
      "Ceremony Solo & 1x60 or 2x30mins Afternoon 4-Piece starting from 2.30pm",
    solo_ceremony_60min_afternoon_4_piece_performance_3pm:
      "Ceremony Solo & 1x60 or 2x30mins Afternoon 4-Piece starting from 3pm",
    solo_ceremony_60min_afternoon_4_piece_performance_330pm:
      "Ceremony Solo & 1x60 or 2x30mins Afternoon 4-Piece starting from 3.30pm",

    solo_ceremony_90min_afternoon_4_piece_performance_12pm:
      "Ceremony Solo & 3x30 or 2x45mins Afternoon 4-Piece starting from 12pm",
    solo_ceremony_90min_afternoon_4_piece_performance_1230pm:
      "Ceremony Solo & 3x30 or 2x45mins Afternoon 4-Piece starting from 12.30pm",
    solo_ceremony_90min_afternoon_4_piece_performance_1pm:
      "Ceremony Solo & 3x30 or 2x45mins Afternoon 4-Piece starting from 1pm",
    solo_ceremony_90min_afternoon_4_piece_performance_130pm:
      "Ceremony Solo & 3x30 or 2x45mins Afternoon 4-Piece starting from 1.30pm",
    solo_ceremony_90min_afternoon_4_piece_performance_2pm:
      "Ceremony Solo & 3x30 or 2x45mins Afternoon 4-Piece starting from 2pm",
    solo_ceremony_90min_afternoon_4_piece_performance_230pm:
      "Ceremony Solo & 3x30 or 2x45mins Afternoon 4-Piece starting from 2.30pm",
    solo_ceremony_90min_afternoon_4_piece_performance_3pm:
      "Ceremony Solo & 3x30 or 2x45mins Afternoon 4-Piece starting from 3pm",
    solo_ceremony_90min_afternoon_4_piece_performance_330pm:
      "Ceremony Solo & 3x30 or 2x45mins Afternoon 4-Piece starting from 3.30pm",

    duo_ceremony_60min_afternoon_trio_performance_12pm:
      "Ceremony Duo & 1x60 or 2x30mins Afternoon Trio starting from 12pm",
    duo_ceremony_60min_afternoon_trio_performance_1230pm:
      "Ceremony Duo & 1x60 or 2x30mins Afternoon Trio starting from 12.30pm",
    duo_ceremony_60min_afternoon_trio_performance_1pm:
      "Ceremony Duo & 1x60 or 2x30mins Afternoon Trio starting from 1pm",
    duo_ceremony_60min_afternoon_trio_performance_130pm:
      "Ceremony Duo & 1x60 or 2x30mins Afternoon Trio starting from 1.30pm",
    duo_ceremony_60min_afternoon_trio_performance_2pm:
      "Ceremony Duo & 1x60 or 2x30mins Afternoon Trio starting from 2pm",
    duo_ceremony_60min_afternoon_trio_performance_230pm:
      "Ceremony Duo & 1x60 or 2x30mins Afternoon Trio starting from 2.30pm",
    duo_ceremony_60min_afternoon_trio_performance_3pm:
      "Ceremony Duo & 1x60 or 2x30mins Afternoon Trio starting from 3pm",
    duo_ceremony_60min_afternoon_trio_performance_330pm:
      "Ceremony Duo & 1x60 or 2x30mins Afternoon Trio starting from 3.30pm",

    duo_ceremony_90min_afternoon_trio_performance_12pm:
      "Ceremony Duo & 3x30 or 2x45mins Afternoon Trio starting from 12pm",
    duo_ceremony_90min_afternoon_trio_performance_1230pm:
      "Ceremony Duo & 3x30 or 2x45mins Afternoon Trio starting from 12.30pm",
    duo_ceremony_90min_afternoon_trio_performance_1pm:
      "Ceremony Duo & 3x30 or 2x45mins Afternoon Trio starting from 1pm",
    duo_ceremony_90min_afternoon_trio_performance_130pm:
      "Ceremony Duo & 3x30 or 2x45mins Afternoon Trio starting from 1.30pm",
    duo_ceremony_90min_afternoon_trio_performance_2pm:
      "Ceremony Duo & 3x30 or 2x45mins Afternoon Trio starting from 2pm",
    duo_ceremony_90min_afternoon_trio_performance_230pm:
      "Ceremony Duo & 3x30 or 2x45mins Afternoon Trio starting from 2.30pm",
    duo_ceremony_90min_afternoon_trio_performance_3pm:
      "Ceremony Duo & 3x30 or 2x45mins Afternoon Trio starting from 3pm",
    duo_ceremony_90min_afternoon_trio_performance_330pm:
      "Ceremony Duo & 3x30 or 2x45mins Afternoon Trio starting from 3.30pm",

    duo_ceremony_60min_afternoon_4_piece_performance_12pm:
      "Ceremony Duo & 1x60 or 2x30mins Afternoon 4-Piece starting from 12pm",
    duo_ceremony_60min_afternoon_4_piece_performance_1230pm:
      "Ceremony Duo & 1x60 or 2x30mins Afternoon 4-Piece starting from 12.30pm",
    duo_ceremony_60min_afternoon_4_piece_performance_1pm:
      "Ceremony Duo & 1x60 or 2x30mins Afternoon 4-Piece starting from 1pm",
    duo_ceremony_60min_afternoon_4_piece_performance_130pm:
      "Ceremony Duo & 1x60 or 2x30mins Afternoon 4-Piece starting from 1.30pm",
    duo_ceremony_60min_afternoon_4_piece_performance_2pm:
      "Ceremony Duo & 1x60 or 2x30mins Afternoon 4-Piece starting from 2pm",
    duo_ceremony_60min_afternoon_4_piece_performance_230pm:
      "Ceremony Duo & 1x60 or 2x30mins Afternoon 4-Piece starting from 2.30pm",
    duo_ceremony_60min_afternoon_4_piece_performance_3pm:
      "Ceremony Duo & 1x60 or 2x30mins Afternoon 4-Piece starting from 3pm",
    duo_ceremony_60min_afternoon_4_piece_performance_330pm:
      "Ceremony Duo & 1x60 or 2x30mins Afternoon 4-Piece starting from 3.30pm",

    duo_ceremony_90min_afternoon_4_piece_performance_12pm:
      "Ceremony Duo & 3x30 or 2x45mins Afternoon 4-Piece starting from 12pm",
    duo_ceremony_90min_afternoon_4_piece_performance_1230pm:
      "Ceremony Duo & 3x30 or 2x45mins Afternoon 4-Piece starting from 12.30pm",
    duo_ceremony_90min_afternoon_4_piece_performance_1pm:
      "Ceremony Duo & 3x30 or 2x45mins Afternoon 4-Piece starting from 1pm",
    duo_ceremony_90min_afternoon_4_piece_performance_130pm:
      "Ceremony Duo & 3x30 or 2x45mins Afternoon 4-Piece starting from 1.30pm",
    duo_ceremony_90min_afternoon_4_piece_performance_2pm:
      "Ceremony Duo & 3x30 or 2x45mins Afternoon 4-Piece starting from 2pm",
    duo_ceremony_90min_afternoon_4_piece_performance_230pm:
      "Ceremony Duo & 3x30 or 2x45mins Afternoon 4-Piece starting from 2.30pm",
    duo_ceremony_90min_afternoon_4_piece_performance_3pm:
      "Ceremony Duo & 3x30 or 2x45mins Afternoon 4-Piece starting from 3pm",
    duo_ceremony_90min_afternoon_4_piece_performance_330pm:
      "Ceremony Duo & 3x30 or 2x45mins Afternoon 4-Piece starting from 3.30pm",

    background_music_playlist: "Playlist 'DJ Service'",
    up_to_3_hours_manned_playlist: "Up to 3 hrs Manned Playlist",
    up_to_3_hours_band_member_DJ: "Up to 3 hrs Band Member DJing",
    DJ_live_sax_3x30mins: "DJ Live w Saxophone (up to 3 hrs with 3x30mins sax)",
    DJ_live_bongos_3x30mins:
      "DJ Live w Bongos (up to 3 hrs with 3x30mins bongos)",
    DJ_live_bongos_and_sax_3x30mins:
      "DJ Live w Saxophone & Bongos (up to 3 hrs with 3x30mins sax & bongos)",

    sound_engineering_for_another_act: "Sound Engineering for Another Act",
    add_another_vocalist: "Additional Vocalist",
    israeli_dancing_20mins_4_piece: "Israeli 20min Set",
    israeli_dancing_20mins_5_piece: "Israeli 20min Set",
    israeli_dancing_20mins_6_piece: "Israeli 20min Set",
    extra_song_request_4_piece: "Extra Song Request",
    extra_song_request_5_piece: "Extra Song Request",
    extra_song_request_6_piece: "Extra Song Request",
    remove_drums: "Remove Drums from Lineup",
    speedy_setup: "Speedy 1hr Setup & Soundcheck",

    trio_90min_afternoon_performance_1pm:
      "3x30 or 2x45mins Trio Afternoon Performance from 1pm",
    trio_90min_afternoon_performance_130pm:
      "3x30 or 2x45mins Trio Afternoon Performance from 1.30pm",
    trio_90min_afternoon_performance_2pm:
      "3x30 or 2x45mins Trio Afternoon Performance from 2pm",
    trio_90min_afternoon_performance_230pm:
      "3x30 or 2x45mins Trio Afternoon Performance from 2.30pm",
    trio_90min_afternoon_performance_3pm:
      "3x30 or 2x45mins Trio Afternoon Performance from 3pm",
    trio_90min_afternoon_performance_330pm:
      "3x30 or 2x45mins Trio Afternoon Performance from 3.30pm",

    four_90min_piece_afternoon_performance_1pm:
      "3x30 or 2x45mins 4-Piece Afternoon Performance from 1pm",
    four_90min_piece_afternoon_performance_130pm:
      "3x30 or 2x45mins 4-Piece Afternoon Performance from 1.30pm",
    four_90min_piece_afternoon_performance_2pm:
      "3x30 or 2x45mins 4-Piece Afternoon Performance from 2pm",
    four_90min_piece_afternoon_performance_230pm:
      "3x30 or 2x45mins 4-Piece Afternoon Performance from 2.30pm",
    four_90min_piece_afternoon_performance_3pm:
      "3x30 or 2x45mins 4-Piece Afternoon Performance from 3pm",
    four_90min_piece_afternoon_performance_330pm:
      "3x30 or 2x45mins 4-Piece Afternoon Performance from 3.30pm",

    extra_30min_performance_4_piece: "Extra 30mins Performance",
    extra_30min_performance_5_piece: "Extra 30mins Performance",
    extra_30min_performance_6_piece: "Extra 30mins Performance",
    extra_40min_performance_4_piece: "Extra 40mins Performance",
    extra_40min_performance_5_piece: "Extra 40mins Performance",
    extra_40min_performance_6_piece: "Extra 40mins Performance",
    extra_60min_performance_4_piece: "Extra 1hr Performance",
    extra_60min_performance_5_piece: "Extra 1hr Performance",
    extra_60min_performance_6_piece: "Extra 1hr Performance",

    late_stay_30min_4_piece: "Performing Until 12.30am",
    late_stay_60min_4_piece: "Performing Until 1am",
    late_stay_30min_5_piece: "Performing Until 12.30am",
    late_stay_60min_5_piece: "Performing Until 1am",
    late_stay_30min_6_piece: "Performing Until 1am",
    late_stay_60min_6_piece: "Performing Until 12.30am",
    playlist_only_late_stay_30min: "'DJ Service' Playlist Until 12.30am",
    playlist_only_late_stay_60min: "'DJ Service' Playlist Until 1am",
    manned_playlist_only_late_stay_30min: "Manned Playlist Until 12.30am",
    manned_playlist_only_late_stay_60min: "Manned Playlist Until 1am",
    band_member_DJ_only_late_stay_30min: "Band Member DJ Until 12.30am",
    band_member_DJ_only_late_stay_60min: "Band Member DJ Until 1am",

    early_arrival_30min_4_piece: "30mins Early Arrival",
    early_arrival_60min_4_piece: "1hr Early Arrival",
    early_arrival_90min_4_piece: "1.5hr Early Arrival",
    early_arrival_120min_4_piece: "2hr Early Arrival",
    early_arrival_150min_4_piece: "2.5hr Early Arrival",
    early_arrival_180min_4_piece: "3hr Early Arrival",
    early_arrival_210min_4_piece: "3.5hr Early Arrival",
    early_arrival_240min_4_piece: "4hr Early Arrival",
    early_arrival_30min_5_piece: "30mins Early Arrival",
    early_arrival_60min_5_piece: "1hr Early Arrival",
    early_arrival_90min_5_piece: "1.5hr Early Arrival",
    early_arrival_120min_5_piece: "2hr Early Arrival",
    early_arrival_150min_5_piece: "2.5hr Early Arrival",
    early_arrival_180min_5_piece: "3hr Early Arrival",
    early_arrival_210min_5_piece: "3.5hr Early Arrival",
    early_arrival_240min_5_piece: "4hr Early Arrival",
    early_arrival_30min_6_piece: "30mins Early Arrival",
    early_arrival_60min_6_piece: "1hr Early Arrival",
    early_arrival_90min_6_piece: "1.5hr Early Arrival",
    early_arrival_120min_6_piece: "2hr Early Arrival",
    early_arrival_150min_6_piece: "2.5hr Early Arrival",
    early_arrival_180min_6_piece: "3hr Early Arrival",
    early_arrival_210min_6_piece: "3.5hr Early Arrival",
    early_arrival_240min_6_piece: "4hr Early Arrival",
  };

  const formatDate = (dateString) => {
    if (!dateString) return "No date selected";

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

  const sortProducts = () => {
    let sortedProducts = [...shortlistData]; // Copy array to avoid mutation

    switch (sortType) {
      case "low-high":
        sortedProducts.sort(
          (a, b) => parseFloat(a.formattedPrice) - parseFloat(b.formattedPrice)
        );
        break;

      case "high-low":
        sortedProducts.sort(
          (a, b) => parseFloat(b.formattedPrice) - parseFloat(a.formattedPrice)
        );
        break;

      default:
        return; // Don't reset the filter, just return
    }

    setFilterProducts(sortedProducts);
  };

  // Use same price calculation logic as BestSeller.jsx
    const calculatePrice = (act) => {
      if (!act || !Array.isArray(act.lineups) || act.lineups.length === 0) return null;
      // Sort by number of members and pick the smallest lineup
      const sortedLineups = [...act.lineups].sort((a, b) => (a.bandMembers?.length || 0) - (b.bandMembers?.length || 0));
      const smallestLineup = sortedLineups[0];
      if (!smallestLineup || !Array.isArray(smallestLineup.bandMembers)) return null;
      const essentialFees = smallestLineup.bandMembers.reduce((acc, member) => {
        if (member.isEssential && typeof member.fee === "number") {
          acc.push(member.fee);
        }
        if (Array.isArray(member.additionalRoles)) {
          member.additionalRoles.forEach(role => {
            if (role.isEssential && typeof role.additionalFee === "number") {
              acc.push(role.additionalFee);
            }
          });
        }
        return acc;
      }, []);
      const totalFee = essentialFees.reduce((sum, fee) => sum + fee, 0);
      return totalFee ? Math.ceil(totalFee / 0.75) : null;
    };

  // ✅ Ensure price updates instantly when lineup changes
  const handleLineupChange = (lineup) => {
    console.log("🎭 Lineup Button Clicked:", lineup);
    setSelectedLineup(lineup);

    const newPrice = calculatePrice(
      actData,
      selectedCounty,
      lineup,
      selectedExtras
    ); // Pass extras
    console.log("🔄 Updated Price After Lineup Change:", newPrice);

    setAdjustedTotal(newPrice);
  };

  const staticExtrasPrices = {
    remove_drums: extrasPrices.remove_drums,
    sound_engineering_for_another_act:
      extrasPrices.sound_engineering_for_another_act,
    add_another_vocalist: extrasPrices.add_another_vocalist,
    speedy_setup: extrasPrices.speedy_setup,
  };

  const getExtraPrice = (extra, actData) => {
    for (const category of dynamicExtraCategories) {
      if (actData[category] && actData[category][extra] !== undefined) {
        return actData[category][extra];
      }
    }
    return null;
  };

  console.log("Current extrasPrices:", extrasPrices);
  const newPrice = calculatePrice(
    actData,
    selectedCounty,
    selectedLineup,
    selectedExtras,
    extrasPrices
  );

  const filterExtrasByLineup = (extras, lineup) => {
    const lineupPrefix = lineup.substring(0, 4).toLowerCase();
    return extras.filter((extra) => {
      if (extra.includes("_-pie")) {
        return extra.startsWith(`${lineupPrefix}`);
      }
      return true; // Keep extras that aren't "_-pie" related
    });
  };


  const scrollThumbnails = (direction) => {
    const container = thumbnailRef.current;
    if (!container) return;

    const scrollAmount = 100;
    container.scrollBy({
      left: direction === "left" ? -scrollAmount : scrollAmount,
      behavior: "smooth",
    });
  };

  

  


 const updateLineup = (actId, newLineupId) => {
  setShortlistItems((prev) => {
    const actShortlist = { ...prev[actId] };
    const quantity = actShortlist[item.selectedLineup];
    delete actShortlist[item.selectedLineup]; // remove old
    actShortlist[newLineupId] = quantity; // add new
    return {
      ...prev,
      [actId]: actShortlist,
    };
  });
};

 
  return (
    <div className="border-t pt-14">
      <div className="text-2xl mb-3">
        <Title text1={"MY"} text2={"SHORTLIST"} />
      </div>

      <div>
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

      {/* ✅ Date & Venue Selection */}
      {selectedDate && selectedAddress ? (
        <p className="text-sm mt-3 p-2 text-gray-500">
          Showing results for:
          <span className="text-gray-700">
            {" "}
            {formatDate(selectedDate)} at {storedPlace && `${storedPlace}, `}
            {selectedAddress}
          </span>
          <span
            onClick={() => setShowSearch(true)}
            className="text-blue-600 cursor-pointer underline ml-2"
          >
            edit date and/or venue
          </span>
        </p>
      ) : (
        <p className="text-sm mt-3 p-2 text-gray-500">
          Please select a date and location to give you an accurate price and
          availability
          <span
            onClick={() => setShowSearch(true)}
            className="text-blue-600 cursor-pointer underline ml-2"
          >
            add my date and location
          </span>
        </p>
      )}

      {/* ✅ Shortlist Items */}
      <div>
        {shortlistData.length === 0 ? (
          <p className="text-gray-500 text-center mt-10">
            Your shortlist is empty. Start adding your favorite acts!
          </p>
        ) : (
          <>
            {shortlistData.map((item, index) => {
  const actData = acts.find((act) => act._id === item._id);
  if (!actData) return null;

  const tscVideos = actData.tscVideos || [];

  const selectedVideo = selectedVideoMap[item._id] || tscVideos[0]?.url;
  const videoManuallySelected = videoManuallySelectedMap[item._id] || false;

  const embedSrc = selectedVideo
    ? `https://www.youtube.com/embed/${extractYouTubeId(selectedVideo)}?modestbranding=1&rel=0&showinfo=0&controls=1${
        videoManuallySelected ? "&autoplay=1" : ""
      }`
    : null;

  const handleThumbnailClick = (videoUrl) => {
    setSelectedVideoMap((prev) => ({
      ...prev,
      [item._id]: videoUrl,
    }));
    setVideoManuallySelectedMap((prev) => ({
      ...prev,
      [item._id]: true,
    }));
  };

          
              // ✅ Calculate adjusted price
              const adjustedTotal = calculatePrice(
                actData,
                selectedCounty,
                item.selectedLineup,
                selectedExtras // ✅ Add this!
              );

              return (
                <div key={index} className="border rounded-lg p-2 shadow-md">
                  {/* ✅ Full-width section with overlay */}
                  <div key={index} className="  p-1">
                    {/* ✅ Header with background and overlay */}
                    <div
                      className="relative w-full p-3 rounded-md text-center flex flex-row justify-between bg-cover bg-center bg-no-repeat text-white"
                      style={{
                        backgroundImage: `url(${actData.images[0].url})`,
                      }}
                    >
                      {/* ✅ Dark overlay */}
                      <div className="absolute inset-0 bg-black opacity-50 rounded-md z-0"></div>

                      {/* ✅ Left content */}
                      <div className="relative z-10 text-2xl font-regular px-3 pt-1">
                        {actData.tscName}
                      </div>

                      {/* ✅ Center content */}
                      <div className="relative z-10">
                        <p>Available with Shamyra on lead vocals ✅</p>
                        <p className="text-xs">Learn more about Shamyra here</p>
                      </div>

                      {/* ✅ Right bin icon (highest priority) */}
                      <div className="relative z-10 flex items-start">
                        <img
                          onClick={() =>
                            updateShortlistQuantity(
                              item._id,
                              item.selectedLineup,
                              0
                            )
                          }
                          className="w-1 h-6 mr-3 mt-2 cursor-pointer z-10 relative sm:w-7 sm:h-7 "
                          src={assets.white_bin_icon}
                          alt="Delete"
                        />
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-row py-4  text-gray-700  justify-between gap-4">
                    {/* ✅ First Column: Video & Thumbnails */}
                    {/* ✅ First Column: Video & Thumbnails */}
                    <div className="w-full sm:w-1/4 pl-4 pr-2">
                      <p className="text-lg mb-2 text-center">VIDEOS</p>

                      {tscVideos.length > 0 ? (
                        <>
                          {/* ✅ Main Video Display */}
                         <div className="relative">
 {selectedVideo && (
  <iframe
    className="w-full h-44 sm:h-56 rounded"
    src={embedSrc}
    title="Selected Video"
    frameBorder="0"
    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
    allowFullScreen
  />
)}
</div>



                          <div className="relative mt-2">
                            {/* Scroll Left Button */}
                            <button
                              onClick={() => scrollThumbnails("left")}
                              className="absolute -left-6 top-1/2 transform -translate-y-1/2 z-10"
                              aria-label="Scroll left"
                              type="button"
                            >
                              <img
                                src={assets.scroll_left_icon}
                                alt="Scroll left"
                                className="w-6 h-6 md:w-8 md:h-8"
                              />
                            </button>

                            {/* Thumbnails Container */}
                            <div
                              ref={thumbnailRef}
                              className="flex gap-2 overflow-x-auto pb-2 scroll-smooth scrollbar-hide"
                              style={{ scrollBehavior: "smooth" }}
                            >
                             {tscVideos.map((videoObj, idx) => {
  const videoId = extractYouTubeId(videoObj.url);
  return (
    <img
      key={idx}
      onClick={() => handleThumbnailClick(videoObj.url)}
      className={`w-[80px] h-[56px] object-cover rounded cursor-pointer flex-shrink-0 border-2 ${
        selectedVideo === videoObj.url ? "border-[#ff6667]" : "border-transparent"
      } hover:border-[#ff6667] hover:shadow-md transition duration-200`}
      src={`https://img.youtube.com/vi/${videoId}/0.jpg`}
      alt={videoObj.title || `Video ${idx + 1}`}
    />
  );
})}
                            </div>

                            {/* Scroll Right Button */}
                            <button
                              onClick={() => scrollThumbnails("right")}
                              className="absolute -right-6 top-1/2 transform -translate-y-1/2 z-10"
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
                        </>
                      ) : (
                        <p className="text-gray-400">No videos available.</p>
                      )}

                      {/* ✅ Inclusions section */}
                      <p className="text-lg text-gray-800 text-center mb-2">
                        INCLUSIONS
                      </p>
                      <ul className="list-disc ml-5">
                        <li className="text-m text-gray-800">
                          Up to {actData.standard_set_lengths} live performance
                        </li>
                        <li className="text-m text-gray-800">
                          A PA and lighting system to light up your stage and
                          your dance floor
                        </li>
                        <li className="text-m text-gray-800">
                          The band on site for up to 7 hours, or until midnight,
                          whichever comes first
                        </li>
                        <li className="text-m text-gray-800">
                          Complimentary playlist music before, between, and
                          after live sets as needed
                        </li>
                        <li className="text-m text-gray-800">
                          An ‘off repertoire' song request, e.g. a first dance
                          or favourite song
                        </li>
                        <li className="text-m text-gray-800">
                          A tailored setlist – suggest your favourites from the
                          band's repertoire
                        </li>
                        <li className="text-m text-gray-800">& travel.</li>
                      </ul>
                    </div>

                    {/* ✅ Second Column: Act Details */}
                    <div className="flex flex-col flex-1 w-1/4">
                      <div className="text-m text-gray-800">
                        <p className="text-lg mb-2 text-center">FAQs</p>
                        {(() => {
                          const selectedLineupData = actData.lineups.find(
                            (lineup) =>
                              lineup.actSize.substring(0, 3).toLowerCase() ===
                              item.selectedLineup.substring(0, 3).toLowerCase()
                          );

                          return (
                            <p>
                              <b>Setup & Soundcheck Time Required:</b>{" "}
                              {selectedLineupData?.totalSetupAndSoundcheckTime ||
                                "N/A"}{" "}
                              mins, of which{" "}
                              {selectedLineupData?.setupTime || "N/A"} mins is
                              setup time (moving equipment in place and getting
                              everything plugged in), and of which{" "}
                              {selectedLineupData?.soundcheckTime || "N/A"} mins
                              is soundcheck (the noisy bit where you can expect
                              songs to be played at full volume level to make
                              sure the acoustics and levels are right for a
                              happy performance for all involved)
                            </p>
                          );
                        })()}
                        <p>
                          <b>Space Required:</b> The{" "}
                          {Array.isArray(actData.space_required) &&
                          item.selectedLineup
                            ? actData.space_required.find(
                                (space) =>
                                  space.act_size
                                    .substring(0, 3)
                                    .toLowerCase() ===
                                  item.selectedLineup
                                    .substring(0, 3)
                                    .toLowerCase()
                              )?.act_size || item.selectedLineup
                            : "selected lineup"}{" "}
                          requires{" "}
                          {Array.isArray(actData.space_required) &&
                          item.selectedLineup
                            ? actData.space_required.find(
                                (space) =>
                                  space.act_size
                                    .substring(0, 3)
                                    .toLowerCase() ===
                                  item.selectedLineup
                                    .substring(0, 3)
                                    .toLowerCase()
                              )?.space || "N/A"
                            : "N/A"}
                          . Please see the{" "}
                          <a
                            href="/space_requirements"
                            className="text-blue-600 underline"
                          >
                            {" "}
                            space guide here
                          </a>{" "}
                          for more detail
                        </p>
                        <p>
                          <b>Packdown Time Required:</b> {actData.packdown}mins
                        </p>
                        <p>
                          <b>PLI</b>: Up to {currency}
                          {actData.pli}m cover
                        </p>
                        <p>
                          <b>PAT Certificates:</b>{" "}
                          {actData.pat_cert ? "Yes" : "No"}
                        </p>

                        {/* ✅ PA System Details */}
                        <p>
                          <b>PA:</b>{" "}
                          {actData.paAndLights?.pa_provision
                            ? "This act has a PA system"
                            : "This act does not have a PA system."}
                          {actData.paAndLights?.large_pa_size
                            ? " suitable for up to 500 guests"
                            : actData.paAndLights?.medium_pa_size
                              ? " suitable for up to 250 guests"
                              : actData.paAndLights?.small_pa_size
                                ? " suitable for up to 100 guests"
                                : ""}
                        </p>

                        {/* ✅ Sound Limitations */}
                        <p>
                          <b>Sound Limitations:</b> This act is able to perform
                          with limiters as low as{" "}
                          {Object.keys(
                            actData.soundLimiters?.sound_limitation || {}
                          )
                            .filter(
                              (db) =>
                                actData.soundLimiters?.sound_limitation?.[db]
                            )
                            .sort((a, b) => parseInt(a) - parseInt(b))[0] ||
                            "N/A"}
                          {", "}
                          {
                            // Create an array of truthy values
                            [
                              actData.soundLimiters?.electric_drums
                                ? "has an electric drum kit"
                                : null,
                              actData.soundLimiters?.iems
                                ? "has noise-reducing in-ear monitors"
                                : null,
                              actData.soundLimiters?.ampless
                                ? "can perform with no amps"
                                : null,
                            ]
                              .filter(Boolean) // Remove null/undefined values
                              .join(", ") // Join with a comma
                              .replace(/, ([^,]*)$/, " & $1") // ✅ Replace last comma with " &"
                          }
                        </p>
                        <p>
                          <b>Rider: </b>
                          {Array.isArray(actData.rider) &&
                          actData.rider.length > 1
                            ? actData.rider.slice(0, -1).join(", ") +
                              " & " +
                              actData.rider.slice(-1)
                            : actData.rider}
                        </p>
                      </div>
                    </div>

                    <div className="flex flex-col items-center sm:w-1/4 text-center">
                      <p className="text-lg mb-2 text-center">
                        PROVISIONAL SCHEDULE
                      </p>

                      <DynamicTimetable
                        actData={actData}
                        selectedExtras={selectedExtras}
                      />
                    </div>
                    {/* ✅ Third Column: Price & Lineup Selection */}
                    <div className="flex flex-col items-center sm:w-1/4 text-center">
                      <p className="text-lg mb-2 text-center">EXTRAS</p>

                      <ExtrasFilter
                        actData={actData}
                        currency={currency}
                        selectedExtras={selectedExtras}
                        setSelectedExtras={setSelectedExtras}
                        selectedLineup={selectedLineup}
                        state={state}
                        onExtrasPricesUpdate={handleExtrasPricesUpdate} // ✅ Make sure this is passed!
                      />
                    </div>
                  </div>
                  {/* ✅ Full-width section above three columns */}
                  <div className="w-full bg-gray-100 p-3 rounded-md text-center items-center flex flex-row justify-between ">
                    {/* You can customize this content */}
                    <div className="text-lg  px-3">
                      {/* ✅ Dropdown for selecting lineup */}
                      <select
                        className="border px-2 py-1 text-sm"
                        value={item.selectedLineup}
                        onChange={(e) => {
  const newLineupId = e.target.value;
  updateLineup(item._id, newLineupId); // ✅ updates shortlist state

  // Optional: recalculate price if needed
  if (actData) {
    const newPrice = calculatePrice(
      actData,
      selectedCounty,
      newLineupId,
      selectedExtras[item._id] || [],
      extrasPrices[item._id] || {}
    );
    setAdjustedTotalMap((prev) => ({
      ...prev,
      [item._id]: newPrice,
    }));
  }
}}
                      >
                        {actData.lineups.map((lineup, idx) => (
                          <option key={idx} value={lineup.lineupId}>
                            {lineup.actSize}
                          </option>
                        ))}
                      </select>

                      {false && (
                        <input
                          onChange={(e) => {
                            const newShortlistQuantity = Number(e.target.value);
                            if (newShortlistQuantity > 0)
                              updateShortlistQuantity(
                                item._id,
                                item.selectedLineup,
                                newQuantity
                              );
                          }}
                          className="border max-w-10 sm:max-w-20 px-1 sm:px-2 py-1 text-sm"
                          type="number"
                          min={1}
                          defaultValue={item.quantity}
                        />
                      )}
                    </div>
                    <div className="flex flex-wrap gap-2"></div>
                    <div>
                      <div className="flex flex-wrap gap-2">
                        {filterExtrasByLineup(
                          selectedExtras,
                          selectedLineup
                        ).map((extra, index) => {
                          let price = staticExtrasPrices[extra]
                            ? Math.ceil(staticExtrasPrices[extra] / 0.8)
                            : (extrasPrices[extra] ??
                              getExtraPrice(extra, actData));

                          const adjustedPrice = price
                            ? Math.ceil(price / 0.8)
                            : null;

                          return (
                            <span
                              key={`${extra}_${index}`}
                              className="bg-gray-200 text-gray-700 text-xs px-2 py-1 rounded flex items-center gap-2"
                            >
                              {labelMap[extra] || extra}
                              {adjustedPrice !== null && (
                                <span className="font-bold">
                                  {currency}
                                  {adjustedPrice}
                                </span>
                              )}
                              <button
                                onClick={() => {
                                  setSelectedExtras((prevExtras) =>
                                    prevExtras.filter((item) => item !== extra)
                                  );
                                }}
                                className="text-gray-500 text-xs font-bold"
                              >
                                ✖️
                              </button>
                            </span>
                          );
                        })}
                      </div>
                      <div className="text-lg font-semibold px-3 flex justify-end w-full mt-3">
                        {currency}
                        {adjustedTotal}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </>
        )}
      </div>

      {/* ✅ Proceed Button */}
      {shortlistData.length > 0 && (
        <div className="flex justify-end mt-10">
          <button
            onClick={() => navigate("/place-booking")}
            className="bg-black text-white px-8 py-3 text-lg"
          >
            PROCEED TO BOOK
          </button>
        </div>
      )}
    </div>
  );
};

export default Shortlist;
