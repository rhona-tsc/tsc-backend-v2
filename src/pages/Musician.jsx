import React, { useContext, useState, useEffect, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ShopContext } from "../context/ShopContext";
import { assets } from "../assets/assets";
import calculateActPricing from "./utils/pricing";
import "react-toastify/dist/ReactToastify.css";

import Title from "../components/Title";
import { getPossessiveTitleCase } from "./utils/getPossessiveTitleCase"; // adjust path as needed
import axios from "axios";
import { useLocation } from "react-router-dom";
import MusicianHero from "../components/MusicianHero";
import MusicianRepertoireSection from "../components/MusicianRepertoireSection";
import RelatedMusicians from "../components/RelatedMusicians";
import MusicianEquipment from "../components/MusicianEquipment";

// Calculate average rating from reviews, rounded to nearest 0.5
const calculateAverageRating = (reviews) => {
  if (!reviews || reviews.length === 0) return 0;
  const sum = reviews.reduce(
    (total, review) => total + (review.rating || 0),
    0
  );
  return Math.round((sum / reviews.length) * 2) / 2; // round to nearest 0.5
};

const Musician = () => {
  const backendUrl = import.meta.env.VITE_BACKEND_URL;
  const location = useLocation();

  // Extract YouTube video ID from a full URL or return as-is if already an ID
  const extractVideoId = (url) => {
    if (!url) return "";
    const match = url.match(/(?:v=|\/)([0-9A-Za-z_-]{11})/);
    return match ? match[1] : url;
  };
  const { musicianId } = useParams();
  const {
    acts,
    addToCart,
    addToShortlist,
    selectedDate,
    selectedAddress,
    setShowSearch,
  } = useContext(ShopContext);
  const { cartItems, removeFromCart } = useContext(ShopContext); // 👈 Import removeFromCart and cartItems
  const [selectedCounty, setSelectedCounty] = useState(
    sessionStorage.getItem("selectedCounty") || ""
  );

  // Fetch musician/deputy profile for this page
  useEffect(() => {
    let abort = false;
    const run = async () => {
      try {
        const base = (import.meta.env.VITE_BACKEND_URL || "").replace(
          /\/$/,
          ""
        );
        // Try common endpoints – your router mixes act/musician routes
        const attempts = [
          `${base}/api/musician/get/${musicianId}`, // in your musicianRouter (returns { success, act } OR a musician in some setups)
          `${base}/api/musician/profile/${musicianId}`, // you’ve used this before (screenshot)
          `${base}/api/musician/${musicianId}`, // simple fallback
        ];
        let payload = null;
        for (const url of attempts) {
          try {
            const r = await fetch(url);
            if (r.ok) {
              payload = await r.json();
              break;
            }
          } catch {}
        }
        if (!abort && payload) {
          // be tolerant to different shapes coming back
          const m =
            payload.deputy ||
            payload.musician ||
            payload.act ||
            payload.data ||
            payload;
          if (m) {
            setActData(m);
            console.log("📝 Bio fields:", {
              tscApprovedBio: m?.tscApprovedBio,
              bio: m?.bio            });

            // pick a default video from approved links if present
            const vids = [
              ...(Array.isArray(m?.tscApprovedFunctionBandVideoLinks)
                ? m.tscApprovedFunctionBandVideoLinks
                : []),
              ...(Array.isArray(m?.tscApprovedOriginalBandVideoLinks)
                ? m.tscApprovedOriginalBandVideoLinks
                : []),
            ].filter((v) => v && v.url);
            if (vids.length) setVideo(vids[0].url);
          }
        }
      } catch (err) {
        if (!abort) console.error("Failed to load musician profile", err);
      }
    };
    if (musicianId) run();
    return () => {
      abort = true;
    };
  }, [musicianId]);

  useEffect(() => {
    if (location.hash) {
      const target = document.querySelector(location.hash);
      if (target) {
        setTimeout(() => {
          target.scrollIntoView({ behavior: "smooth", block: "start" });
        }, 100); // short delay so content is rendered first
      }
    }
  }, [location]);
  // Deep debug logging after useContext calls
  console.log("🧠 RENDERING Act.jsx");
  console.log("🛒 ShopContext values:", {
    acts,
    selectedDate,
    selectedAddress,
    selectedCounty,
    cartItems,
    addToCart,
    addToShortlist,
  });
  const [actData, setActData] = useState(null);

  const [isYesForSelectedDate, setIsYesForSelectedDate] = useState(null);

  const [selectedLineup, setSelectedLineup] = useState("");
  const [video, setVideo] = useState("");
  const navigate = useNavigate();

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

  // verify latest reply on this act+date
  useEffect(() => {
    let abort = false;
    (async () => {
      try {
        if (!actData?._id || !selectedDate) {
          setIsYesForSelectedDate(null);
          return;
        }

        const dateISO = new Date(selectedDate).toISOString().slice(0, 10);

        // Always hit the backend directly (no relative Netlify paths)
        const base = (import.meta.env.VITE_BACKEND_URL || "").replace(/\/+$/, "");
        const url = new URL(`${base}/api/v2/availability/acts-by-dateV2`);
        url.searchParams.set("date", dateISO);
        url.searchParams.set("musicianId", String(actData._id));

        const resp = await fetch(url.toString(), { headers: { accept: "application/json" } });
        const text = await resp.text();

        let data = {};
        try { data = text ? JSON.parse(text) : {}; } catch { data = {}; }

        if (!abort) {
          // Accept a few possible shapes
          const latest = data?.latestReply ?? data?.reply ?? data?.status ?? "";
          setIsYesForSelectedDate(String(latest).toLowerCase() === "yes");
        }
      } catch {
        if (!abort) setIsYesForSelectedDate(null);
      }
    })();

    return () => { abort = true; };
  }, [actData?._id, selectedDate]);

  useEffect(() => {
    const fetchShortlist = async (userId) => {
      try {
        const res = await axios.get(
          `/api/shortlist/user/${userId}/shortlisted`
        );
        const musicianIds = res.data.acts.map((act) => act._id);
        setShortlistedActs(musicianIds);
      } catch (err) {
        console.error("Failed to fetch shortlist", err);
      }
    };

    fetchShortlist();
  }, []);

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
  // if we already loaded the musician via the fetch above, don't overwrite it
  if (actData) return;

  if (!Array.isArray(acts) || acts.length === 0) return;

  console.log("🔍 Looking for musicianId:", musicianId);
  const foundAct = acts.find((item) => String(item?._id) === String(musicianId));

  if (!foundAct) {
    console.warn("⚠️ No matching act/musician in ShopContext. Skipping.");
    return;
  }

  const reviews = Array.isArray(foundAct.reviews) ? foundAct.reviews : [];
  console.log("📝 foundAct.reviews:", reviews);

  const avgRating = calculateAverageRating(reviews);
  console.log("⭐ Average Rating Calculated:", avgRating);

  setActData({
    ...foundAct,
    averageRating: avgRating,
  });
  console.log("📝 Bio fields (ShopContext):", {
    tscApprovedBio: foundAct?.tscApprovedBio,
    bio: foundAct?.bio,
  });

  setVideo(
    (Array.isArray(foundAct.videos) && foundAct.videos[0]?.url) ? foundAct.videos[0].url : ""
  );

  if (Array.isArray(foundAct.lineups) && foundAct.lineups.length > 0) {
    setSelectedLineup(foundAct.lineups[0]);
  }
}, [musicianId, acts, actData]);
  useEffect(() => {
    const fetchPrice = async () => {
      if (!actData || !selectedLineup || !selectedDate || !selectedAddress) {
        console.warn(
          "⚠️ Skipping travel price calc – missing or invalid inputs"
        );
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
          console.log("✅ Travel-inclusive price:", result);
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

  // --- Gallery tab state for musician media sets ---
  const [activeMediaTab, setActiveMediaTab] = useState("blackTie");
  // one of: "blackTie" | "formal" | "smartCasual" | "sessionAllBlack" | "additional"

  // Helper to get short name: first + last initial, with fallbacks
  const displayShortName = (act) => {
    const first = act?.firstName || act?.tscName || 'Musician';
    const lastInitial = act?.lastName ? ` ${act.lastName.charAt(0)}` : '';
    return `${first}`.trim();
  };

  return (
  <div className="p-4">
    {/* Top Navigation */}
    <div className="flex justify-between items-center mb-4">
      <button onClick={() => navigate(-1)} className="text-gray-600 hover:text-black">
        ← Back
      </button>

      {/* Date & Venue Selection */}
      <div>
        {selectedDate ? (
          <div className="text-sm mt-3 p-2 text-gray-500">
            <span>Availability for </span>
            <span className="text-gray-700">{formatDate(selectedDate)}</span>
            {isYesForSelectedDate === true && (
              <span className="ml-2 inline-flex items-center text-green-700">✓ Available</span>
            )}
            {isYesForSelectedDate === false && (
              <span className="ml-2 inline-flex items-center text-red-700">✗ Not available</span>
            )}
            {isYesForSelectedDate === null && (
              <span className="ml-2 inline-flex items-center text-gray-600">— checking —</span>
            )}
            <span
              onClick={() => setShowSearch(true)}
              className="text-blue-600 cursor-pointer underline ml-3"
            >
              change date
            </span>
          </div>
        ) : (
          <p className="text-sm mt-3 p-2 text-gray-500 justify-center">
            Select a date to check this musician’s availability
            <span
              onClick={() => setShowSearch(true)}
              className="text-blue-600 cursor-pointer underline ml-2"
            >
              choose date
            </span>
          </p>
        )}
      </div>

      <div />
    </div>

    {/* HERO */}
    <MusicianHero musicianId={musicianId} />

    {/* ===== ROW 1: LEFT (video + thumbs + bio), RIGHT (in brief) ===== */}
    <div className="border-t-2 pt-10">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 w-full">
        {/* LEFT: span 8 */}
        <div className="lg:col-span-8 space-y-4">
          {/* Videos */}
          <div className="aspect-video">
            <div className="text-2xl">
              <Title
                text1={getPossessiveTitleCase(displayShortName(actData))}
                text2="VIDEOS"
              />
            </div>
            {(() => {
              const allVideoLinks = [
                ...(Array.isArray(actData?.tscApprovedFunctionBandVideoLinks)
                  ? actData.tscApprovedFunctionBandVideoLinks
                  : []),
                ...(Array.isArray(actData?.tscApprovedOriginalBandVideoLinks)
                  ? actData.tscApprovedOriginalBandVideoLinks
                  : []),
              ].filter((v) => v && v.url);

              const selectedUrl = video || allVideoLinks[0]?.url || "";
              const selectedVideoId = extractVideoId(selectedUrl);

              if (!selectedVideoId) {
                return (
                  <div className="w-full h-full bg-gray-100 rounded flex items-center justify-center text-gray-500">
                    No videos yet.
                  </div>
                );
              }

              return (
                <iframe
                  className="w-full h-full object-contain aspect-video rounded"
                  src={`https://www.youtube.com/embed/${selectedVideoId}?modestbranding=1&rel=0&showinfo=0&controls=0`}
                  title="YouTube video player"
                  frameBorder="0"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                />
              );
            })()}
          </div>

          {/* Thumbnails */}
          {(() => {
            const covers = Array.isArray(actData?.tscApprovedFunctionBandVideoLinks)
              ? actData.tscApprovedFunctionBandVideoLinks.filter((v) => v && v.url)
              : [];
            const originals = Array.isArray(actData?.tscApprovedOriginalBandVideoLinks)
              ? actData.tscApprovedOriginalBandVideoLinks.filter((v) => v && v.url)
              : [];

            const Row = ({ label, items }) => {
              if (!items.length) return null;
              return (
                <div className="mb-3">
                  <div className="text-xs tracking-widest text-gray-500 uppercase mb-1 px-1">
                    {label}
                  </div>
                  <div className="flex gap-2 overflow-x-auto pb-2">
                    {items.map((videoObj, index) => {
                      const videoId = extractVideoId(videoObj.url);
                      if (!videoId) return null;
                      return (
                        <img
                          key={`${label}-${index}`}
                          onClick={() => setVideo(videoObj.url)}
                          className="w-[96px] h-[54px] object-cover cursor-pointer flex-shrink-0 border-2 border-transparent hover:border-[#ff6667] hover:shadow-md transition duration-200 rounded"
                          src={`https://img.youtube.com/vi/${videoId}/0.jpg`}
                          alt={videoObj.title || `${label} ${index + 1}`}
                          title={videoObj.title || videoObj.url}
                          loading="lazy"
                        />
                      );
                    })}
                  </div>
                </div>
              );
            };

            return (
              <div className="mt-2">
                <Row label="Covers" items={covers} />
                <Row label="Originals" items={originals} />
                {!covers.length && !originals.length && (
                  <p className="text-sm text-gray-400 px-1">No videos to show yet.</p>
                )}
              </div>
            );
          })()}

    {/* Bio */}
    <div className="mt-12">
      <div className="text-2xl">
        <Title
          text1={getPossessiveTitleCase(displayShortName(actData))}
          text2="BIOGRAPHY"
        />
      </div>
              <div className="px-2 py-2 text-gray-600 text-lg sm:text-xl leading-relaxed">
        {(() => {
          const pickBio = (data) => {
            const preferred = data?.tscApprovedBio ?? data?.bio ??  "";
            if (preferred == null) return "";
            if (typeof preferred === "string") return preferred.trim();
            // If an array of blocks (e.g., from a rich text editor), try to join text
            if (Array.isArray(preferred)) {
              try {
                return preferred
                  .map((b) => (typeof b === "string" ? b : (b?.text || b?.children?.map?.((c)=>c?.text).join("") || "")))
                  .join("\n");
              } catch {
                return JSON.stringify(preferred);
              }
            }
            // If object, stringify
            try {
              return JSON.stringify(preferred);
            } catch {
              return String(preferred);
            }
          };

          const raw = pickBio(actData);
          const looksLikeHTML =
            /<\/?[a-z][\s\S]*>/i.test(raw) || /&lt;\/?[a-z][\s\S]*&gt;/i.test(raw);
          const html = looksLikeHTML ? raw : String(raw).replace(/\n/g, "<br/>");
          return raw ? (
            <div dangerouslySetInnerHTML={{ __html: html }} />
          ) : (
            <p className="text-gray-400">No biography added yet.</p>
          );
        })()}
      </div>
    </div>
   
        </div>

        {/* RIGHT: IN BRIEF span 4 */}
        <div className="lg:col-span-4">
        <div className="text-2xl" id="lineup-selector">
          <Title
            text1={getPossessiveTitleCase(displayShortName(actData))}
            text2="SNAPSHOT"
          />
        </div>

               {/* Instrumentation Header and Sorted List */}
        {Array.isArray(actData?.instrumentation) &&
          (actData?.instrumentation?.length || 0) > 0 && (
            <>
              <ul className="list-disc pl-5 text-lg text-gray-600 mt-4">
                                <h4 className="font-semibold text-gray-900 mb-2">Instrumentation</h4>

                {/* Sorted Instruments */}
                {(() => {
                  const skillOrder = {
                    "Expert": 1,
                    "Advanced": 2,
                    "Intermediate": 3
                  };
                  // Defensive copy and sort
                  const sorted = [...(actData.instrumentation || [])].sort((a, b) => {
                    const aOrder = skillOrder[a?.skill_level] || 99;
                    const bOrder = skillOrder[b?.skill_level] || 99;
                    return aOrder - bOrder;
                  });
                  return sorted.map((item, idx) => (
                    <li key={`inst-${idx}`}>
                      {item?.instrument}
                      {item?.skill_level ? ` (${item.skill_level})` : ""}
                    </li>
                  ));
                })()}
              </ul>
            </>
        )}

           {/* Additional info list */}
<ul className="list-disc pl-5 text-lg text-gray-600 mt-4">
                <h4 className="font-semibold text-gray-900 mb-2">Vocals</h4>

  {/* Vocal abilities */}
  {Array.isArray(actData?.vocals?.type) &&
    (actData?.vocals?.type?.length || 0) > 0 && (
      <li>
        {actData.vocals.type.join(", ")}
        {actData.vocals?.range ? ` (${actData.vocals.range})` : ""}
      </li>
    )}

  {/* Rap ability */}
{/* Rap ability */}
{(actData?.vocals?.rap === true || actData?.vocals?.rap === "true") && (
  <li>Can rap / MC</li>
)}
</ul>

{(() => {
  // Define skill categories and their skills
  const liveSkillsSet = new Set([
    "Live Audio Recording",
    "Sound Engineering",
    "Sound Engineering with PA & Lights Provision",
   
    "DJ with Decks",
    "DJ with Mixing Console",
    "Roaming Performer",
    "Talkback Experience",
    "Musical Director",
    "Band Leader",
    "Can perform to click track",
    "Can perform to backing track",
    "Can trigger backing tracks",
    "Can perform to live band and backing track"
  ]);
  const studioSkillsSet = new Set([
    "Music Production: Mixing",
    "Music Production: Mastering"
  ]);
  const prepSkillsSet = new Set([
    "Client Liaison",
    "Can curate backing tracks",
    "Can curate setlist"
  ]);
  const otherSkillsSet = new Set([
    "Photography",
    "Videography"
  ]);

  // Defensive: always array
  const otherSkillsArr = Array.isArray(actData?.other_skills) ? actData.other_skills : [];
  // Partition skills
  const liveSkills = otherSkillsArr.filter(skill => liveSkillsSet.has(skill));
  const studioSkills = otherSkillsArr.filter(skill => studioSkillsSet.has(skill));
  const prepSkills = otherSkillsArr.filter(skill => prepSkillsSet.has(skill));
  const otherSkills = otherSkillsArr.filter(skill =>
    otherSkillsSet.has(skill)
  );

  // Anything not in above? Assign to "Other" as well (but avoid duplicates)
  const allCategorized = new Set([
    ...liveSkills,
    ...studioSkills,
    ...prepSkills,
    ...otherSkills
  ]);
  const uncategorized = otherSkillsArr.filter(skill => !allCategorized.has(skill));
  const fullOtherSkills = [...otherSkills, ...uncategorized];

  return (
    <>
    {liveSkills.length > 0 && (
  <ul className="list-disc pl-5 text-lg text-gray-600 mt-4">
    <h4 className="font-semibold text-gray-900 mb-2">Live Skills</h4>
    {liveSkills.map((skill, idx) => (
      <li key={`live-skill-${idx}`}>{skill}</li>
    ))}
  </ul>
)}

{studioSkills.length > 0 && (
  <ul className="list-disc pl-5 text-lg text-gray-600 mt-4">
    <h4 className="font-semibold text-gray-900 mb-2">Studio Skills</h4>
    {studioSkills.map((skill, idx) => (
      <li key={`studio-skill-${idx}`}>{skill}</li>
    ))}
  </ul>
)}

{prepSkills.length > 0 && (
  <ul className="list-disc pl-5 text-lg text-gray-600 mt-4">
    <h4 className="font-semibold text-gray-900 mb-2">Preparatory Skills</h4>
    {prepSkills.map((skill, idx) => (
      <li key={`prep-skill-${idx}`}>{skill}</li>
    ))}
  </ul>
)}

{(() => {
  const visibleOtherSkills = ["Photography", "Videography"].filter((skill) =>
    fullOtherSkills.includes(skill)
  );

  return visibleOtherSkills.length > 0 ? (
    <ul className="list-disc pl-5 text-lg text-gray-600 mt-4">
      <h4 className="font-semibold text-gray-900 mb-2">Other</h4>
      {visibleOtherSkills.map((skill) => (
        <li key={skill}>{skill}</li>
      ))}
    </ul>
  ) : null;
})()}
    </>
  );
})()}
<ul className="list-disc pl-5 text-lg text-gray-600 mt-4">
      <h4 className="font-semibold text-gray-900 mb-2">Location</h4>

  {/* County */}
  {actData?.address?.county && <li>Based in {actData?.address?.county}</li>}
</ul>
        </div>
      </div>

      {/* ===== GALLERY (full width) ===== */}
      <div className="w-full mt-12">
            {/*  Academics & Achievements */}
      <div className="lg:col-span-7">
        <div className="text-2xl mb-2">
          <Title
            text1={getPossessiveTitleCase(
              `${actData?.firstName || ""}`
            )}
            text2="ACADEMICS, ACHIEVEMENTS & BANDS"
          />
        </div>
        <div className="border rounded px-4 py-6 text-m text-gray-700 w-full my-2 sm:px-6 sm:py-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {/* 🎓 Academic Credentials */}
          <div>
            {Array.isArray(actData?.academic_credentials) &&
              actData.academic_credentials.length > 0 && (
                <>
                  <h4 className="font-semibold text-gray-900 mb-2">Education & Achievements</h4>
                  <ul className="list-disc pl-5 space-y-1">
                    {actData.academic_credentials.map((cred, idx) => {
                      const level = cred?.education_level ? `${cred.education_level} — ` : "";
                      const course = cred?.course || "";
                      const inst = cred?.institution ? ` @ ${cred.institution}` : "";
                      const years = cred?.years ? ` (${cred.years})` : "";
                      const line = `${level}${course}${inst}${years}`.trim();
                      return line ? <li key={`cred-${idx}`}>{line}</li> : null;
                    })}
                  </ul>
                   {Array.isArray(actData?.awards) && actData.awards.length > 0 && (
              <>
              
                <ul className="list-disc pl-5 space-y-1">
                  {actData.awards.map((a, idx) => {
                    const desc = a?.description || "";
                    const years = a?.years ? ` (${a.years})` : "";
                    const line = `${desc}${years}`.trim();
                    return line ? <li key={`award-${idx}`}>{line}</li> : null;
                  })}
                </ul>
              </>
            )}
                </>
              )}

           
          </div>
          {/* 🎸 Function Bands Performed With */}
          <div>
            {Array.isArray(actData?.function_bands_performed_with) &&
              actData.function_bands_performed_with.length > 0 && (
                <>
                  <h4 className="font-semibold text-gray-900 mb-2">Function Projects</h4>
                  <ul className="list-disc pl-5 space-y-1">
                    {actData.function_bands_performed_with.map((b, idx) => {
                      const name = b?.function_band_name || "";
                  
                      return name ? (
                        <li key={`funcband-${idx}`}>
                          {name}
                        
                        </li>
                      ) : null;
                    })}
                  </ul>
                </>
              )}
          </div>
          {/* 🎤 Original Bands Performed With */}
          <div>
            {Array.isArray(actData?.original_bands_performed_with) &&
              actData.original_bands_performed_with.length > 0 && (
                <>
                  <h4 className="font-semibold text-gray-900 mb-2">Original Projects</h4>
                  <ul className="list-disc pl-5 space-y-1">
                    {actData.original_bands_performed_with.map((b, idx) => {
                      const name = b?.original_band_name || "";
                   
                      return name ? (
                        <li key={`origband-${idx}`}>
                          {name}
                      
                        </li>
                      ) : null;
                    })}
                  </ul>
                </>
              )}
          </div>
          {/* 🎚️ Sessions */}
          <div>
            {Array.isArray(actData?.sessions) && actData.sessions.length > 0 && (
              <>
                <h4 className="font-semibold text-gray-900 mb-2">Sessions</h4>
                <ul className="list-disc pl-5 space-y-1">
                  {actData.sessions.map((s, idx) => {
                    const artist = s?.artist || "";
                    const stype = s?.session_type ? `, ${s.session_type}` : "";
                    const line = `${artist}${stype}`.trim();
                    return line ? <li key={`session-${idx}`}>{line}</li> : null;
                  })}
                </ul>
              </>
            )}
          </div>
          {/* Fallback */}
          {!(
            (Array.isArray(actData?.academic_credentials) &&
              actData.academic_credentials.length) ||
            (Array.isArray(actData?.awards) && actData.awards.length) ||
            (Array.isArray(actData?.function_bands_performed_with) &&
              actData.function_bands_performed_with.length) ||
            (Array.isArray(actData?.original_bands_performed_with) &&
              actData.original_bands_performed_with.length) ||
            (Array.isArray(actData?.sessions) && actData.sessions.length)
          ) && (
            <div className="col-span-full">
              <p className="text-gray-400">No credits listed yet.</p>
            </div>
          )}
        </div>
      </div>
        <div className="text-2xl mt-12">
          <Title
            text1={getPossessiveTitleCase(displayShortName(actData))}
            text2="GALLERY"
          />
        </div>

        {(() => {
          const mediaGroups = [
            {
              id: "blackTie",
              label: "Black Tie",
              items: Array.isArray(actData?.digitalWardrobeBlackTie)
                ? actData.digitalWardrobeBlackTie
                : [],
            },
            {
              id: "formal",
              label: "Formal",
              items: Array.isArray(actData?.digitalWardrobeFormal)
                ? actData.digitalWardrobeFormal
                : [],
            },
            {
              id: "smartCasual",
              label: "Smart Casual",
              items: Array.isArray(actData?.digitalWardrobeSmartCasual)
                ? actData.digitalWardrobeSmartCasual
                : [],
            },
            {
              id: "sessionAllBlack",
              label: "Session All Black",
              items: Array.isArray(actData?.digitalWardrobeSessionAllBlack)
                ? actData.digitalWardrobeSessionAllBlack
                : [],
            },
            {
              id: "additional",
              label: "Additional",
              items: Array.isArray(actData?.additionalImages)
                ? actData.additionalImages
                : [],
            },
          ];

          const activeGroup = mediaGroups.find((g) => g.id === activeMediaTab) || mediaGroups[0];
          const images = (activeGroup?.items || [])
            .map((item) => {
              if (typeof item === "string") return item;
              if (item && typeof item === "object" && item.url) return item.url;
              return null;
            })
            .filter(Boolean);

          return (
            <>
              {/* Tabs */}
              <div className="flex flex-wrap gap-2 mt-4 px-1">
                {mediaGroups.map((g) => (
                  <button
                    key={g.id}
                    type="button"
                    onClick={() => setActiveMediaTab(g.id)}
                    className={`px-3 py-1.5 rounded border text-sm transition-colors ${
                      activeMediaTab === g.id
                        ? "bg-black text-white border-black"
                        : "bg-gray-100 text-gray-700 border-gray-300 hover:bg-[#ff6667] hover:text-white hover:border-[#ff6667]"
                    }`}
                  >
                    {g.label} ({g.items?.length || 0})
                  </button>
                ))}
              </div>

              {/* Carousel */}
              <div className="relative px-1 py-3">
                {images.length > 0 ? (
                  <div className="relative">
                    <button
                      onClick={() => scrollGallery("left")}
                      className="absolute -left-6 top-1/2 -translate-y-1/2 z-10"
                      aria-label="Scroll left"
                      type="button"
                    >
                      <img src={assets.scroll_left_icon} alt="Scroll left" className="w-8 h-8" />
                    </button>

                    <div
                      ref={galleryRef}
                      className="flex gap-4 overflow-x-auto scrollbar-hide snap-x snap-mandatory"
                      style={{ scrollBehavior: "smooth" }}
                    >
                      {images.map((url, index) => (
                        <img
                          key={`${activeGroup.id}-${index}`}
                          src={url}
                          alt={`${activeGroup.label} image ${index + 1}`}
                          className="w-[600px] h-[400px] object-cover rounded shadow-sm flex-shrink-0 snap-start"
                          loading="lazy"
                        />
                      ))}
                    </div>

                    <button
                      onClick={() => scrollGallery("right")}
                      className="absolute -right-6 top-1/2 -translate-y-1/2 z-10"
                      aria-label="Scroll right"
                      type="button"
                    >
                      <img src={assets.scroll_right_icon} alt="Scroll right" className="w-8 h-8" />
                    </button>
                  </div>
                ) : (
                  <p className="text-sm text-gray-400 px-0 py-3">
                    No images in “{activeGroup.label}”. Try a different tab.
                  </p>
                )}
              </div>
            </>
          );
        })()}
      </div>

      {/* ===== REPERTOIRE (full width) ===== */}
      <div className="w-full mt-10">
        <MusicianRepertoireSection
          selectedSongs={Array.isArray(actData?.selectedSongs) ? actData.selectedSongs : []}
          actData={actData}
          addToCart={addToCart}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 mt-12">
        

        {/* RIGHT: Equipment */}
        <div className="lg:col-span-12">
          <div className="text-2xl mb-2">
            <Title
              text1={getPossessiveTitleCase(
                `${actData?.firstName || ""}`
              )}
              text2="EQUIPMENT"
            />
          </div>
          <div className="relative">
            <MusicianEquipment actData={actData} />
          </div>
        </div>
      </div>

      {/* ===== RELATED MUSICIANS (full width) ===== */}
      <div className="w-full mt-12">
        <RelatedMusicians
          genres={Array.isArray(actData?.vocals?.genres) ? actData.vocals.genres : []}
          instruments={
            Array.isArray(actData?.instrumentation)
              ? actData.instrumentation.map((i) => i?.instrument).filter(Boolean)
              : []
          }
          vocalist={Array.isArray(actData?.vocals?.type) ? actData.vocals.type[0] || "" : ""}
          currentActId={actData?._id}
        />
      </div>
    </div>
  </div>
);
};

export default Musician;
