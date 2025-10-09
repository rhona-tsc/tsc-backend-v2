import React, { useState, useEffect } from "react";
import PropTypes from "prop-types";
import { assets } from "../assets/assets";
import Title from "./Title";
import { getPossessiveTitleCase } from "../pages/utils/getPossessiveTitleCase"; // adjust path as needed

// --- Genre helpers (kept for filtering UX) ---
const genreMap = {
  "Funk & Disco": ["Funk", "Disco", "Jazz Funk", "Jazz Fusion", "Fusion"],
  "RnB, HipHop & Garage": ["Hip-Hop", "R&B", "Rap", "UK Garage", "Garage Rock", "Proto-Punk"],
  "Alternative & Punk": ["Alternative", "Alternative Rock", "Alternative Metal", "Nu Metal", "Punk", "Punk Rock", "Post-Punk", "Proto-Punk"],
  "Indie & Rock": ["Indie", "Indie Rock", "Indie Folk", "Indie Pop", "Pop Rock", "Soft Rock", "Rock", "Southern Rock", "Surf Rock", "Glam Rock", "Garage Rock", "Hard Rock", "Jazz Rock", "Latin Rock"],
  "Dance & Electronic": ["Dance", "Dance Pop", "Dance-Pop", "Electronic", "Electropop", "EDM", "Eurodance", "House", "Drum and Bass", "Trip-Hop", "Synthpop", "Tropical House", "Electronic Dance Music"],
  "Reggae & Afrobeat": ["Afrobeat", "Afrobeats", "Reggae", "Reggaeton", "Reggae Fusion", "Dancehall"],
  "Soul & Motown": ["Soul", "Motown", "Bossa Nova"],
  "Pop & Classic Pop": ["Pop", "Pop Rock", "Pop Ballad", "Pop Punk", "Comedy", "Showtunes", "Musical", "Disney"],
  "Jazz & Swing": ["Jazz", "Swing", "Jazz Fusion", "Jazz Rock"],
  "Folk & Acoustic": ["Folk", "Folk Rock", "Country", "Country Pop", "Country Rock", "Bluegrass", "Ska", "Acoustic"],
  Latin: ["Latin", "Latin Pop", "Latin Rock", "Salsa"],
  Classical: ["Classical", "Instrumental"],
  Other: [],
};

const categorizeGenre = (genre) => {
  genre = String(genre || "").trim().toLowerCase();
  for (const [category, values] of Object.entries(genreMap)) {
    if (values.some((g) => g.toLowerCase() === genre)) return category;
  }
  return "Other";
};

const MusicianRepertoire = ({
  selectedSongs,
  actData,
  favourites,
  toggleFavourite,
}) => {
  const [filter, setFilter] = useState({
    decade: "",
    genre: "",
    artist: "",
    search: "",
  });
  const [filteredSongs, setFilteredSongs] = useState([]);

  // Only use selectedSongs from the musician model
  const songsSource = Array.isArray(selectedSongs) ? selectedSongs : [];

  // Only use genreMap for filter dropdowns
  const genreCategories = Object.keys(genreMap).filter((cat) => cat !== "Other");

  useEffect(() => {
    let result = Array.isArray(songsSource) ? [...songsSource] : [];
    if (!Array.isArray(songsSource)) return;

    if (filter.decade)
      result = result.filter((song) =>
        String(song.year || "").startsWith(filter.decade)
      );

    if (filter.genre) {
      result = result.filter((song) =>
        String(song.genre || "")
          .split("/")
          .map((g) => categorizeGenre(String(g).trim()))
          .includes(filter.genre)
      );
    }

    if (filter.artist)
      result = result.filter((song) =>
        String(song.artist || "")
          .toLowerCase()
          .includes(filter.artist.toLowerCase())
      );

    if (filter.search)
      result = result.filter(
        (song) =>
          String(song.title || "")
            .toLowerCase()
            .includes(filter.search.toLowerCase()) ||
          String(song.artist || "")
            .toLowerCase()
            .includes(filter.search.toLowerCase())
      );

    setFilteredSongs(result);
  }, [filter, songsSource]);

  const musicianName =
    [`${actData?.firstName || ""}`]
      .join(" ")
      .trim() || actData?.tscName || "Musician";

  return (
    <div className="flex gap-6 items-start w-full">
      <div>
        <div className="text-2xl">
          <Title
            text1={getPossessiveTitleCase(musicianName)}
            text2="REPERTOIRE"
          />
        </div>
        <p className="text-gray-600 text-[17px] mt-2 mb-4 p-2">
          Use the filters below to explore {musicianName}
          &apos;s repertoire of {songsSource.length} songs.
        </p>

        <div className="grid grid-cols-4 gap-3 mb-4 mt-2 w-full">
          <select
            className="border px-2 py-1 rounded-l text-gray-600 text-[17px]"
            value={filter.decade}
            onChange={(e) => setFilter({ ...filter, decade: e.target.value })}
          >
            <option value="">All Decades</option>
            <option value="195">≤ 1969</option>
            <option value="197">1970s</option>
            <option value="198">1980s</option>
            <option value="199">1990s</option>
            <option value="200">2000s</option>
            <option value="201">2010s</option>
            <option value="202">2020s</option>
          </select>
          <select
            className="border px-2 py-1 rounded text-gray-600 text-[17px]"
            value={filter.genre}
            onChange={(e) => setFilter({ ...filter, genre: e.target.value })}
          >
            <option value="">All Genres</option>
            {genreCategories.map((category, index) => (
              <option key={index} value={category}>
                {category}
              </option>
            ))}
            <option value="Other">Other</option>
          </select>
          <input
            type="text"
            placeholder="Artist"
            className="border px-2 py-1 rounded text-gray-600 text-[17px]"
            value={filter.artist}
            onChange={(e) => setFilter({ ...filter, artist: e.target.value })}
          />
          <input
            type="text"
            placeholder="Search title"
            className="border px-2 py-1 rounded text-gray-600 text-[17px]"
            value={filter.search}
            onChange={(e) => setFilter({ ...filter, search: e.target.value })}
          />
        </div>

        <div className="max-h-80 overflow-y-scroll border rounded p-3 bg-white">
          {filteredSongs.slice(0, 100).map((song, idx) => (
            <div
              key={`${song.title}-${song.artist}-${idx}`}
              className="flex justify-between items-center border-b py-1 text-gray-600 text-[17px]"
            >
              <span>
                {song.title} – {song.artist}
              </span>
              <button
                onClick={() => toggleFavourite(song)}
                className="text-red-500 hover:text-red-600 focus:outline-none text-xl "
              >
                {favourites.some(
                  (fav) =>
                    fav.title === song.title && fav.artist === song.artist
                ) ? (
                  <img
                    src={assets.heart_icon}
                    alt="Song shortlisted"
                    className="w-4 h-4 md:w-6 md:h-6"
                  />
                ) : (
                  <img
                    src={assets.shortlist_icon}
                    alt="Shortlist this song"
                    className="w-4 h-4 md:w-6 md:h-6"
                  />
                )}
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

MusicianRepertoire.propTypes = {
  selectedSongs: PropTypes.array.isRequired, // only selectedSongs from musician DB
  actData: PropTypes.object,
  favourites: PropTypes.array.isRequired,
  toggleFavourite: PropTypes.func.isRequired,
};

export default MusicianRepertoire;