import React from "react";
import { assets } from "../assets/assets";

const StarRating = ({ averageRating, reviewCount }) => {
  const stars = [];

  for (let i = 1; i <= 5; i++) {
    if (averageRating >= i) {
      stars.push(<img key={i} src={assets.star_icon} className="w-3.5" alt="Full Star" />);
    } else if (averageRating >= i - 0.5) {
      stars.push(<img key={i} src={assets.star_half_icon} className="w-3.5" alt="Half Star" />);
    } else {
      stars.push(<img key={i} src={assets.star_dull_icon} className="w-3.5" alt="Empty Star" />);
    }
  }

  return (
    <div className="flex items-center gap-1 mt-2">
      {stars}
      {reviewCount !== undefined && (
        <p className="pl-2 text-sm text-gray-600">({reviewCount})</p>
      )}
    </div>
  );
};

export default StarRating;