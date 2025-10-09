import React, { useState } from 'react';

const ActItem = ({ id, onShortlistToggle }) => {
  const [isAnimating, setIsAnimating] = useState(false);

  const handleHeartClick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsAnimating(true);

    if (typeof onShortlistToggle === 'function') {
      onShortlistToggle(id); // delegate all logic to parent
    } else {
      console.warn("onShortlistToggle is not a function");
    }

    setTimeout(() => setIsAnimating(false), 300);
  };

  return (
    <div>
      {/* other component JSX */}
      <button onClick={handleHeartClick}>♥</button>
      {/* other component JSX */}
    </div>
  );
};

export default ActItem;