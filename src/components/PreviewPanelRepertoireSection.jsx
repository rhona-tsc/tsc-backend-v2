import React, { useState, useContext } from "react";
import ActRepertoire from "./ActRepertoire";
import SongSuggestions from "./SongSuggestions";
import { ShopContext } from "../context/ShopContext";

const PreviewPanelRepertoireSection = ({ selectedSongs, actData, actId, lineupId }) => {
  const [favourites, setFavourites] = useState([]);
  const { addToCart } = useContext(ShopContext);

  const toggleFavourite = (song) => {
    const exists = favourites.some(
      fav => fav.title === song.title && fav.artist === song.artist
    );
    if (exists) {
      setFavourites(prev =>
        prev.filter(fav => fav.title !== song.title || fav.artist !== song.artist)
      );
    } else {
      setFavourites(prev => [...prev, song]);
    }
  };

  return (
    <div className="flex flex-col gap-6 w-full mt-10">
      <div>
        <ActRepertoire
          selectedSongs={selectedSongs}
          actData={actData}
          favourites={favourites}
          toggleFavourite={toggleFavourite}
        />
      </div>
      <div className="mt-10">
        <SongSuggestions
          favourites={favourites}
          actData={actData}
          toggleFavourite={toggleFavourite}
          addToCart={() => {
    addToCart(actId, lineupId, [], [], favourites);
  }}
        />
      </div>
    </div>
  );
};

export default PreviewPanelRepertoireSection;