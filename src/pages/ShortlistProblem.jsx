import React, { useContext, useEffect, useState } from "react";
import { ShopContext } from "../context/ShopContext";
import Title from "../components/Title";
import ShortlistItem from "./ShortlistItem";
import ActHero from "../components/ActHero";
import { getPossessiveTitleCase } from "./utils/getPossessiveTitleCase"; // adjust path as needed
import { assets } from "../assets/assets";
import { toast } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";
import CustomToast from "../components/CustomToast";
import axios from 'axios';



const ShortlistProblem = () => {

  const {
    actId,
    actData,
    id,
    acts,
    act,
    userId,
    setActData,
    shortlistItems,
    shortlistAct,
    selectedDate,
    selectedAddress,
    setShowSearch,
    removeFromCart,
    addToCart,
    setActs,
    setSelectedDate,
    setSelectedAddress,
    setShortlistedActs,
   isShortlisted
  } = useContext(ShopContext);


      const backendUrl = import.meta.env.VITE_BACKEND_URL;

    console.log("💡 Shortlist.jsx props received: actId =", actId);
  
  const [isLoading, setIsLoading] = useState(true);
  
  const [hoveredAct, setHoveredAct] = useState(null);
  const [shortlistData, setShortlistData] = useState([]);
  const [sortType, setSortType] = useState('relavent');
  const [selectedCounty, setSelectedCounty] = useState(sessionStorage.getItem("selectedCounty")?.trim().toLowerCase() || "");  
  const storedPlace = sessionStorage.getItem("selectedPlace") || "";
  const [video, setVideo] = useState("");
  const [selectedLineup, setSelectedLineup] = useState("");
  const [selectedVideoMap, setSelectedVideoMap] = useState({});
  const [videoManuallySelectedMap, setVideoManuallySelectedMap] = useState({});
const [localActs, setLocalActs] = useState([]);
console.log("🔍 Shortlist component initialized with acts:", localActs, shortlistData);


// Set selectedVideo after tscVideos is loaded
useEffect(() => {
  const initialVideoMap = {};
  const initialManualMap = {};

  shortlistData.forEach((item) => {
    id
    if (act?.tscVideos?.[0]?.url) {
      initialVideoMap[item._id] = act.tscVideos[0].url;
      initialManualMap[item._id] = false;
    }
  });

  setSelectedVideoMap(initialVideoMap);
  setVideoManuallySelectedMap(initialManualMap);
}, [acts, shortlistData]);




  useEffect(() => {
  if (!hoveredAct?.actId || acts.length === 0) return;

  const foundAct = acts.find((item) => item._id === hoveredAct.actId);
  if (!foundAct || actData?._id === foundAct._id) return; // prevent infinite loop

  const avgRating = calculateAverageRating(foundAct.reviews);
  
  setActData({
    ...foundAct,
    averageRating: avgRating,
  });

  setVideo(foundAct.videos?.[0]?.url || "");
  if (foundAct.lineups.length > 0) {
    setSelectedLineup(foundAct.lineups[0]);
  }
}, [hoveredAct, acts]);

useEffect(() => {
  if (!hoveredAct?.actId || acts.length === 0) return;

  const foundAct = acts.find((item) => item._id === hoveredAct.actId);
  if (!foundAct || actData?.id === foundAct.id) return; // prevent infinite loop

  const avgRating = calculateAverageRating(foundAct.reviews);
  setActData({
    ...foundAct,
    averageRating: avgRating,
  });

  setVideo(foundAct.videos?.[0]?.url || "");
  if (foundAct.lineups.length > 0) {
    setSelectedLineup(foundAct.lineups[0]);
  }
}, [hoveredAct, acts]);
  
    useEffect(() => {
      console.log("🧾 shortlistItems updated:", shortlistItems);
    }, [shortlistItems]);
  
 if (id) {
  const match = shortlistItems.includes(id);
  setIsShortlisted(match);
}



const calculateActPricing = async (
  act,
  selectedCounty,
  selectedAddress,
  selectedDate,
  selectedLineup
) => {
  console.log(`🧪 act.costPerMile: ${act.costPerMile}, useCountyTravelFee: ${act.useCountyTravelFee}`);
  console.log(`🗺️ act.countyFees:`, act.countyFees);
  console.log("🧠 calculateActPricing called with:");
  console.log("🆔 Act:", act.tscName || act.name);
  console.log("🛣 County:", selectedCounty);
  console.log("📮 Address:", selectedAddress);
  console.log("📆 Date:", selectedDate);
  console.log("👥 Lineup:", selectedLineup);

  // ✅ Always call your backend (Render/Netlify) not the site origin
  const BASE = (import.meta.env.VITE_BACKEND_URL || "https://tsc-backend-v2.onrender.com").replace(/\/+$/, "");

  // Helper: fetch travel JSON (new + legacy shapes)
  const fetchTravel = async (origin, destination, dateISO) => {
    const url = `${BASE}/api/v2/travel-core` +
      `?origin=${encodeURIComponent(origin)}` +
      `&destination=${encodeURIComponent(destination)}` +
      `&date=${encodeURIComponent(dateISO)}`;

    const res = await fetch(url, { headers: { accept: "application/json" } });
    const text = await res.text();
    let data = {};
    try { data = text ? JSON.parse(text) : {}; } catch {}
    if (!res.ok) throw new Error(`travel http ${res.status}`);

    // Normalize: prefer new shape, fallback to legacy rows/elements
    const firstEl = data?.rows?.[0]?.elements?.[0];
    const outbound = data?.outbound || (
      firstEl?.distance && firstEl?.duration
        ? { distance: firstEl.distance, duration: firstEl.duration, fare: firstEl.fare }
        : undefined
    );
    const returnTrip = data?.returnTrip;

    return { outbound, returnTrip, raw: data };
  };

  let travelFee = 0;

  // ---- lineup pick (smallest or provided) ----
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
    console.warn(`⚠️ No valid lineup found for ${act?.name}`);
    return null;
  }

  // ---- northern team swap ----
  const northernCounties = new Set([
    "ceredigion","cheshire","cleveland","conway","cumbria","denbighshire","derbyshire","durham",
    "flintshire","greater manchester","gwynedd","herefordshire","lancashire","leicestershire",
    "lincolnshire","merseyside","north humberside","north yorkshire","northumberland",
    "nottinghamshire","rutland","shropshire","south humberside","south yorkshire",
    "staffordshire","tyne and wear","warwickshire","west midlands","west yorkshire",
    "worcestershire","wrexham","rhondda cynon taf","torfaen","neath port talbot","bridgend",
    "blaenau gwent","caerphilly","cardiff","merthyr tydfil","newport","aberdeen city",
    "aberdeenshire","angus","argyll and bute","clackmannanshire","dumfries and galloway",
    "dundee city","east ayrshire","east dunbartonshire","east lothian","east renfrewshire",
    "edinburgh","falkirk","fife","glasgow","highland","inverclyde","midlothian","moray",
    "na h eileanan siar","north ayrshire","north lanarkshire","orkney islands","perth and kinross",
    "renfrewshire","scottish borders","shetland islands","south ayrshire","south lanarkshire",
    "stirling","west dunbartonshire","west lothian"
  ]);
  const isNorthernGig = northernCounties.has(String(selectedCounty || "").toLowerCase().trim());

  const bandMembers = act.useDifferentTeamForNorthernGigs && isNorthernGig
    ? (act.northernTeam || [])
    : (smallestLineup.bandMembers || []);

  // ---- essential fees (net) ----
  console.log(`🎵 Calculating for ${act.name}`);
  const essentialFees = smallestLineup.bandMembers.flatMap((member) => {
    const baseFee = member.isEssential ? Number(member.fee) || 0 : 0;
    const additionalEssentialFees = (member.additionalRoles || [])
      .filter((role) => role.isEssential)
      .map((role) => Number(role.additionalFee) || 0);
    return [baseFee, ...additionalEssentialFees];
  });
  const fee = essentialFees.reduce((sum, f) => sum + f, 0);

  // ---- travel calc ----
  const memberPostcodes = bandMembers.map(m => m.postCode).filter(Boolean);
  console.log("📍 Member Postcodes:", memberPostcodes);

  if (act.useCountyTravelFee && act.countyFees) {
    const countyKey = String(selectedCounty || "").toLowerCase();
    const feePerMember = Number(act.countyFees[countyKey]) || 0;
    travelFee = feePerMember * memberPostcodes.length;
  } else if (Number(act.costPerMile) > 0) {
    // cost-per-mile → need outbound only
    for (const postCode of memberPostcodes) {
      const destination = typeof selectedAddress === "string"
        ? selectedAddress
        : (selectedAddress?.postcode || selectedAddress?.address || "");
      if (!destination) {
        console.warn(`⚠️ No destination address found for cost-per-mile calc`);
        continue;
      }
      try {
        const { outbound, raw } = await fetchTravel(postCode, destination, selectedDate);
        const meters =
          outbound?.distance?.value ??
          raw?.rows?.[0]?.elements?.[0]?.distance?.value ??
          0;
        const miles = meters / 1609.34;
        travelFee += (miles || 0) * Number(act.costPerMile) * 25; // your round-trip multiplier
      } catch (e) {
        console.warn("⚠️ travel fetch failed:", e?.message || e);
      }
    }
  } else {
    // MU-rate path → requires outbound & return
    for (const member of smallestLineup.bandMembers) {
      const postCode = member.postCode;
      if (!postCode) continue;

      const destination = typeof selectedAddress === "string"
        ? selectedAddress
        : (selectedAddress?.postcode || selectedAddress?.address || "");
      if (!destination) {
        console.warn(`⚠️ No destination address found for MU-rate calc`);
        continue;
      }

      try {
        const { outbound, returnTrip } = await fetchTravel(postCode, destination, selectedDate);
        if (!outbound || !returnTrip) {
          console.warn("⚠️ missing outbound/returnTrip for MU-rate calc");
          continue;
        }

        const outboundDistance  = outbound?.distance?.value;
        const returnDistance    = returnTrip?.distance?.value;
        const outboundDuration  = outbound?.duration?.value;
        const returnDuration    = returnTrip?.duration?.value;

        if (
          typeof outboundDistance !== "number" ||
          typeof returnDistance !== "number" ||
          typeof outboundDuration !== "number" ||
          typeof returnDuration !== "number"
        ) {
          console.warn("⚠️ Invalid MU-rate numbers");
          continue;
        }

        const totalDistanceMiles = (outboundDistance + returnDistance) / 1609.34;
        const totalDurationHours = (outboundDuration + returnDuration) / 3600;

        const fuelFee = totalDistanceMiles * 0.56;
        const timeFee = totalDurationHours * 13.23;
        const lateFee = (returnDuration / 3600) > 1 ? 136 : 0;
        const tollFee = (outbound.fare?.value || 0) + (returnTrip.fare?.value || 0);

        travelFee += fuelFee + timeFee + lateFee + tollFee;
      } catch (e) {
        console.warn("⚠️ travel fetch failed (MU-rate):", e?.message || e);
      }
    }
  }

  // ---- gross with 25% margin ----
  const totalPrice = Math.ceil((fee + travelFee) / 0.75);
  console.log(`🧾 PRICING BREAKDOWN for ${act.name}`);
  console.log(`• Essential Fee Total: £${fee.toFixed(2)}`);
  console.log(`• Travel Fee Total: £${travelFee.toFixed(2)}`);
  console.log(`• Margin (25%): £${((fee + travelFee) * 0.25).toFixed(2)}`);
  console.log(`• Final Price: £${totalPrice}`);

  return `${totalPrice}`;
};

useEffect(() => {
  const fetchShortlist = async () => {
    // 🌐 Log fetching shortlist for userId
    console.log("🌐 Fetching shortlist for userId:", userId);
    if (userId) {
      try {
        const res = await axios.get(`${backendUrl}/api/shortlist/user/${userId}/shortlisted`);
        const actIds = res.data.acts.map(act => act._id);
        setShortlistedActs(actIds);
        console.log("📥 Fetched shortlist from server:", actIds);
      } catch (err) {
        console.error("Failed to fetch shortlist", err);
      }
    }
  };

  fetchShortlist();
}, [userId]);

  const formatDate = (dateString) => {
  if (!dateString) return ""; 

  const date = new Date(dateString);
  const day = date.getDate();
  const month = date.toLocaleString("en-GB", { month: "long" });
  const year = date.getFullYear();

  // Convert day to "1st", "2nd", "3rd", etc.
  const suffix = ["th", "st", "nd", "rd"][(day % 10 > 3) ? 0 : (day % 100 - day % 10 !== 10) * (day % 10)];

  return `${day}${suffix} of ${month} ${year}`;
};

useEffect(() => {
  const init = async () => {
    setIsLoading(true);
    const storedDate = sessionStorage.getItem("selectedDate");
    const storedAddress = sessionStorage.getItem("selectedAddress");
    const storedCounty = sessionStorage.getItem("selectedCounty");

    if (storedCounty) setSelectedCounty(storedCounty);
    if (storedDate) setSelectedDate(storedDate);
    if (storedAddress) setSelectedAddress(storedAddress);

    setIsLoading(false);
  };

  init();
}, []);

    

const getShortlistCountForAct = (actId) => {
  if (!shortlistItems[actId]) return 0;

  return Object.values(shortlistItems[actId]).reduce((sum, count) => sum + count, 0);
};

  const extractYouTubeId = (url) => {
    const match = url?.match(/(?:v=|\/)([0-9A-Za-z_-]{11})/);
    return match ? match[1] : '';
  };

useEffect(() => {
  // 📦 Mapping shortlistItems to shortlistData
  console.log("📦 Mapping shortlistItems to shortlistData:", shortlistItems);
  const list = shortlistItems.map((id) => ({
    _id: id,
    selectedLineup: undefined,
    
  }
)
);

  setShortlistData(list);
  console.log("📋 shortlistData set:", list);
}, [shortlistItems]);

const triggerSearch = () => {
  setShowSearch(true);  // ✅ Open the search box
};

useEffect(() => {
  console.log('🧠 Hovered Act:', hoveredAct?.tscName);
}, [hoveredAct]);

const generateDescription = (lineup) => {
  if (!lineup || !Array.isArray(lineup.bandMembers)) return "Add a Lineup";

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
      .map((r) => r.role || "Unnamed Service")
  );

  if (count === 0) return "Add a Lineup";

  const instrumentsStr = formatWithAnd(instruments);
  const rolesStr = roles.length
    ? ` (including ${formatWithAnd(roles)} services)`
    : "";

  return `${count}: ${instrumentsStr}${rolesStr}`;
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

  // Calculate average rating from reviews, rounded to nearest 0.5
const calculateAverageRating = (reviews) => {
  console.log("🌟 actData.averageRating:", hoveredAct?.actData.averageRating);
  if (!reviews || reviews.length === 0) return 0;
  const sum = reviews.reduce(
    (total, review) => total + (review.rating || 0),
    0
  );
  return Math.round((sum / reviews.length) * 2) / 2; // round to nearest 0.5
  
};

useEffect(() => {
  if (!actId || acts.length === 0) return;

  console.log("🔍 Looking for actId:", actId);
  const foundAct = acts.find((item) => item.id === actId);
  console.log("✅ Found act:", foundAct);

  if (!foundAct) {
    console.warn("⚠️ No act found for actId:", actId);
    return;
  }

  const avgRating = calculateAverageRating(foundAct.reviews);
  console.log("⭐ Average Rating Calculated:", avgRating);

  setActData({
    ...foundAct,
    averageRating: avgRating,
  });

  setVideo(foundAct.videos?.[0]?.url || "");

  if (foundAct.lineups.length > 0) {
    setSelectedLineup(foundAct.lineups[0]);
  }
}, [actId, acts]);

  useEffect(() => {
if (Array.isArray(acts) && acts.length > 0 && hoveredAct?.actId) {    console.log("🔍 Looking for actId:", hoveredAct.actId);

    const foundAct = acts.find((item) => item.id === hoveredAct.actId);
    console.log("✅ Found act:", foundAct);

    if (foundAct) {
      console.log("📝 foundAct.reviews:", foundAct.reviews);
      const avgRating = calculateAverageRating(foundAct.reviews);
      console.log("⭐ Average Rating Calculated:", avgRating);

      setActData({
        ...foundAct,
        averageRating: avgRating,
      });

      setVideo(foundAct.videos?.[0]?.url || "");

      if (foundAct.lineups.length > 0) {
        setSelectedLineup(foundAct.lineups[0]); // Set first lineup as default
      }
    }
  }
}, [hoveredAct, acts]);


useEffect(() => {
  // Only update prices for shortlisted acts
  const updatePrices = async () => {
    // 💰 Updating prices with shortlistData
    console.log("💰 Updating prices with shortlistData:", shortlistData);
    // 🎭 Acts array at price update
    console.log("🎭 Acts array at price update:", acts);
    if (
      !Array.isArray(acts) ||
      !Array.isArray(shortlistData) ||
      shortlistData.length === 0 ||
      acts.length === localActs.length
    ) {
      setLocalActs([]);
      return;
    }

    const updatedActs = await Promise.all(
      shortlistData.map(async (item) => {
        const act = acts.find((a) => a?.id?.toString() === item.id?.toString());
        if (!act) return null;
        const price = await calculateActPricing(
          act,
          selectedCounty,
          selectedAddress,
          selectedDate,
          act.lineups?.[0]
        );
        return {
          ...act,
          formattedPrice: price,
        };
      })
    );

    setLocalActs(updatedActs.filter(Boolean));
  };
  updatePrices();
}, [acts, shortlistData, selectedCounty, selectedAddress, selectedDate]);


  // 🎬 Rendering Shortlist with localActs and shortlistData
  console.log("🎬 Rendering Shortlist with localActs:", localActs, "and shortlistData:", shortlistData);

 if (isLoading || acts.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-96">
        <svg
          className="animate-spin h-10 w-10 text-gray-500 mb-4"
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
        >
          <circle
            className="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="4"
          ></circle>
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8v8H4z"
          ></path>
        </svg>
        <p className="text-gray-700">Fetching your shortlist...</p>
      </div>
    );
  }

  console.log("🧾 shortlistItems:", shortlistItems);
console.log("📦 shortlistData:", shortlistData);

  return (
    <div>
       <div className='flex-1'>

            <div className='flex justify-left text-base justify-between sm:text-2xl mb-4 mt-10 pt-10'>
              <Title text1={'YOUR'} text2={'SHORTLIST'} />
            

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
                      {formatDate(selectedDate)} at {storedPlace && `${storedPlace}, `}{selectedAddress}    </span>
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
</div>

      {/* ✅ Shortlist Items */}
<div className="flex flex-row gap-6 pt-10">
          {/* Left column: shortlist cards */}
<div className="w-[60%] h-screen pr-2 flex flex-wrap gap-x-6 gap-y-8 items-start">
{shortlistData.length === 0 ? (
  <p className="text-gray-500 text-center mt-10">
    Your shortlist is empty. Start adding your favorite acts!
  </p>
) : (
  shortlistData.map((item, index) => {
    const actData = localActs.find((act) => act._id === item._id);
    if (!actData) return null;
    return (
      <ShortlistItem
        key={index}
        id={item._id}
        acts={localActs}
        images={actData.images}
        tscName={actData.tscName}
        formattedPrice={actData.formattedPrice}
        shortlistCount={item.timesShortlisted || 0}
        profileImage={actData.profileImage}
        onShortlistToggle={() => shortlistAct(userId, item._id)}
        onMouseEnter={() => {
          console.log("🎯 Hovered:", actData?.tscName);
          setHoveredAct({ actId: actData._id, actData });
          setSelectedLineup(actData.lineups?.[0] || null);
        }}
        className="flex-1 min-w-[280px] max-w-[320px]"
        selectedCounty={selectedCounty}
        selectedAddress={selectedAddress}
        selectedDate={selectedDate}
      />
    );
  })
)}
        </div>
        

        {/* Right column: preview panel */}
<div
  className={`w-[40%] p-4 border-l min-h-screen transition-all duration-300 ease-in-out ${
    hoveredAct ? 'opacity-100 translate-x-0 pointer-events-auto' : 'opacity-100 translate-x-0 pointer-events-auto'
  }`}
>      {hoveredAct ? (
  <div>
<div className="w-full">
<ActHero hideHeart={true} actId={hoveredAct?.actId} acts={acts} /></div>
  
             {/* Act Info */}
          <div className="w-full">
           
            {/* Star rating with full, half, and empty stars */}
   {actData && (
  <div className="flex justify-end">
    <div className="flex items-center gap-1 mt-2 pl-3">
      {[1, 2, 3, 4, 5].map((i) => (
        <img
          key={i}
          className="w-4"
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
      <p className="pl-2 text-sm">({actData.reviews?.length || 0})</p>
    </div>
  </div>
)}
<p className="mt-5 text-3xl font-medium p-3">
  {(() => {
    if (actData?.formattedPrice) {
      return `from £${actData.formattedPrice}`;
    }

    let basePrice = selectedLineup?.base_fee?.[0]?.total_fee || 0;
    const additionalEssentialRoles =
      selectedLineup?.bandMembers?.flatMap((member) =>
        (member.additionalRoles || []).filter(
          (r) => r.isEssential && typeof r.additionalFee === "number"
        )
      ) || [];

    const additionalRolesTotal = additionalEssentialRoles.reduce(
      (sum, role) => sum + role.additionalFee,
      0
    );

    basePrice += additionalRolesTotal;
    const displayPrice = Math.ceil(basePrice / 0.75);

    return basePrice > 0 ? `from £${displayPrice}` : "Loading price...";
  })()}
</p>

            {/* ✅ Lineup Selection (Now Updates Price Instantly) */}
            <div className="flex flex-col gap-4 my-2">
              <p className="text-lg text-gray-600 m-3">
                {generateDescription(selectedLineup) || "Add a Linuep"}
              </p>
          {hoveredAct?.actData?.lineups && (
  <div className="flex flex-wrap gap-2 text-lg justify-start ml-3">
    {hoveredAct.actData.lineups.map((item, index) => {
      const isSelected = item === selectedLineup;

      const handleLineupChange = (lineup) => {
        console.log("🎭 Lineup Button Clicked:", lineup);
        hoveredAct.setSelectedLineup(lineup);

        if (hoveredAct.actData) {
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
          hoveredAct.setFormattedPrice(displayPrice);
        }
      };

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
)}
              <p className="text-gray-600 text-lg ml-3">Including:</p>
              <ul className="list-disc pl-5 text-lg text-gray-600 ml-3">
          {hoveredAct?.actData?.numberOfSets?.length > 1 &&
 hoveredAct?.actData?.lengthOfSets?.length > 1 && (
  <li>
    Up to {hoveredAct.actData.numberOfSets[0]}x{hoveredAct.actData.lengthOfSets[0]}mins
    or {hoveredAct.actData.numberOfSets[1]}x{hoveredAct.actData.lengthOfSets[1]}mins
    live performance
  </li>
)}
                <li>
             {hoveredAct.actData?.paSystem &&
  `A ${hoveredAct?.paMap?.[hoveredAct.actData.paSystem]} PA system `}

{hoveredAct.actData?.lightingSystem && (
  <>
    {hoveredAct.actData.paSystem && " and "}a{" "}
    {hoveredAct?.lightMap?.[hoveredAct.actData.lightingSystem]} lighting system to light up your stage
    {["mediumLight", "largeLight"].includes(
      hoveredAct.actData.lightingSystem
    ) && " and dancefloor"}
  </>
)}
                </li>
                <li>
                  The band on site for up to 7 hours or until midnight,
                  whichever comes first
                </li>
  {hoveredAct?.actData?.extras &&
  Object.entries(hoveredAct.actData.extras)
    .filter(
      ([_, value]) =>
        typeof value === "object" && value.complimentary === true
    )
    .map(([key]) => {
      const formattedLabel = key
        .replace(/_/g, " ")
        .replace(/^\w/, (c) => c.toUpperCase());

      return <li key={key}>{formattedLabel}</li>;
    })}
              {hoveredAct?.actData?.offRepertoireRequests > 0 && (
  <li>
    {hoveredAct.actData.offRepertoireRequests === 1
      ? "One additional ‘off-repertoire’ song request (e.g. often the first dance or your favourite song)"
      : `${numberToWords(hoveredAct.actData.offRepertoireRequests)} additional ‘off-repertoire’ song requests (e.g. often the first dance or your favourite songs)`}
  </li>
)}
                {hoveredAct.actData?.setlist === "smallTailoring" && (
                  <li>
                    A signature setlist curated by the band — guaranteed
                    crowd-pleasers that they know work every time
                  </li>
                )}
                {hoveredAct.actData?.setlist === "mediumTailoring" && (
                  <li>
                    A collaborative setlist blending your top picks with our
                    tried-and-tested favourites for the perfect party balance
                  </li>
                )}
                {hoveredAct.actData?.setlist === "largeTailoring" && (
                  <li>
                    A fully tailored setlist made up almost entirely of your
                    requests — a truly personalised music experience
                  </li>
                )}
                {selectedAddress !== "" ? (
                  <li>
                    {hoveredAct.finalTravelPrice && selectedAddress && (
                      <p>& travel to {selectedAddress}</p>
                    )}
                  </li>
                ) : null}{" "}
              </ul>
            </div>

            {/* Buttons */}
            <div className="flex flex-col sm:flex-row my-6 gap-6 ml-3">
          

              <button
                onClick={() => {
                  if (!selectedLineup) {
                    console.warn("⚠️ No lineup selected before adding to cart");
                    return;
                  }

                  if (hoveredAct.isInCart) {
                    console.log("♻️ Updating lineup for act:", hoveredAct.actData.name);

                    // Remove all lineups for this act from the cart
                    console.log(
                      "🧹 Removing all lineups for act:",
                      hoveredAct.actData._id
                    );
                    const lineupIds = Object.keys(hoveredAct.cartItems[hoveredAct.actData._id] || {});
                    console.log("🗑️ Lineups to remove:", lineupIds);
                    lineupIds.forEach((lineupId) => {
                      removeFromCart(hoveredAct.actData._id, lineupId);
                    });

                    toast(
                      <CustomToast
                        type="success"
                        message="Lineup updated in cart!"
                      />,
                      {
                        position: "top-right",
                        autoClose: 2000,
                      }
                    );
                  } else {
                    console.log("🛒 Adding new act to cart:", hoveredAct.actData.name);
                    toast(
                      <CustomToast
                        type="success"
                        message="Act added to cart!"
                      />,
                      {
                        position: "top-right",
                        autoClose: 2000,
                      }
                    );
                  }

                  // Add selected lineup to the cart after removals (avoid race condition)
                  setTimeout(() => {
                    addToCart(
                      hoveredAct.actData._id,
                      selectedLineup._id || selectedLineup.lineupId
                    );
                    console.log(
                      "🛒 Final addToCart call for:",
                      hoveredAct.actData._id,
                      selectedLineup._id || selectedLineup.lineupId
                    );
                  }, 0);
                }}
                className="bg-black text-white px-8 py-3 text-m active:bg-gray-700 hover:bg-[#ff6667] transition-colors duration-200 rounded"
              >
                {hoveredAct.isInCart ? "UPDATE LINEUP" : "ADD TO CART"}
              </button>
            </div>
          </div>

    <p className="mt-2 text-sm text-gray-700 leading-snug">
      {hoveredAct.tscBio?.slice(0, 300)}...
    </p>
  </div>
) : (
  <p className="text-gray-500 text-center mt-20">
    Hover over a shortlist item to preview details
  </p>
)}
        </div>
      </div>
    </div>
  );
};

export default ShortlistProblem;
