import React, { useState, useEffect, useContext } from "react";

import { assets } from "../assets/assets";
import { toast } from "react-toastify";
import calculateActPricing from "../pages/utils/pricing";

import ActHero from "../components/ActHero";
import CustomToast from "../components/CustomToast";
import { ShopContext } from "../context/ShopContext";
import PreviewPanelRepertoireSection from "../components/PreviewPanelRepertoireSection";
import Title from "../components/Title";
import { getPossessiveTitleCase } from "./utils/getPossessiveTitleCase"; // adjust path as needed
import { FeaturedVocalistBadge } from "../components/FeaturedVocalistBadge";

const ShortlistPreviewPanel = ({ hoveredAct, removeFromCart }) => {
  const actData = hoveredAct?.actData;
  const [localActData, setLocalActData] = useState(null);
  const [video, setVideo] = useState("");
  const [selectedLineup, setSelectedLineup] = useState("");
  const [price, setPrice] = useState(null);
  const [isYesForSelectedDate, setIsYesForSelectedDate] = useState(null);

  const {
    actId,
    acts,
    setActData,
    selectedCounty,
    selectedAddress,
    selectedDate,
    addToCart,
    cartItems,
    setCartItems
  } = useContext(ShopContext);
  // Helper to migrate the lineup in the cart when user selects a different lineup

  const [badgeMusicianId, setBadgeMusicianId] = useState("");


  const migrateCartLineup = (actIdParam, newLineupId) => {
    try {
      if (!hoveredAct?.isInCart) return;
      const currentActCart = hoveredAct?.cartItems?.[actIdParam];
      const oldLineupId = currentActCart ? Object.keys(currentActCart)[0] : null;
      if (!oldLineupId || String(oldLineupId) === String(newLineupId)) return;

      setCartItems((prev) => {
        const updated = structuredClone(prev || {});
        if (!updated?.[actIdParam]?.[oldLineupId]) return prev;
        // move the node to the new key
        updated[actIdParam][String(newLineupId)] = updated[actIdParam][oldLineupId];
        delete updated[actIdParam][oldLineupId];
        return updated;
      });
    } catch (e) {
      console.warn("⚠️ migrateCartLineup failed", e);
    }
  };


  useEffect(() => {
    // Dev-only: compute pricing for all lineups to verify calculations
    if (process.env.NODE_ENV === 'production') return;
    (async () => {
      try {
        const act = actData || localActData;
        if (!act || !Array.isArray(act.lineups) || act.lineups.length === 0) return;
        for (const lu of act.lineups) {
          try {
            const res = await calculateActPricing(
              act,
              selectedCounty,
              selectedAddress,
              selectedDate,
              lu
            );
           console.groupCollapsed(`🔎 lineup ${lu.actSize || ''} • ${lu._id}`);
           console.log('summary', {
             id: lu._id,
             actSize: lu.actSize,
             members: lu?.bandMembers?.length || 0,
             total: res?.total,
             travelCalculated: res?.travelCalculated,
           });
            console.groupEnd();
          } catch (e) {
            console.warn("⚠️ pricing failed for lineup", lu?._id, e);
          }
        }
      } catch {}
    })();
  }, [actData, localActData, selectedCounty, selectedAddress, selectedDate]);

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
    if (Array.isArray(acts) && acts.length > 0 && hoveredAct?.actId) {
      console.log("🔍 Looking for hoveredAct.actId:", hoveredAct.actId);

      const foundAct = acts.find((item) => {
        console.log("➡️ Checking act:", item._id, "vs", hoveredAct.actId);
        return item._id === hoveredAct.actId;
      });

      if (!foundAct) {
        console.warn("⚠️ No act found for:", hoveredAct.actId);
        return;
      }

      console.log("✅ Found act:", foundAct);
      console.log("📝 Reviews on foundAct:", foundAct.reviews);

      const avgRating = calculateAverageRating(foundAct.reviews);
      console.log("⭐ Calculated avgRating:", avgRating);

      setLocalActData({
        ...foundAct,
        averageRating: avgRating,
      });

      setVideo(foundAct.videos?.[0]?.url || "");
      if (foundAct.lineups.length > 0) {
        setSelectedLineup(foundAct.lineups[0]);
      }
    }
  }, [hoveredAct, acts]);

  useEffect(() => {
    const calculateAndSetPrice = async () => {
      if (!actData || !actData.lineups || !actData.lineups.length) return;
      try {
        const result = await calculateActPricing(
          actData,
          selectedCounty,
          selectedAddress,
          selectedDate,
          selectedLineup || actData.lineups[0]
        );
        setPrice(result);
      } catch (err) {
        console.error("❌ Failed to calculate price:", err);
      }
    };
    calculateAndSetPrice();
  }, [actData, selectedCounty, selectedAddress, selectedDate, selectedLineup]);

  // verify latest reply on this act+date (use backend base + proper query params)
  useEffect(() => {
    let abort = false;
    (async () => {
      try {
        if (!actData?._id || !selectedDate) {
          if (!abort) setIsYesForSelectedDate(null);
          return;
        }

        const base = (import.meta.env.VITE_BACKEND_URL || "").replace(/\/+$/, "");
        const dateISO = new Date(selectedDate).toISOString().slice(0, 10);
        const u = new URL(`${base}/api/v2/availability/acts-by-dateV2`);
        u.searchParams.set("date", dateISO);
        u.searchParams.set("actId", String(actData._id));

        const resp = await fetch(u.toString(), { headers: { accept: "application/json" } });
        const text = await resp.text();
        let j = {};
        try { j = text ? JSON.parse(text) : {}; } catch { j = {}; }
        if (!resp.ok) throw new Error(`availability ${resp.status}`);

        if (!abort) {
          const latest = j?.latestReply || j?.latest || j?.reply || null;
          setIsYesForSelectedDate(latest === 'yes' ? true : (latest === 'no' ? false : null));
        }
      } catch (e) {
        if (!abort) setIsYesForSelectedDate(null);
      }
    })();
    return () => { abort = true; };
  }, [actData?._id, selectedDate]);

  const isVocalRole = (role = "") =>
    [
      "Lead Female Vocal",
      "Lead Male Vocal",
      "Lead Vocal",
      "MC/Rapper",
      "Lead Male Vocal/Rapper",
      "Lead Female Vocal/Rapper",
      "Lead Male Vocal/Rapper & Guitarist",
      "Lead Female Vocal/Rapper & Guitarist",
      "Vocalist-Guitarist",
      "Vocalist-Bassist",
    ].includes(String(role));


  const featuredVocalist =
    selectedLineup?.bandMembers?.find(
      (m) => isVocalRole(m.instrument) && m.inPromo
    ) || selectedLineup?.bandMembers?.find((m) => isVocalRole(m.instrument));

  const featuredVocalistImg =
    featuredVocalist?.musicianProfileImageUpload ||
    featuredVocalist?.musicianProfileImage ||
    featuredVocalist?.profileImage ||
    null;

  // --- Availability badge (from backend) ---
  const selectedDateISO =
    selectedDate ? new Date(selectedDate).toISOString().slice(0, 10) : null;

  // Resolve which musician to show on the badge (uses backend base URL; no relative /api)
  useEffect(() => {
    const actIdVal = actData?._id;

    // Compute badge date as fallback
    const badgeDateISO = actData?.availabilityBadge?.dateISO
      ? String(actData.availabilityBadge.dateISO).slice(0, 10)
      : null;

    // Use selectedDateISO if present, otherwise badgeDateISO
    const dateToUse = selectedDateISO || badgeDateISO;

    console.log("🗓️ resolve-musician dateToUse", { selectedDateISO, badgeDateISO, dateToUse });

    if (!actIdVal || !dateToUse) {
      setBadgeMusicianId("");
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        const base = (import.meta.env?.VITE_BACKEND_URL || "").replace(/\/+$/, "");
        const url = new URL(`${base}/api/availability/resolve-musician`);
        url.searchParams.set("actId", String(actIdVal));
        url.searchParams.set("dateISO", String(dateToUse).slice(0, 10));

        const resp = await fetch(url.toString(), { headers: { accept: "application/json" } });
        const text = await resp.text();

        let j = {};
        try {
          j = text ? JSON.parse(text) : {};
        } catch {
          j = {};
        }

        if (!resp.ok) {
          throw new Error(`resolve-musician ${resp.status}`);
        }

        if (!cancelled) {
          setBadgeMusicianId(j?.musicianId || "");
        }
      } catch (e) {
        console.warn("⚠️ resolve-musician fetch failed:", e?.message || e);
        if (!cancelled) setBadgeMusicianId("");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [actData?._id, selectedDateISO, actData?.availabilityBadge?.dateISO]);

  const badge = actData?.availabilityBadge || {};
  console.log("🪪 availabilityBadge (full)", badge);

  // Prefer backend photo (set by inbound YES), fall back to the lineup’s featured vocalist image
  const badgeImg = badge?.photoUrl || featuredVocalistImg || null;
  const badgeVariant = badge?.isDeputy ? "deputy" : "lead";
  const cacheKey = badge?.setAt || ""; // cache-buster for image changes

  const shouldShowBadge =
    !!badge?.active &&
    !!badge?.dateISO &&
    (!selectedDateISO || String(badge.dateISO).slice(0, 10) === selectedDateISO);

  // Compare selected date to the badge's dateISO ("yyyy-mm-dd")
  const isBadgeForSelectedDate = (badgeDateISO, selectedDateLike) => {
    if (!badgeDateISO || !selectedDateLike) return false;
    const selISO = new Date(selectedDateLike).toISOString().slice(0, 10); // yyyy-mm-dd
    return String(badgeDateISO).slice(0, 10) === selISO;
  };

  console.log("🎖️ Badge check", {
    active: actData?.availabilityBadge?.active,
    badgeDateISO: actData?.availabilityBadge?.dateISO,
    selectedDateISO: selectedDate ? new Date(selectedDate).toISOString().slice(0,10) : null,
    matches: isBadgeForSelectedDate(actData?.availabilityBadge?.dateISO, selectedDate),
    hasPhoto: !!featuredVocalistImg,
  });

  // --- derive profile link/id for badge (for "view profile" link) ---
 const _ab = badge || {};
 const hasDeputies = Array.isArray(_ab.deputies) && _ab.deputies.length > 0;
 const _musId =
   (hasDeputies && typeof _ab.deputies[0]?.musicianId === "string" && _ab.deputies[0].musicianId) ||
   (typeof _ab.musicianId === "string" && _ab.musicianId) ||
   (typeof _ab.whoMusicianId === "string" && _ab.whoMusicianId) ||
   (typeof _ab.availabilityMusicianId === "string" && _ab.availabilityMusicianId) ||
   (typeof _ab.docForPhotoId === "string" && _ab.docForPhotoId) ||
  badgeMusicianId ||               // <-- new fallback from Availability YES row
  "";
  const _PUBLIC_SITE_BASE = (import.meta?.env?.VITE_PUBLIC_SITE_URL || "http://localhost:5174").replace(/\/$/, "");
  const _profileUrl = _musId ? `${_PUBLIC_SITE_BASE}/musician/${_musId}` : "";
  console.log("🔗 [ShortlistPreviewPanel] badge profile (computed)", { hasDeputies, _musId, _profileUrl });

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

  const generateDescription = (lineup) => {
    if (!lineup || !Array.isArray(lineup.bandMembers)) return "Select a Lineup";

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

  const handleLineupChange = (lineup) => {
    console.log("🎭 Lineup Button Clicked:", lineup);
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

  
  

  return (
    <div className="w-full p-2  min-h-screen transition-all duration-300 ease-in-out">
      {hoveredAct ? (
        <div>
          <div className="w-full mb-2">
            <ActHero
              hideHeart={true}
              actId={hoveredAct.actId}
              acts={[localActData || actData]}
            />{" "}
          </div>

          {/* ⭐ Star Rating */}
          {localActData && (
            <div className="flex justify-between items-center mt-2 pl-3">
              {/* 💷 Price on the left */}
              <p className="text-3xl font-medium pb-4">
                {price
                  ? price.travelCalculated
                    ? `£${price.total}`
                    : `from £${price.total}`
                  : "Loading price..."}
              </p>

              {/* ⭐ Stars on the right */}
              <div className="flex items-center gap-1 mt-2 pl-3">
                {console.log(
                  "🎨 Rendering stars for rating:",
                  localActData.averageRating
                )}
                {[1, 2, 3, 4, 5].map((i) => (
                  <img
                    key={i}
                    className="w-4"
                    src={
                      localActData.averageRating >= i
                        ? assets.star_icon
                        : localActData.averageRating >= i - 0.5
                          ? assets.star_half_icon
                          : assets.star_dull_icon
                    }
                    alt={`Star ${i}`}
                  />
                ))}
                <p className="pl-2 text-sm">
                  ({localActData.reviews?.length || 0})
                </p>
              </div>
            </div>
          )}

          {/* 🎭 Lineup Selection */}
          <div className="flex flex-wrap gap-2 text-lg justify-start ml-3">
            <p className="text-lg text-gray-600 m-3">
              {generateDescription(selectedLineup) || "Add a Lineup"}
            </p>
            {actData?.lineups?.map((lineup, index) => {
              const isSelected = selectedLineup?._id === lineup._id;
              return (
                <button
                  key={`${lineup._id || "lineup"}-${index}`}
                  onClick={async () => {
                    setSelectedLineup(lineup);

                    // If this act is already in the cart, immediately migrate the lineup key
                    // so the Cart dropdown shows the newly-picked lineup by default.
                    if (actData?._id) {
                      migrateCartLineup(actData._id, lineup._id);
                    }

                    try {
                      // Re-use your central pricing util instead of duplicating the fee logic
                      const newPrice = await calculateActPricing(
                        actData,
                        selectedCounty,
                        selectedAddress,
                        selectedDate,
                        lineup
                      );
                      setPrice(newPrice);
                    } catch (err) {
                      console.error("❌ Failed to recalculate price for lineup:", err);
                    }
                  }}
                  className={`border py-2 px-4 rounded text-sm ${
                    isSelected
                      ? "bg-black text-white  hover:bg-[#ff6667]"
                      : "bg-gray-100 text-gray-700  hover:bg-[#ff6667] hover:text-white"
                  }`}
                >
                  {lineup.actSize || `Lineup ${index + 1}`}
                </button>
              );
            })}
          </div>

      <div className="my-3 mt-5">
  {shouldShowBadge ? (
    Array.isArray(badge?.deputies) && badge.deputies.length > 0 ? (
      <div className="flex gap-3 items-center">
        {badge.deputies.slice(0, 3).map((d, i) => {
          const musId = String(d?.musicianId || "");
          const profile =
            d?.profileUrl || (musId ? `${_PUBLIC_SITE_BASE}/musician/${musId}` : "");
          return (
            <FeaturedVocalistBadge
              key={`dep-badge-prev-${i}-${musId}`}
              pictureSource={d}                    // <- lets it use d.profilePicture
              cacheBuster={d?.setAt || cacheKey || ""}
              size={120}
              musicianId={musId}
              profileUrl={profile}
            />
          );
        })}
      </div>
    ) : (
      badgeImg ? (
        <FeaturedVocalistBadge
          imageUrl={badgeImg || ""}               // or omit to force profilePicture
          pictureSource={badge}                   // <- if badge has profilePicture
          cacheBuster={cacheKey || ""}
          size={140}
          musicianId={_musId}
          profileUrl={_profileUrl}
        />
      ) : null
    )
  ) : null}
</div>

          <div className="mt-10 text-2xl ">
            <Title
              text1={getPossessiveTitleCase(actData?.tscName)}
              text2="INCLUSIONS"
            />
          </div>
          {/* ✅ Inclusions */}
          <ul className="list-disc pl-5 text-lg text-gray-600 ml-3 mt-4">
            {actData?.numberOfSets?.length > 1 &&
              actData.lengthOfSets?.length > 1 && (
                <li>
                  Up to {actData.numberOfSets[0]}x{actData.lengthOfSets[0]}mins
                  or {actData.numberOfSets[1]}x{actData.lengthOfSets[1]}mins
                  live performance
                </li>
              )}
            {actData.paSystem && (
              <li>
                {`A ${paMap?.[actData.paSystem] || actData.paSystem} PA system`}
                {actData.lightingSystem &&
                  ` and a ${lightMap?.[actData.lightingSystem] || actData.lightingSystem} lighting system to light up your stage and dancefloor`}
              </li>
            )}
            <li>
              The band on site for up to 7 hours or until midnight, whichever
              comes first
            </li>
            {actData?.extras &&
              Object.entries(actData.extras)
                .filter(([_, v]) => v?.complimentary)
                .map(([key]) => (
                  <li key={key}>
                    {key
                      .replace(/_/g, " ")
                      .replace(/^\w/, (c) => c.toUpperCase())}
                  </li>
                ))}
            {actData?.offRepertoireRequests > 0 && (
              <li>
                {actData.offRepertoireRequests === 1
                  ? "One additional off-repertoire song request"
                  : `${numberToWords(actData.offRepertoireRequests)} additional off-repertoire requests`}
              </li>
            )}
            {selectedAddress && price?.travelCalculated && (
              <li>& travel to {selectedAddress}</li>
            )}
          </ul>

          {/* 🛒 Button */}
          <div className="flex my-6 ml-3">
            <button
              onClick={() => {
                if (!selectedLineup) return;
                const actId = actData._id;
                const lineupId = selectedLineup._id;

                if (hoveredAct.isInCart) {
                  Object.keys(hoveredAct.cartItems[actId] || []).forEach(
                    (lid) => removeFromCart(actId, lid)
                  );
                  toast(
                    <CustomToast
                      type="success"
                      message="Lineup updated in cart!"
                    />,
                    {
                      autoClose: 2000,
                    }
                  );
                } else {
                  toast(
                    <CustomToast type="success" message="Act added to cart!" />,
                    {
                      autoClose: 2000,
                    }
                  );
                }

                setTimeout(() => {
                  console.log("🛒 addToCart called from Shortlist preview:", { actId, lineupId });
                  addToCart(actId, lineupId);
                }, 0);
              }}
              className="bg-black text-white px-8 py-3 text-m active:bg-gray-700 hover:bg-[#ff6667] transition-colors duration-200 rounded"
            >
              {hoveredAct.isInCart ? "UPDATE LINEUP" : "ADD TO CART"}
            </button>
          </div>

          <div className="w-full">
            <PreviewPanelRepertoireSection
              selectedSongs={actData?.selectedSongs || []}
              actData={actData}
              actId={actData?._id}
              lineupId={selectedLineup?._id}
            />
          </div>
        </div>
      ) : (
        <p className="text-gray-500 text-center mt-20">
          Hover over a shortlist item to preview details
        </p>
      )}
    </div>
  );
};

export default ShortlistPreviewPanel;