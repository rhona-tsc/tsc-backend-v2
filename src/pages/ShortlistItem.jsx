import React, { useState, useContext, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { assets } from '../assets/assets';
import { ShopContext } from '../context/ShopContext';
import axios from 'axios';
import calculateActPricing from '../pages/utils/pricing';
import PropTypes from 'prop-types';

const ShortlistItem = ({
  id,
  actData,
  images,
  tscName,
  onShortlistToggle,
  formattedPrice,
  shortlistCount,
  userId, 
  _id,
  profileImage,
  className,
  onMouseEnter,
  isShortlisted,
  
}) => {

  const [isAnimating, setIsAnimating] = useState(false);
  const [price, setPrice] = useState(null);

  const [loveCount, setLoveCount] = useState(shortlistCount || 0);
  const { shortlistAct, shortlistedActs, selectedCounty, selectedAddress, selectedDate } = useContext(ShopContext);
  

  useEffect(() => {
    setLoveCount(shortlistCount || 0);
  }, [shortlistCount]);

useEffect(() => {
  const calculateAndSetPrice = async () => {
    try {
      if (!actData?.lineups?.length) {
        console.warn('⚠️ Missing actData or lineups in ActItem:', actData);
        return;
      }

      // Only use county travel if it’s actually configured
      const hasCountyTable = actData.useCountyTravelFee && actData.countyFees && Object.keys(actData.countyFees).length > 0;
      const lineup = actData.lineups[0];

      const result = await calculateActPricing(
        actData,
        hasCountyTable ? selectedCounty : null, // prevent county-based path when empty
        selectedAddress,
        selectedDate,
        lineup
      );

      // Hard fallback if util returns nothing
      if (!result || result.total == null) {
        const base =
          actData?.formattedPrice?.total ??
          lineup?.base_fee?.[0]?.total_fee ??
          null;

        setPrice(base != null ? { total: base, travelCalculated: false } : null);
        return;
      }

      setPrice(result);
    } catch (err) {
      console.error('❌ Failed to calculate price:', { err, actId: actData?._id, useCountyTravelFee: actData?.useCountyTravelFee });
      // Last-resort fallback so UI never gets stuck
      const lineup = actData.lineups?.[0];
      const base =
        actData?.formattedPrice?.total ??
        lineup?.base_fee?.[0]?.total_fee ??
        null;
      setPrice(base != null ? { total: base, travelCalculated: false } : null);
    }
  };
  calculateAndSetPrice();
}, [actData, selectedCounty, selectedAddress, selectedDate]);

  const handleHeartClick = async (e) => {


  e.preventDefault();
  e.stopPropagation();
  setIsAnimating(true);
onShortlistToggle();
setTimeout(() => setIsAnimating(false), 300);

return;



};


  const formatLoveCount = (count) => {
    if (count >= 1000) {
      return `${(count / 1000).toFixed(1).replace(/\.0$/, '')}K`;
    }
    return count;
  };

  // --- Video carousel state and logic ---
  const [videoIndex, setVideoIndex] = useState(0);
  // Support both tscVideos from actData or fallback to empty array
  const tscVideos = (actData && actData.tscVideos) || [];

  // New state for play/pause
  const [isPlaying, setIsPlaying] = useState(false);

  const handlePrevVideo = () => {
    setVideoIndex((prev) => (prev - 1 + tscVideos.length) % tscVideos.length);
    setIsPlaying(false);
  };

  const handleNextVideo = () => {
    setVideoIndex((prev) => (prev + 1) % tscVideos.length);
    setIsPlaying(false);
  };

  // Helper to extract YouTube video ID from URL or ID
  const extractVideoId = (url) => {
    if (!url) return "";
    const match = url.match(/(?:v=|\/)([0-9A-Za-z_-]{11})/);
    return match ? match[1] : url;
  };

  // Debug logging for actId and isShortlisted
  console.log("❤️ actId in ShortlistItem:", id, "Shortlisted?", isShortlisted);
return (
<div className={`relative group m-4 shrink-0 w-full max-w-[380px] sm:w-[320px] ${className ? className : ''}`}
 onMouseEnter={onMouseEnter}
 >
        <Link to={`/act/${actData?._id}`} onClick={() => window.scrollTo(0, 0)} className="block text-gray-700">
        {/* --- Video carousel replaces image block --- */}
        <div className="relative w-full rounded overflow-hidden">
          {/* 16:9 aspect wrapper for consistent sizing on small screens */}
          <div className="relative w-full pt-[56.25%]">
            {/* Left arrow */}
            <button
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                handlePrevVideo();
              }}
              className="absolute left-2 top-1/2 -translate-y-1/2 z-10 text-gray-800 hover:text-black bg-white/70 rounded-full p-1.5 shadow-sm w-7 h-7 md:w-8 md:h-8 flex items-center justify-center"
              aria-label="Scroll left"
              type="button"
              disabled={tscVideos.length === 0}
            >
              <img
                src={assets.scroll_left_icon}
                alt="Scroll left"
                className="w-5 h-5 md:w-6 md:h-6"
              />
            </button>

            {/* Video or fallback image with play button */}
            {tscVideos.length > 0 ? (
              !isPlaying ? (
                <div
                  className="absolute inset-0 w-full h-full cursor-pointer"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setIsPlaying(true);
                  }}
                >
                  <img
                    src={`https://img.youtube.com/vi/${extractVideoId(tscVideos[videoIndex]?.url)}/hqdefault.jpg`}
                    className="absolute inset-0 w-full h-full object-cover"
                    alt="Video thumbnail"
                    onError={(e) => {
                      e.target.onerror = null;
                      e.target.src = images?.[0]?.url || '/placeholder.jpg';
                    }}
                  />
                  <img
                    src={assets.custom_play_icon}
                    className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-9 h-9 md:w-10 md:h-10"
                    alt="Play"
                  />
                </div>
              ) : (
                <iframe
                  className="absolute inset-0 w-full h-full object-cover"
                  src={`https://www.youtube.com/embed/${extractVideoId(tscVideos[videoIndex]?.url) || ''}?autoplay=1&modestbranding=1&rel=0&controls=0`}
                  title="Act video preview"
                  frameBorder="0"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                />
              )
            ) : (
              <img
                className="absolute inset-0 w-full h-full object-cover"
                src={images?.[0]?.url || '/placeholder.jpg'}
                alt="Thumbnail"
              />
            )}

            {/* Right arrow */}
            <button
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                handleNextVideo();
              }}
              className="absolute right-2 top-1/2 -translate-y-1/2 z-10 text-gray-800 hover:text-black bg-white/70 rounded-full p-1.5 shadow-sm w-7 h-7 md:w-8 md:h-8 flex items-center justify-center"
              aria-label="Scroll right"
              type="button"
              disabled={tscVideos.length === 0}
            >
              <img
                src={assets.scroll_right_icon}
                alt="Scroll right"
                className="w-5 h-5 md:w-6 md:h-6"
              />
            </button>

            {/* Dots indicator */}
            <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex gap-1 z-10">
              {tscVideos.map((_, i) => (
                <div
                  key={i}
                  className={`w-2 h-2 rounded-full ${i === videoIndex ? 'bg-white' : 'bg-white/50'} transition`}
                />
              ))}
            </div>
          </div>
        </div>
        {/* --- End video carousel --- */}
        <div className="flex justify-between items-center pt-3 pb-1">
          <div className="min-h-[40px] flex flex-col justify-center">
            <p className="text-sm">{actData.tscName}</p>
<p className="text-sm font-medium">
    {price 
  ? price.travelCalculated 
    ? `£${price.total}` 
    : `from £${price.total}` 
  : "Price loading"}
</p>         </div>
          <div className="flex flex-col items-end justify-between min-h-[40px]">
            <button
              onClick={handleHeartClick}
              disabled={isAnimating}
              className="p-1 transition-transform duration-150 ease-in-out"
            >
             {shortlistedActs?.includes(actData._id) ? (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="-1 -1 34 32"
    className={`w-6 h-6 transition-transform ${isAnimating ? 'scale-125' : ''}`}
    fill="#ff6667"
    stroke="#cc5253"
    strokeWidth="1.5"
  >
    <path d="M23.6,0c-3.4,0-6.4,2.2-7.6,5.4C14.8,2.2,11.8,0,8.4,0C3.8,0,0,3.9,0,8.7c0,4.5,3.2,7.7,8,12.2
       c3.4,3.2,6.5,5.8,7.3,6.4c0.2,0.2,0.5,0.3,0.7,0.3s0.5-0.1,0.7-0.3c0.8-0.6,3.9-3.2,7.3-6.4c4.8-4.5,8-7.7,8-12.2
       C32,3.9,28.2,0,23.6,0z" />
  </svg>
) : (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="-1 -1 34 32"
    className={`w-6 h-6 transition-transform ${isAnimating ? 'scale-125' : ''}`}
    fill="none"
    stroke="#000"
    strokeWidth="1.5"
  >
    <path d="M23.6,0c-3.4,0-6.4,2.2-7.6,5.4C14.8,2.2,11.8,0,8.4,0C3.8,0,0,3.9,0,8.7c0,4.5,3.2,7.7,8,12.2
       c3.4,3.2,6.5,5.8,7.3,6.4c0.2,0.2,0.5,0.3,0.7,0.3s0.5-0.1,0.7-0.3c0.8-0.6,3.9-3.2,7.3-6.4c4.8-4.5,8-7.7,8-12.2
       C32,3.9,28.2,0,23.6,0z" />
  </svg>
)}
            </button>
<p className={`text-xs ${shortlistCount === 0 ? 'text-white' : 'text-gray-700'}`}>
  {shortlistCount === 0
    ? 'love me'
    : `${formatLoveCount(shortlistCount)} ${shortlistCount === 1 ? 'love' : 'loves'}`}
</p>
          </div>
        </div>
      </Link>
    </div>
  );
};

export default ShortlistItem;