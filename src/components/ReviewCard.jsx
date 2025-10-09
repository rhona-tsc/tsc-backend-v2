import { useState } from "react";
import { assets } from "../assets/assets";

const ReviewCard = ({ review }) => {
  const {
    clientFirstName,
    clientLastName,
    rating,
    comment,
    eventType,
    eventLocation,
    eventMedia = [],
    clientImage,
    eventDate,
  } = review;

  const initials = clientFirstName
    ? `${clientFirstName} ${clientLastName?.[0] || ""}.`
    : "Anonymous";

  const [showAllMedia, setShowAllMedia] = useState(false); // ✅ Move inside component
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxMedia, setLightboxMedia] = useState(null);
  const [lightboxType, setLightboxType] = useState("image");
  const visibleMedia = showAllMedia ? eventMedia : eventMedia.slice(0, 6);

  // Helper function to format date as "25th of July 2025"
  const formatDate = (dateStr) => {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    const day = date.getDate();
    const suffix =
      day % 10 === 1 && day !== 11
        ? 'st'
        : day % 10 === 2 && day !== 12
        ? 'nd'
        : day % 10 === 3 && day !== 13
        ? 'rd'
        : 'th';
    return `${day}${suffix} of ${date.toLocaleString('default', { month: 'long' })} ${date.getFullYear()}`;
  };

  return (
    <div className="
  relative border rounded-lg 
  p-2 sm:p-3 md:p-4 
  shadow-sm bg-white 
  w-[75vw] max-w-[300px]   /* ⬅️ narrower */
  sm:w-[300px] md:w-[360px] 
  max-h-[65vh] sm:max-h-[380px] 
  overflow-y-auto flex-shrink-0
">
  {/* Star rating */}
  <div className="absolute top-2 right-2 sm:top-3 sm:right-3 flex items-center gap-[2px]">
    {[1, 2, 3, 4, 5].map((i) => (
      <img
        key={i}
        className="w-3 sm:w-4"
        src={
          rating >= i
            ? assets.star_icon
            : rating >= i - 0.5
            ? assets.star_half_icon
            : assets.star_dull_icon
        }
        alt={`Star ${i}`}
      />
    ))}
  </div>

  {/* Profile + client */}
  <div className="flex items-start gap-2 sm:gap-3 w-full">
    <img
      src={clientImage || assets.profile_icon}
      alt="Client"
      className="w-10 h-10 sm:w-12 sm:h-12 rounded-full object-cover"
    />
    <div>
      <p className="font-semibold text-gray-800 text-sm sm:text-base">{initials}</p>
      <p className="text-xs sm:text-sm text-gray-500">
        {eventType?.charAt(0).toUpperCase() + eventType?.slice(1)},{" "}
        {eventLocation?.charAt(0).toUpperCase() + eventLocation?.slice(1)}
      </p>
      <p className="text-xs sm:text-sm text-gray-500 mt-1">{formatDate(eventDate)}</p>
    </div>
  </div>

  {/* Comment */}
  <div>
    <p className="w-full mt-2 sm:mt-3 text-gray-700 text-xs sm:text-sm whitespace-pre-wrap">
      {comment}
    </p>
  </div>

  {/* Media thumbnails */}
  {visibleMedia.length > 0 && (
    <div className="mt-2 sm:mt-3 grid grid-cols-3 gap-1 sm:gap-2">
      {visibleMedia.map((media, index) => {
        const isVideo =
          typeof media === "string" &&
          (media.endsWith(".mp4") || media.includes("/video/"));
        const mediaUrl = media.url || media;

        return (
          <div
            key={index}
            className="relative rounded-md overflow-hidden cursor-pointer group"
          >
            {isVideo ? (
              <div
                onClick={() => {
                  setLightboxMedia(mediaUrl);
                  setLightboxType("video");
                  setLightboxOpen(true);
                }}
                className="w-full h-16 sm:h-20 bg-black flex items-center justify-center"
              >
                <video
                  className="object-cover w-full h-full group-hover:scale-105 transition-transform"
                  src={mediaUrl}
                  muted
                  loop
                  playsInline
                />
                <div className="absolute inset-0 bg-black bg-opacity-40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                  <svg className="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M8 5v14l11-7z" />
                  </svg>
                </div>
              </div>
            ) : (
              <img
                src={mediaUrl}
                alt={`Event media ${index + 1}`}
                className="rounded-md cursor-pointer hover:scale-105 transition-transform object-cover w-full h-16 sm:h-20"
                onClick={() => {
                  setLightboxMedia(mediaUrl);
                  setLightboxType("image");
                  setLightboxOpen(true);
                }}
              />
            )}
          </div>
        );
      })}
    </div>
  )}

  {!showAllMedia && eventMedia.length > 6 && (
    <button
      onClick={() => setShowAllMedia(true)}
      className="text-xs sm:text-sm text-blue-600 underline mt-1 sm:mt-2"
    >
      See More Media
    </button>
  )}
</div>
  );
};

export default ReviewCard;