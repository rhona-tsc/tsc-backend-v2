import React, { useState } from "react";
import MusicianRepertoire from "./MusicianRepertoire";
import MusicianSongSuggestions from "./MusicianSongSuggestions";

const MusicianRepertoireSection = ({ selectedSongs, actData, addToCart }) => {
  const [favourites, setFavourites] = useState([]);

  const toggleFavourite = (song) => {
    const exists = favourites.some(
      (fav) => fav.title === song.title && fav.artist === song.artist
    );
    if (exists) {
      setFavourites((prev) =>
        prev.filter(
          (fav) => fav.title !== song.title || fav.artist !== song.artist
        )
      );
    } else {
      setFavourites((prev) => [...prev, song]);
    }
  };

  return (
    <div className="flex gap-6 w-full items-start">
      <div className="w-[60%]">
        <MusicianRepertoire
          selectedSongs={Array.isArray(selectedSongs) ? selectedSongs : []}
          actData={actData}
          favourites={favourites}
          toggleFavourite={toggleFavourite}
        />
      </div>
      <div className="w-[40%]">
        <MusicianSongSuggestions
          favourites={favourites}
          actData={actData}
          toggleFavourite={toggleFavourite}
          addToCart={addToCart}
        />
      </div>
    </div>
  );
};

export default MusicianRepertoireSection;