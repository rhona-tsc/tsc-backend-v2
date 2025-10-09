import React, { useState, useEffect, useContext } from 'react';
import PropTypes from 'prop-types';
import { assets } from '../assets/assets';
import { ShopContext } from '../context/ShopContext';

const ActHero = ({ actId, acts, hideHeart = false }) => {
  const [actData, setActData] = useState(null);
  const [isAnimating, setIsAnimating] = useState(false);

  // Only pull what we need from context to avoid name collisions with props/state
  const { userId, shortlistAct, shortlistItems } = useContext(ShopContext);

  // Derive shortlist state from context (single source of truth)
  const isShortlisted =
    Array.isArray(shortlistItems) && actData?._id
      ? shortlistItems.map(String).includes(String(actData._id))
      : false;

  const handleHeartClick = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!actData?._id || !userId) return; // context can prompt login elsewhere
    setIsAnimating(true);
    try {
      await shortlistAct(userId, actData._id.toString());
      // no local toggle; context update will re-render and fill/empty the heart
    } catch (err) {
      // swallow; UI will reflect context on next render
    } finally {
      setTimeout(() => setIsAnimating(false), 300);
    }
  };

  useEffect(() => {
    if (Array.isArray(acts) && acts.length > 0) {
      const foundAct = acts.find((item) => item._id === actId);
      if (foundAct) setActData(foundAct);
    }
  }, [actId, acts]);

  if (
    !actData ||
    !Array.isArray(actData.coverImage) ||
    actData.coverImage.length === 0 ||
    !actData.coverImage[0].url
  ) {
    return null;
  }

  const heroImage = actData.coverImage[0].url;

  return (
    <div className="relative w-full max-w-full">
      {/* Background image banner */}
      {heroImage && (
        <div
          className="relative w-full aspect-video bg-cover bg-center flex items-center justify-center text-white rounded-md overflow-hidden"
          style={{ backgroundImage: `url(${heroImage})` }}
        >
          {/* Heart icon in top-left */}
          {!hideHeart && (
            <button
              onClick={handleHeartClick}
              disabled={isAnimating}
              className="absolute top-4 left-4 p-2 z-20 hidden lg:block"
            >
              <div className="relative flex items-center justify-center">
                {isShortlisted ? (
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    fill="#ff6667"
                    stroke="#cc5253"
                    strokeWidth={1}
                    viewBox="0 0 24 24"
                    className={`w-8 h-8 transition-transform duration-200 ease-in-out ${isAnimating ? 'scale-125' : ''}`}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 
                      2 5.42 4.42 3 7.5 3c1.74 0 3.41 0.81 
                      4.5 2.09C13.09 3.81 14.76 3 16.5 3 
                      19.58 3 22 5.42 22 8.5c0 
                      3.78-3.4 6.86-8.55 11.54L12 21.35z"
                    />
                  </svg>
                ) : (
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    fill={isAnimating ? '#ff6667' : 'none'}
                    stroke="#ffffff"
                    strokeWidth={1}
                    viewBox="0 0 24 24"
                    className={`w-8 h-8 transition-transform duration-200 ease-in-out ${isAnimating ? 'scale-125' : ''}`}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M12 21.35l-1.45-1.32C5.4 15.36 
                      2 12.28 2 8.5 2 5.42 4.42 3 
                      7.5 3c1.74 0 3.41 0.81 
                      4.5 2.09C13.09 3.81 14.76 3 
                      16.5 3 19.58 3 22 5.42 22 
                      8.5c0 3.78-3.4 6.86-8.55 
                      11.54L12 21.35z"
                    />
                  </svg>
                )}
              </div>
            </button>
          )}

          {/* Bestseller badge */}
          {actData.bestseller && (
            <img
              src={assets.client_fave_icon}
              alt="Client Favourite Badge"
              className={`absolute ${hideHeart ? 'top-2 right-2 w-[80px] h-[80px]' : 'bottom-2 right-2 w-[150px] h-[150px] sm:w-[150px] sm:h-[150px]'} hidden lg:block`}
            />
          )}

          {/* Overlay text */}
          <div
            className={`bg-black bg-opacity-50 ${
              hideHeart ? 'h-[50%] p-6 rounded' : 'p-6 rounded'
            } text-center max-w-2xl flex flex-col justify-center`}
          >
            {/* BOOK NOW only for md+ (≥768px) */}
            {!hideHeart && (
              <div className="hidden md:flex items-center gap-2 justify-center mb-2 text-sm tracking-wider">
                <span className="w-8 h-[2px] bg-white inline-block"></span>
                <span>BOOK NOW</span>
                <span className="w-8 h-[2px] bg-white inline-block"></span>
              </div>
            )}

            <h1 className="text-3xl sm:text-4xl lg:text-5xl font-bold leading-snug">
              {actData.tscName}
            </h1>

            {/* Description only for md+ (≥768px) */}
            <div className="hidden md:flex items-center gap-2 justify-center mt-4 text-sm tracking-wider">
              <span>{actData.tscDescription}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

ActHero.propTypes = {
  actId: PropTypes.string.isRequired,
  acts: PropTypes.arrayOf(
    PropTypes.shape({
      _id: PropTypes.string,
      images: PropTypes.arrayOf(PropTypes.shape({ url: PropTypes.string })),
      name: PropTypes.string,
    })
  ).isRequired,
  hideHeart: PropTypes.bool,
};

export default ActHero;