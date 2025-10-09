import React, { useContext, useState, useEffect, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ShopContext } from "../context/ShopContext";
import { assets } from "../assets/assets";
import RelatedActs from "../components/RelatedActs";
import { postcodes } from "../assets/assets";
import calculateActPricing from "./utils/pricing";
import { toast } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";
import CustomToast from "../components/CustomToast";
import ActHero from "../components/ActHero";
import ReviewCard from "../components/ReviewCard";
import RepertoireSection from "../components/RepertoireSection";
import Title from "../components/Title";
import { getPossessiveTitleCase } from "./utils/getPossessiveTitleCase"; // adjust path as needed
import AcousticExtrasSelector from "../components/AcousticExtrasSelector";
import ActPerformanceOverview from "../components/ActPerformanceOverview";
import axios from "axios";
import { useLocation } from "react-router-dom";
import { VocalistFeaturedAvailable } from "../components/FeaturedVocalistBadge";

// Calculate average rating from reviews, rounded to nearest 0.5
const calculateAverageRating = (reviews) => {
  if (!reviews || reviews.length === 0) return 0;
  const sum = reviews.reduce(
    (total, review) => total + (review.rating || 0),
    0
  );
  return Math.round((sum / reviews.length) * 2) / 2; // round to nearest 0.5
};

const Act = () => {
  const backendUrl = import.meta.env.VITE_BACKEND_URL;
  const location = useLocation();

  // Extract YouTube video ID from a full URL or return as-is if already an ID
  const extractVideoId = (url) => {
    if (!url) return "";
    const match = url.match(/(?:v=|\/)([0-9A-Za-z_-]{11})/);
    return match ? match[1] : url;
  };
  const { actId } = useParams();
  const {
    acts,
    addToCart,
    addToShortlist,
    selectedDate,
    selectedAddress,
    setShowSearch,
    userId, shortlistAct, shortlistedActs, setShortlistedActs, cartItems, removeFromCart
  } = useContext(ShopContext);
  const [selectedCounty, setSelectedCounty] = useState(
    sessionStorage.getItem("selectedCounty") || ""
  );

  useEffect(() => {
    if (location.hash) {
      const target = document.querySelector(location.hash);
      if (target) {
        setTimeout(() => {
          target.scrollIntoView({ behavior: "smooth", block: "start" });
        }, 100); 
      }
    }
  }, [location]);
  
  const [actData, setActData] = useState(null);

  const [isYesForSelectedDate, setIsYesForSelectedDate] = useState(null);

  const [selectedLineup, setSelectedLineup] = useState("");
  const [video, setVideo] = useState("");
  const [adjustedTotal, setAdjustedTotal] = useState(null);
  const navigate = useNavigate();
  const storedPlace = sessionStorage.getItem("selectedPlace") || "";
  const availableCounties =
    postcodes?.length > 0 ? Object.keys(postcodes[0]) : [];
  const [formattedPrice, setFormattedPrice] = useState(null);
  const [playing, setPlaying] = useState(false);


const id = extractVideoId(video);

 const handleShortlistToggle = async () => {
  if (!selectedLineup) {
    console.warn("⚠️ No lineup selected before adding/removing from shortlist");
    return;
  }
  if (!actData?._id) return;

  try {
    await shortlistAct(userId, actData._id);  // context method does optimistic update + server patch
    // Optional UX toast if you want:
    // const inNow = shortlistedActs.includes(String(actData._id));
    // toast(<CustomToast type="success" message={inNow ? "Added to shortlist!" : "Removed from shortlist."} />, { position: "top-right", autoClose: 1400 });
  } catch (e) {
    console.error("❌ Shortlist toggle failed", e);
    toast(<CustomToast type="error" message="Could not update shortlist." />, { position: "top-right", autoClose: 1600 });
  }
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

  // Gallery Carousel logic
  const galleryRef = useRef(null);

  const scrollGallery = (direction) => {
    if (galleryRef.current) {
      const scrollAmount = direction === "left" ? -400 : 400;
      galleryRef.current.scrollBy({ left: scrollAmount, behavior: "smooth" });
    }
  };

  // verify latest reply on this act+date (use stable actId to avoid stale state)
  useEffect(() => {
    let abort = false;
    (async () => {
      try {
        if (!actId || !selectedDate) {
          if (!abort) setIsYesForSelectedDate(null);
          return;
        }

        const base = (import.meta.env.VITE_BACKEND_URL || "").replace(/\/+$/, "");
        const dateISO = new Date(selectedDate).toISOString().slice(0, 10);
        const u = new URL(`${base}/api/v2/availability/acts-by-dateV2`);
        u.searchParams.set("date", dateISO);
        u.searchParams.set("actId", String(actId));

        const resp = await fetch(u.toString(), { headers: { accept: "application/json" } });
        const text = await resp.text();
        let j = {};
        try { j = text ? JSON.parse(text) : {}; } catch { j = {}; }
        if (!resp.ok) throw new Error(`availability ${resp.status}`);

        if (!abort) {
          // tolerate different shapes; prefer explicit latestReply
          const latest = j?.latestReply || j?.latest || j?.reply || null;
          setIsYesForSelectedDate(latest === "yes" ? true : (latest === "no" ? false : null));
        }
      } catch (e) {
        if (!abort) setIsYesForSelectedDate(null);
      }
    })();
    return () => { abort = true; };
  }, [actId, selectedDate]);



  // Touch/swipe gesture support for gallery carousel (images)
  useEffect(() => {
    const el = galleryRef.current;
    if (!el) return;
    let startX = 0;
    let scrollLeft = 0;
    let isDown = false;

    const onTouchStart = (e) => {
      isDown = true;
      startX = e.touches[0].pageX - el.offsetLeft;
      scrollLeft = el.scrollLeft;
    };
    const onTouchMove = (e) => {
      if (!isDown) return;
      const x = e.touches[0].pageX - el.offsetLeft;
      const walk = startX - x;
      el.scrollLeft = scrollLeft + walk;
    };
    const onTouchEnd = () => {
      isDown = false;
    };
    el.addEventListener("touchstart", onTouchStart);
    el.addEventListener("touchmove", onTouchMove);
    el.addEventListener("touchend", onTouchEnd);
    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
    };
  }, []);

  // Review gallery carousel logic
  const reviewGalleryRef = useRef(null);

  const scrollReviews = (direction) => {
    if (reviewGalleryRef.current) {
      const scrollAmount = direction === "left" ? -400 : 400;
      reviewGalleryRef.current.scrollBy({
        left: scrollAmount,
        behavior: "smooth",
      });
    }
  };

  useEffect(() => {
    const el = reviewGalleryRef.current;
    if (!el) return;
    let startX = 0;
    let scrollLeft = 0;
    let isDown = false;

    const onTouchStart = (e) => {
      isDown = true;
      startX = e.touches[0].pageX - el.offsetLeft;
      scrollLeft = el.scrollLeft;
    };
    const onTouchMove = (e) => {
      if (!isDown) return;
      const x = e.touches[0].pageX - el.offsetLeft;
      const walk = startX - x;
      el.scrollLeft = scrollLeft + walk;
    };
    const onTouchEnd = () => {
      isDown = false;
    };
    el.addEventListener("touchstart", onTouchStart);
    el.addEventListener("touchmove", onTouchMove);
    el.addEventListener("touchend", onTouchEnd);
    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
    };
  }, []);

  useEffect(() => {
    if (acts.length > 0) {
      const foundAct = acts.find((item) => item._id === actId);
      if (foundAct) {
        const avgRating = calculateAverageRating(foundAct.reviews || []);
        setActData({
          ...foundAct,
          averageRating: avgRating,
        });
        setVideo(foundAct.videos?.[0]?.url || "");
        if (Array.isArray(foundAct.lineups) && foundAct.lineups.length > 0) {
          setSelectedLineup(foundAct.lineups[0]); // Set first lineup as default
        }
      }
    }
  }, [actId, acts]);

  // ✅ Ensure price updates instantly when lineup changes

  const handleLineupChange = (lineup) => {
    setSelectedLineup(lineup);

    if (actData) {
      let basePrice = lineup?.base_fee?.[0]?.total_fee || 0;

      const additionalEssentialRoles = lineup.bandMembers.flatMap((member) =>
        (member.additionalRoles || []).filter(
          (r) => r.isEssential && typeof r.additionalFee === "number"
        )
      );
      const additionalRolesTotal = additionalEssentialRoles.reduce(
        (sum, role) => sum + role.additionalFee,
        0
      );

      basePrice += additionalRolesTotal;
      const displayPrice = Math.ceil(basePrice / 0.75);
      setFormattedPrice(displayPrice);
    }
  };

  const [finalTravelPrice, setFinalTravelPrice] = useState(null);

  useEffect(() => {
    const fetchPrice = async () => {
      if (!actData || !selectedLineup || !selectedDate || !selectedAddress) {
        console.debug("Skipping travel price calc – waiting for inputs");
        return;
      }

      const selectedCounty =
        selectedAddress?.split(",").slice(-2)[0]?.trim() || "";

      try {
        const result = await calculateActPricing(
          actData,
          selectedCounty,
          selectedAddress,
          selectedDate,
          selectedLineup
        );

        if (result) {
          setFinalTravelPrice(result);
        } else {
          console.warn(
            "⚠️ Failed to calculate travel-inclusive price (null result)"
          );
        }
      } catch (error) {
        console.error("❌ Error in price calculation:", error);
      }
    };

    fetchPrice();
  }, [actData, selectedLineup, selectedDate, selectedAddress]);

  const generateDescription = (lineup) => {
    const count = lineup.actSize || lineup.bandMembers.length;

    const instruments = lineup.bandMembers
      .filter((m) => m.isEssential)
      .map((m) => m.instrument)
      .filter(Boolean);

    instruments.sort((a, b) => {
      const aLower = a.toLowerCase();
      const bLower = b.toLowerCase();
      const isVocal = (str) => str.includes("vocal");
      const isDrums = (str) => str === "drums";

      if (isVocal(aLower) && !isVocal(bLower)) return -1;
      if (!isVocal(aLower) && isVocal(bLower)) return 1;
      if (isDrums(aLower)) return 1;
      if (isDrums(bLower)) return -1;
      return 0;
    });

    const formatWithAnd = (arr) => {
      const unique = [...new Set(arr)];
      if (unique.length === 0) return "";
      if (unique.length === 1) return unique[0];
      if (unique.length === 2) return `${unique[0]} & ${unique[1]}`;
      return `${unique.slice(0, -1).join(", ")} & ${unique[unique.length - 1]}`;
    };

    const roles = lineup.bandMembers.flatMap((member) =>
      (member.additionalRoles || [])
        .filter((r) => r.isEssential)
        .map((r) => r.role || r.role || "Unnamed Service")
    );

    if (count === 0) return "Add a Lineup";

    const instrumentsStr = formatWithAnd(instruments);
    const rolesStr = roles.length
      ? ` (including ${formatWithAnd(roles)} services)`
      : "";

    return `${count}: ${instrumentsStr}${rolesStr}`;
  };

  // Check if the act is already in the cart
  const isInCart =
    actData &&
    cartItems[actData._id] &&
    Object.keys(cartItems[actData._id]).length > 0;

  // Derived cart lineup and comparison (for sticky cart button)
  const cartLineupId =
    actData && cartItems[actData._id]
      ? Object.keys(cartItems[actData._id])[0] || null
      : null;
  const selectedLineupId = selectedLineup?._id || selectedLineup?.lineupId || null;
  const isSameLineupAsCart =
    !!cartLineupId && !!selectedLineupId && String(cartLineupId) === String(selectedLineupId);

  // Is this act currently shortlisted?
  const isShortlisted =
    Array.isArray(shortlistedActs) && actData?._id
      ? shortlistedActs.includes(actData._id)
      : false;

  const setlistDescriptions = {
    smallTailoring:
      " performs our signature setlist that we know works brilliantly with any audience.",
    mediumTailoring:
      " blends client favourites with our signature hits — usually around 50% client picks, 50% proven crowd-pleasers.",
    largeTailoring:
      " aims to accommodate nearly all client suggestions — typically 90-100% of the set is built from client suggestions.",
  };

  const paMap = {
    smallPA: "small",
    mediumPA: "medium",
    largePA: "large",
  };

  const lightMap = {
    smallLight: "small",
    mediumLight: "medium",
    largeLight: "large",
  };

  const numberToWords = (num) => {
    const words = [
      "Zero",
      "One",
      "Two",
      "Three",
      "Four",
      "Five",
      "Six",
      "Seven",
      "Eight",
      "Nine",
      "Ten",
      "Eleven",
      "Twelve",
      "Thirteen",
      "Fourteen",
      "Fifteen",
      "Sixteen",
      "Seventeen",
      "Eighteen",
      "Nineteen",
      "Twenty",
      "Twenty-one",
      "Twenty-two",
      "Twenty-three",
      "Twenty-four",
      "Twenty-five",
      "Twenty-six",
      "Twenty-seven",
      "Twenty-eight",
      "Twenty-nine",
      "Thirty",
    ];
    return words[num] || num;
  };

  /**
   * Props:
   *  - imageUrl: string (the CROPPED headshot url)
   *  - size: number (px) – overall badge box (ring scales with it)
   *  - photoScale: number (0–1) – how big the circular photo sits inside the ring
   *  - photoOffsetY: number (px) – nudge the photo upward a little to compensate for the ribbon
   */

  // Ensure hooks above always run; show loading UI after hooks are set up
  if (!actData) {
    return <div className="p-4 text-gray-500">Loading act details...</div>;
  }

  return (
    <div className="p-4">
      {/* Top Navigation */}
      <div className="flex justify-between items-center mb-4">
        {/* Back Button */}
        <button
          onClick={() => navigate(-1)}
          className="text-gray-600 hover:text-black"
        >
          ← Back
        </button>

        <div>
          {" "}
          {/* ✅ Date & Venue Selection */}
          {selectedDate && selectedAddress ? (
            <p className="text-sm mt-3 p-2 text-gray-500">
              Showing results for:
              <span className="text-gray-700">
                {" "}
                {formatDate(selectedDate)} at{" "}
                {storedPlace && `${storedPlace}, `}
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
            <p className="text-sm mt-3 p-2 text-gray-500 justify-center">
              Please select a date and location for an accurate price and
              availability
              <span
                onClick={() => setShowSearch(true)}
                className="text-blue-600 cursor-pointer underline ml-2"
              >
                add my date and location
              </span>
            </p>
          )}
        </div>
        <div></div>
      </div>
      <ActHero actId={actId} acts={acts} />
      <div className="border-t-2 pt-10 transition-opacity ease-in duration-500 opacity-100">
        <div className="flex flex-col sm:flex-row gap-6 w-full">
          {/* Left: Video & Bio stacked together */}
          <div className="w-full sm:w-[60%] ">
            {/* Video section */}
            <div className="aspect-video">
              <div className="text-2xl mt-6">
                <Title
                  text1={getPossessiveTitleCase(actData?.tscName)}
                  text2="VIDEOS"
                />
              </div>
              {(() => {
                const selectedVideoId = extractVideoId(video);
                return (
                  <div className="relative aspect-video rounded overflow-hidden">
    {!playing ? (
      <button
        type="button"
        className="group w-full h-full relative"
        onClick={() => setPlaying(true)}
        aria-label="Play video"
      >
        <img
          src={`https://img.youtube.com/vi/${selectedVideoId}/hqdefault.jpg`}
          alt="Video thumbnail"
          className="w-full h-full object-cover"
        />
        <span className="absolute inset-0 grid place-items-center">
          <span className="rounded-full p-4 bg-black/50 group-hover:bg-black/70 transition">
            {/* play triangle */}
            <svg width="36" height="36" viewBox="0 0 24 24" fill="#fff"><path d="M8 5v14l11-7z" /></svg>
          </span>
        </span>
      </button>
    ) : (
      <iframe
        className="w-full h-full"
        src={`https://www.youtube.com/embed/${selectedVideoId}?autoplay=1&modestbranding=1&rel=0&controls=1`}
        title="YouTube player"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowFullScreen
      />
    )}
  </div>
                );
              })()}
            </div>
            {/* Video thumbnails */}
            <div className="flex gap-2 overflow-x-auto pb-2 mt-2">
              {actData.videos?.map((videoObj, index) => {
                const videoId = extractVideoId(videoObj.url);
                return (
                  <img
                    key={index}
                    onClick={() => setVideo(videoObj.url)}
                    className="w-[80px] h-[56px] object-cover rounded cursor-pointer flex-shrink-0 border-2 border-transparent hover:border-[#ff6667] hover:shadow-md transition duration-200 rounded"
                    src={`https://img.youtube.com/vi/${videoId}/0.jpg`}
                    alt={videoObj.title || `Video ${index + 1}`}
                  />
                );
              })}
            </div>
            {/* Inclusions (mobile only) */}
            <div className="block sm:hidden">
              <div className="text-2xl mt-6" id="lineup-selector-mobile">
                <Title
                  text1={getPossessiveTitleCase(actData?.tscName)}
                  text2="INCLUSIONS"
                />
              </div>
              <div className="flex items-center gap-1 mt-2 pl-3">
                {[1, 2, 3, 4, 5].map((i) => (
                  <img
                    key={i}
                    className="w-3.5"
                    src={
                      actData.averageRating >= i
                        ? assets.star_icon
                        : actData.averageRating >= i - 0.5
                        ? assets.star_half_icon
                        : assets.star_dull_icon
                    }
                    alt={`Star ${i}`}
                  />
                ))}
                <p className="pl-2">({actData.reviews?.length || 0})</p>
              </div>
          {/* ✅ Sticky bar only on mobile */}
{actData && (
  <div className="sm:hidden fixed bottom-0 left-0 right-0 bg-white border-t p-4 flex gap-3 z-50">
    <button
      onClick={() => {
        if (navigator.share) {
          navigator.share({
            title: actData?.tscName || "Act",
            text: `Check out this amazing act: ${actData?.tscName}`,
            url: window.location.href,
          }).catch(err => console.error("Share failed:", err));
        } else {
          alert("Sharing not supported in this browser.");
        }
      }}
      className="p-3 rounded-md bg-[#ff6667] text-white hover:bg-[#ff6667] active:bg-black transition"
      aria-label="Share act"
    >
      {/* share icon */}
      <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-share-icon lucide-share"><path d="M12 2v13"/><path d="m16 6-4-4-4 4"/><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/></svg>
    </button>
    <button
      onClick={handleShortlistToggle}
      aria-pressed={isShortlisted}
      className={`flex-1 px-4 py-3 rounded text-sm font-medium transition-colors ${
        isShortlisted
          ? "bg-white text-black border border-black hover:bg-[#ff6667] hover:text-white"
          : "bg-black text-white hover:bg-[#ff6667]"
      }`}
    >
      {isShortlisted ? "REMOVE FROM SHORTLIST" : "ADD TO SHORTLIST"}
    </button>
    <button
      onClick={() => {
        if (!selectedLineup) {
          console.warn("⚠️ No lineup selected before adding to cart");
          return;
        }

        if (!isInCart) {
          // add the currently selected lineup
          addToCart(
            actData._id,
            selectedLineup._id || selectedLineup.lineupId
          );
          toast(
            <CustomToast type="success" message="Added to cart!" />,
            { position: "top-right", autoClose: 1600 }
          );
          return;
        }

        // cart has an entry
        if (isSameLineupAsCart) {
          // same lineup selected -> remove from cart
          const lineupIds = Object.keys(cartItems[actData._id] || {});
          lineupIds.forEach((lineupId) => removeFromCart(actData._id, lineupId));
          toast(
            <CustomToast type="success" message="Removed from cart." />,
            { position: "top-right", autoClose: 1600 }
          );
        } else {
          // different lineup selected -> replace (update lineup)
          const lineupIds = Object.keys(cartItems[actData._id] || {});
          lineupIds.forEach((lineupId) => removeFromCart(actData._id, lineupId));
          addToCart(
            actData._id,
            selectedLineup._id || selectedLineup.lineupId
          );
          toast(
            <CustomToast type="success" message="Lineup updated in cart!" />,
            { position: "top-right", autoClose: 1600 }
          );
        }
      }}
      className="flex-1 px-4 py-3 rounded text-sm font-medium bg-black text-white hover:bg-[#ff6667] transition"
      aria-pressed={!!isInCart}
    >
      {!isInCart ? "ADD TO CART" : isSameLineupAsCart ? "REMOVE FROM CART" : "UPDATE LINEUP"}
    </button>
  </div>
)}
              <p className="mt-5 text-3xl font-medium p-3">
                {(() => {
                  let basePrice = selectedLineup?.base_fee?.[0]?.total_fee || 0;
                  selectedLineup?.bandMembers?.forEach((member) => {
                    const essentialRoles = (member.additionalRoles || []).filter(
                      (r) => r.isEssential && typeof r.additionalFee === "number"
                    );
                    basePrice += essentialRoles.reduce((sum, r) => sum + r.additionalFee, 0);
                  });
                  const displayPrice = basePrice > 0 ? Math.ceil(basePrice / 0.75) : 0;
                  if (finalTravelPrice) {
                    return finalTravelPrice.travelCalculated
                      ? `£${finalTravelPrice.total}`
                      : `from £${finalTravelPrice.total}`;
                  } else if (formattedPrice) {
                    return `from £${formattedPrice}`;
                  } else if (displayPrice > 0) {
                    return `from £${displayPrice}`;
                  } else {
                    return "Loading price...";
                  }
                })()}
              </p>
              <div className="flex flex-col gap-4 my-2">
                <p className="text-lg text-gray-600 m-3">
                  {generateDescription(selectedLineup) || "Add a Linuep"}
                </p>
                <div className="flex flex-wrap gap-2 text-lg justify-start ml-3">
                  {actData.lineups?.map((item, index) => {
                    const isSelected = item === selectedLineup;
                    return (
                      <button
                        key={index}
                        onClick={() => handleLineupChange(item)}
                        className={`border py-2 px-4 rounded text-sm transition-colors duration-200 ${
                          isSelected
                            ? "bg-black text-white border-black"
                            : "bg-gray-100 text-gray-700 border-gray-300 hover:bg-[#ff6667] hover:text-white hover:border-[#ff6667]"
                        }`}
                      >
                        {item?.actSize || `Lineup ${index + 1}`}
                      </button>
                    );
                  })}
                </div>
                <div className="my-3 mt-5">
                  <VocalistFeaturedAvailable
                    badge={actData?.availabilityBadge}
                    size={140}
                    cacheBuster={actData?.availabilityBadge?.setAt}
                    className="mt-2"
                  />
                </div>
                <p className="text-gray-600 text-lg ml-3">Including:</p>
                <ul className="list-disc pl-5 text-lg text-gray-600 ml-3">
                  <li>
                    Up to {actData.numberOfSets[0]}x{actData.lengthOfSets[0]}mins or {actData.numberOfSets[1]}x{actData.lengthOfSets[1]}mins live performance
                  </li>
                  <li>
                    {actData?.paSystem && `A ${paMap[actData.paSystem]} PA system `}
                    {actData?.lightingSystem && (
                      <>
                        {actData.paSystem && " and "}a {lightMap[actData.lightingSystem]} lighting system to light up your stage
                        {["mediumLight", "largeLight"].includes(actData.lightingSystem) && " and dancefloor"}
                      </>
                    )}
                  </li>
                  <li>
                    The band on site for up to 7 hours or until midnight, whichever comes first
                  </li>
                  {Object.entries(actData.extras || {})
                    .filter(([_, value]) => typeof value === "object" && value.complimentary === true)
                    .map(([key]) => {
                      const formattedLabel = key.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
                      return <li key={key}>{formattedLabel}</li>;
                    })}
                  {actData.offRepertoireRequests > 0 && (
                    <li>
                      {actData.offRepertoireRequests === 1
                        ? "One additional ‘off-repertoire’ song request (e.g. often the first dance or your favourite song)"
                        : `${actData.offRepertoireRequests} additional ‘off-repertoire’ song requests (e.g. often the first dance or your favourite songs)`}
                    </li>
                  )}
                  {actData?.setlist === "smallTailoring" && (
                    <li>A signature setlist curated by the band — guaranteed crowd-pleasers that they know work every time</li>
                  )}
                  {actData?.setlist === "mediumTailoring" && (
                    <li>A collaborative setlist blending your top picks with our tried-and-tested favourites for the perfect party balance</li>
                  )}
                  {actData?.setlist === "largeTailoring" && (
                    <li>A fully tailored setlist made up almost entirely of your requests — a truly personalised music experience</li>
                  )}
                  {finalTravelPrice && selectedAddress?.trim() && <li>& travel to {selectedAddress}</li>}
                </ul>
              </div>
            </div>
            {/* Bio section */}
            <div className="mt-6">
              <div className="flex">
                <div className="text-2xl mt-6">
                  <Title
                    text1={getPossessiveTitleCase(actData?.tscName)}
                    text2="BIOGRAPHY"
                  />
                </div>
              </div>
              <div className="px-2 py-2 text-gray-600 text-lg sm:text-xl leading-relaxed">
                <div dangerouslySetInnerHTML={{ __html: actData.tscBio }} />
              </div>
            </div>
          </div>
          {/* Right Column: Act Info */}
          <div className="hidden sm:block sm:w-[40%]">
            <div className="text-2xl mt-6" id="lineup-selector">
              <Title
                text1={getPossessiveTitleCase(actData?.tscName)}
                text2="INCLUSIONS"
              />
            </div>
            {/* Star rating with full, half, and empty stars */}
            <div className="flex items-center gap-1 mt-2 pl-3">
              {[1, 2, 3, 4, 5].map((i) => (
                <img
                  key={i}
                  className="w-3.5"
                  src={
                    actData.averageRating >= i
                      ? assets.star_icon
                      : actData.averageRating >= i - 0.5
                        ? assets.star_half_icon
                        : assets.star_dull_icon
                  }
                  alt={`Star ${i}`}
                />
              ))}
              <p className="pl-2">({actData.reviews?.length || 0})</p>
            </div>

            <p className="mt-5 text-3xl font-medium p-3">
              {(() => {
                let basePrice = selectedLineup?.base_fee?.[0]?.total_fee || 0;

                // Log members and essential roles for debug
                selectedLineup?.bandMembers?.forEach((member, i) => {
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

                const additionalEssentialRoles =
                  selectedLineup?.bandMembers?.flatMap((member) =>
                    (member.additionalRoles || []).filter(
                      (r) =>
                        r.isEssential && typeof r.additionalFee === "number"
                    )
                  ) || [];

                const additionalRolesTotal = additionalEssentialRoles.reduce(
                  (sum, role) => sum + role.additionalFee,
                  0
                );

                basePrice += additionalRolesTotal;
                const displayPrice = Math.ceil(basePrice / 0.75);

          

                // ✅ Use finalTravelPrice.total and .travelCalculated
                if (finalTravelPrice) {
                  return finalTravelPrice.travelCalculated
                    ? `£${finalTravelPrice.total}`
                    : `from £${finalTravelPrice.total}`;
                } else if (formattedPrice) {
                  return `from £${formattedPrice}`;
                } else if (basePrice > 0) {
                  return `from £${displayPrice}`;
                } else {
                  return "Loading price...";
                }
              })()}
            </p>

            {/* ✅ Lineup Selection (Now Updates Price Instantly) */}
            <div className="flex flex-col gap-4 my-2">
              <p className="text-lg text-gray-600 m-3">
                {generateDescription(selectedLineup) || "Add a Linuep"}
              </p>
              <div className="flex flex-wrap gap-2 text-lg justify-start ml-3">
                {actData.lineups?.map((item, index) => {
                  const isSelected = item === selectedLineup;

                  return (
                    <button
                      key={index}
                      onClick={() => handleLineupChange(item)}
                      className={`border py-2 px-4 rounded text-sm transition-colors duration-200
          ${
            isSelected
              ? "bg-black text-white border-black"
              : "bg-gray-100 text-gray-700 border-gray-300 hover:bg-[#ff6667] hover:text-white hover:border-[#ff6667]"
          }
        `}
                    >
                      {item?.actSize || `Lineup ${index + 1}`}
                    </button>
                  );
                })}
              </div>
              <div className="my-3 mt-5">
                <VocalistFeaturedAvailable
                  badge={actData?.availabilityBadge}
                  size={140}
                  cacheBuster={actData?.availabilityBadge?.setAt}
                  className="mt-2"
                />
              </div>
              <p className="text-gray-600 text-lg ml-3">Including:</p>
              <ul className="list-disc pl-5 text-lg text-gray-600 ml-3">
                <li>
                  Up to {actData.numberOfSets[0]}x{actData.lengthOfSets[0]}mins
                  or {actData.numberOfSets[1]}x{actData.lengthOfSets[1]}mins
                  live performance
                </li>
                <li>
                  {actData?.paSystem &&
                    `A ${paMap[actData.paSystem]} PA system `}
                  {actData?.lightingSystem && (
                    <>
                      {actData.paSystem && " and "}a{" "}
                      {lightMap[actData.lightingSystem]} lighting system to
                      light up your stage
                      {["mediumLight", "largeLight"].includes(
                        actData.lightingSystem
                      ) && " and dancefloor"}
                    </>
                  )}
                </li>
                <li>
                  The band on site for up to 7 hours or until midnight,
                  whichever comes first
                </li>
                {Object.entries(actData.extras || {})
                  .filter(
                    ([_, value]) =>
                      typeof value === "object" && value.complimentary === true
                  )
                  .map(([key]) => {
                    const formattedLabel = key
                      .replace(/_/g, " ") // Replace underscores with spaces
                      .replace(/^\w/, (c) => c.toUpperCase()); // Capitalize only the first character of the string

                    return <li key={key}>{formattedLabel}</li>;
                  })}
                {actData.offRepertoireRequests > 0 && (
                  <li>
                    {actData.offRepertoireRequests === 1
                      ? "One additional ‘off-repertoire’ song request (e.g. often the first dance or your favourite song)"
                      : `${numberToWords(actData.offRepertoireRequests)} additional ‘off-repertoire’ song requests (e.g. often the first dance or your favourite songs)`}
                  </li>
                )}
                {actData?.setlist === "smallTailoring" && (
                  <li>
                    A signature setlist curated by the band — guaranteed
                    crowd-pleasers that they know work every time
                  </li>
                )}
                {actData?.setlist === "mediumTailoring" && (
                  <li>
                    A collaborative setlist blending your top picks with our
                    tried-and-tested favourites for the perfect party balance
                  </li>
                )}
                {actData?.setlist === "largeTailoring" && (
                  <li>
                    A fully tailored setlist made up almost entirely of your
                    requests — a truly personalised music experience
                  </li>
                )}
                {finalTravelPrice && selectedAddress?.trim() && (
                  <li>& travel to {selectedAddress}</li>
                )}
              </ul>
            </div>

            {/* Buttons */}
            <div className="flex flex-col sm:flex-row my-6 gap-6 ml-3">
              <button
                onClick={handleShortlistToggle}
                aria-pressed={isShortlisted}
                className={`px-8 py-3 text-m rounded transition-colors ${
                  isShortlisted
                    ? "bg-white text-black border border-black hover:bg-[#ff6667] hover:text-white"
                    : "bg-black text-white hover:bg-[#ff6667]"
                }`}
              >
                {isShortlisted ? "REMOVE FROM SHORTLIST" : "ADD TO SHORTLIST"}
              </button>

              <button
  onClick={() => {
    if (!selectedLineup) {
      console.warn("⚠️ No lineup selected before adding to cart");
      return;
    }

    if (isInCart) {
      // remove all lineups for this act
      const lineupIds = Object.keys(cartItems[actData._id] || {});
      lineupIds.forEach((lineupId) =>
        removeFromCart(actData._id, lineupId)
      );

      toast(
        <CustomToast type="success" message="Removed from cart." />,
        { position: "top-right", autoClose: 1600 }
      );
    } else {
      // add selected lineup
      addToCart(
        actData._id,
        selectedLineup._id || selectedLineup.lineupId
      );

      toast(
        <CustomToast type="success" message="Added to cart!" />,
        { position: "top-right", autoClose: 1600 }
      );
    }
  }}
  className="bg-black text-white px-8 py-3 text-m active:bg-gray-700 hover:bg-[#ff6667] transition-colors duration-200 rounded"
  aria-pressed={!!isInCart}
>
  {isInCart ? "REMOVE FROM CART" : "ADD TO CART"}
</button>
            </div>
          </div>
        </div>

        <div className="full">
          <div className="text-2xl mt-12">
            <Title
              text1={getPossessiveTitleCase(actData?.tscName)}
              text2="GALLERY"
            />
          </div>
          <div className="relative px-5 py-3">
            {actData.images?.length > 0 ? (
              <div className="relative">
                <button
                  onClick={() => scrollGallery("left")}
                  className="absolute -left-6 top-1/2 transform -translate-y-1/2 z-10 text-3xl text-gray-800 hover:text-black transition-colors"
                  aria-label="Scroll left"
                  type="button"
                >
                  <img
                    src={assets.scroll_left_icon}
                    alt="Scroll right"
                    className="w-6 h-6 md:w-8 md:h-8"
                  />
                </button>
                <div
                  ref={galleryRef}
                  className="flex gap-4 overflow-x-auto scrollbar-hide scroll-smooth snap-x snap-mandatory"
                  style={{ scrollBehavior: "smooth" }}
                >
                  {actData.images.map((imgObj, index) => (
                    <img
                      key={index}
                      src={imgObj.url}
                      alt={`Gallery image ${index + 1}`}
                      className="w-[600px] h-[400px] object-cover rounded shadow-sm flex-shrink-0 snap-start"
                    />
                  ))}
                </div>
                <button
                  onClick={() => scrollGallery("right")}
                  className="absolute -right-6 top-1/2 transform -translate-y-1/2 z-10 text-3xl text-gray-800 hover:text-black transition-colors"
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
            ) : (
              <p className="text-sm text-gray-400 px-0 py-3">
                No gallery images available.
              </p>
            )}
          </div>
        </div>

        {/* Left Column (60%) */}
        <div className="flex flex-col sm:flex-row gap-12 mt-10">
          <div className="w-full">
            <RepertoireSection
              selectedSongs={actData?.selectedSongs || []}
              actData={actData}
              addToCart={addToCart}
            />
          </div>
        </div>
        {/* Reviews horizontal scroll gallery */}
        <div className="relative mt-12">
          <div className="text-2xl mb-2">
            <Title
              text1={getPossessiveTitleCase(actData?.tscName)}
              text2="REVIEWS"
            />
          </div>

          {/* Reviews scroll area with background */}
          <div className="relative p-6">
            {actData.images?.[1]?.url && (
              <div className="absolute inset-0 z-0">
                <img
                  src={actData.images[1].url}
                  alt="Reviews background"
                  className="w-full h-full object-cover opacity-10"
                />
              </div>
            )}

            {/* Foreground content */}
            <div className="relative z-10">
              {actData.reviews?.length > 0 ? (
                <div className="relative ">
                  <button
                    onClick={() => scrollReviews("left")}
                    className="absolute -left-6 top-1/2 transform -translate-y-1/2 z-10 text-3xl text-gray-600 hover:text-black transition-colors"
                    aria-label="Scroll left"
                    type="button"
                  >
                    <img
                      src={assets.scroll_left_icon}
                      alt="Scroll left"
                      className="w-6 h-6 md:w-8 md:h-8"
                    />
                  </button>
                  <div
                    ref={reviewGalleryRef}
                    className="flex gap-4 overflow-x-auto scrollbar-hide scroll-smooth snap-x snap-mandatory px-4"
                    style={{ scrollBehavior: "smooth" }}
                  >
                    {actData.reviews.map((review, index) => (
                      <div key={index} className="flex-shrink-0 snap-start">
                        <ReviewCard review={review} />
                      </div>
                    ))}
                  </div>
                  <button
                    onClick={() => scrollReviews("right")}
                    className="absolute -right-6 top-1/2 transform -translate-y-1/2 z-10 text-3xl text-gray-600 hover:text-black transition-colors"
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
              ) : (
                <p className="text-sm text-gray-400 px-0 py-3">
                  No reviews available.
                </p>
              )}
            </div>
          </div>
        </div>

        <div className="flex flex-col lg:flex-row gap-10 mt-12 lg:gap-8">
          <div
            className="w-full lg:w-1/2 relative lg:-top-16 lg:pt-16"
            id="ceremony-afternoon-sets"
          >
            <div className="text-2xl mb-2">
              <Title
                text1={getPossessiveTitleCase(actData?.tscName)}
                text2="ACOUSTIC SETS"
              />
            </div>
            <div className="relative overflow-visible">
              {/* Foreground component */}
              <div className="relative z-10">
                {(() => {
                
                  return (
                    <AcousticExtrasSelector
                      actData={actData}
                      lineups={actData.lineups}
                      selectedLineup={selectedLineup}
                      addToCart={addToCart}
                      selectedLineupId={selectedLineup?._id}
                    />
                  );
                })()}
              </div>
            </div>
          </div>
          <div className="w-full lg:w-1/2">
            <div className="text-2xl mb-2">
              <Title
                text1={getPossessiveTitleCase(actData?.tscName)}
                text2="EXTRA SERVICES"
              />
            </div>
            <div className="relative ">
              {/* Extas Right Column (40%) */}
              <div className="flex-1">
                <div className="border rounded px-4 py-6 text-m text-gray-700 w-full my-2 sm:px-6 sm:py-6">
                  {actData.extras &&
                    Object.entries(actData.extras).map(([key, value]) => {
                      // Only render extras that contain a numeric value.price
                      const price =
                        typeof value === "object"
                          ? value.price
                          : parseFloat(value);
                      if (!price || isNaN(price)) return null;

                      const fee = price;
                      // Use the actual selectedLineup size for per-member extras
                      const selectedLineupSize = parseInt(
                        selectedLineup?.actSize ||
                          selectedLineup?.bandMembers?.length ||
                          0
                      );
                      const name = actData.name || "this act";

                      const perMemberKeys = [
                        "extra_30min_performance_per_band_member",
                        "extra_40min_performance_per_band_member",
                        "extra_60min_performance_per_band_member",
                        "israeli_dancing_20mins_per_band_member",
                        "late_stay_60min_per_band_member",
                        "early_arrival_60min_per_band_member",
                        "extra_song_request_per_band_member",
                      ];

                      const rawFinalFee =
                        perMemberKeys.includes(key) && selectedLineupSize
                          ? fee * selectedLineupSize
                          : perMemberKeys.includes(key)
                            ? null
                            : fee;

                      const finalFee =
                        rawFinalFee !== null && !isNaN(rawFinalFee)
                          ? Math.ceil(rawFinalFee * 1.2)
                          : null;

                      if (finalFee === null || isNaN(finalFee)) return null;

                      // Improved normalization: collapse multiple underscores, ignore case, trim, treat underscores/dashes/spaces equally
                      const normalizeKey = (key) => {
                        return key
                          .toLowerCase()
                          .replace(/[\s\-]+/g, "_") // replace spaces and dashes with underscore
                          .replace(/_+/g, "_") // collapse multiple underscores
                          .replace(/[^\w]+/g, "_") // non-word to underscore
                          .replace(/^_+|_+$/g, ""); // trim leading/trailing underscores
                      };

                      const fallbackLabel = key
                        .replace(/[_\-]+/g, " ")
                        .replace(/\bDJ\b/g, "DJ")
                        .replace(/\bPA\b/g, "PA")
                        .replace(/\b(\w)/g, (match) => match.toUpperCase());

                      const labelsMap = {
                        sound_engineering_for_another_act_with_your_acts_pa: `Sound Engineering for another act using ${actData.tscName}'s PA`,
                        speedy_setup: "Speedy 60min Setup & Soundcheck",
                        wired_mic_for_speeches: "Wired Mic for Speeches",
                        wireless_mic_for_speeches: "Wireless Mic for Speeches",
                        background_music_playlist: "Background Music Playlist",
                        up_to_3_hours_manned_playlist:
                          "Up to 3 hours Manned Playlist",
                        up_to_3_hours_band_member_dj:
                          "Up to 3 hours Band Member DJing with Mixing Console/Decks",
                        dj_live_sax_3x30mins:
                          "Add 3x30mins Sax Performance to Band Member DJing",
                        dj_live_bongos_3x30mins:
                          "Add 3x30mins Bongos Performance to Band Member DJing",
                        dj_live_bongos_and_sax_3x30mins:
                          "Add 3x30mins Sax & Bongos Performance to Band Member DJing",
                        extra_30min_performance_per_band_member:
                          "30mins Additional Performance",
                        extra_40min_performance_per_band_member:
                          "40mins Additional Performance",
                        extra_60min_performance_per_band_member:
                          "60mins Additional Performance",
                        israeli_dancing_20mins_per_band_member:
                          "20mins Israeli Performance",
                        late_stay_60min_per_band_member:
                          "60mins Late Stay (post midnight)",
                        early_arrival_60min_per_band_member:
                          "60mins Early Arrival",
                        extra_song_request_per_band_member:
                          "Extra Song Request",
                      };

                      // Immediately after definition of labelsMap, add normalizedLabelsMap
                      const normalizedLabelsMap = Object.fromEntries(
                        Object.entries(labelsMap).map(([key, label]) => [
                          normalizeKey(key),
                          label,
                        ])
                      );

                      // Normalize both map keys and input key for reliable matching
                      const normalizedKey = normalizeKey(key);
                      const label =
                        Object.entries(normalizedLabelsMap).find(([mapKey]) =>
                          normalizeKey(key).startsWith(mapKey)
                        )?.[1] || fallbackLabel;
                      // --- PATCH: grid-based layout for extras row ---
                      return (
                        <div
                          key={key}
                          className="grid grid-cols-[1fr_auto_auto] items-center gap-2 border-b py-1 sm:gap-3"
                        >
                          {/* Label */}
                          <span className="whitespace-normal break-words">{label}</span>
                          {/* Price */}
                          <span className="font-semibold justify-self-end">
                            £{finalFee}
                          </span>

                          {/* Cart icon */}
                          <img
                            src={assets.add_to_cart_icon}
                            alt="Add to cart"
                            className="w-4 h-4 cursor-pointer justify-self-end"
                            onClick={() => {
                              if (!selectedLineup || !actData?._id) return;
                              const lineupId =
                                selectedLineup._id || selectedLineup.lineupId;
                              const extra = {
                                name: label,
                                price: finalFee,
                                key,
                              };
                             
                              addToCart(actData._id, lineupId, extra);
                              toast(
                                <CustomToast
                                  type="success"
                                  message={`Added ${label} to cart`}
                                />,
                                {
                                  position: "top-right",
                                  autoClose: 2000,
                                }
                              );
                            }}
                          />
                        </div>
                      );
                    })}

                  {!actData.extras && (
                    <p className="text-gray-400">No extras available.</p>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
        <div className="w-full sm:w-full mt-10">
          <div className="text-2xl mb-2">
            <Title
              text1={getPossessiveTitleCase(actData?.tscName)}
              text2="TECHNICAL SPECS"
            />
          </div>
          <div className="relative ">
            <ActPerformanceOverview actData={actData} />
          </div>
        </div>

        <RelatedActs
          genres={actData.genre || []}
          instruments={actData.instruments || []}
          vocalist={actData.vocalist || ""}
          currentActId={actData._id}
        />
      </div>
    </div>
  );
};

export default Act;
