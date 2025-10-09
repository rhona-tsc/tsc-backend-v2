import React, { useState } from "react";

const HereAutocomplete = ({ setPlace }) => {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const HERE_API_KEY = "8m6eSQnVVciM5Q5HrbjhRACNu4rDCNyXi4uK01UcgFs"; // 🔑 Replace with your HERE API Key

  const handleSearch = async () => {
    if (query.length < 3) return;

    const response = await fetch(
      `https://autocomplete.search.hereapi.com/v1/autocomplete?q=${query}&apiKey=${HERE_API_KEY}`
    );
    const data = await response.json();

    setResults(data.items);
  };

  return (
    <div>
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Enter your address"
        className="border px-3 py-2 w-full"
      />
      <button className="bg-blue-500 text-white px-3 py-2" onClick={handleSearch}>
        Search
      </button>

      {results.length > 0 && (
        <ul className="border mt-2">
          {results.map((place) => (
            <li
              key={place.id}
              className="cursor-pointer p-2 hover:bg-gray-200"
              onClick={() => setPlace(place)}
            >
              {place.title}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default HereAutocomplete;