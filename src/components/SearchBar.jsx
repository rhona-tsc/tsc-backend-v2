import React, { useState, useContext } from 'react';
import { useNavigate } from 'react-router-dom';
import { ShopContext } from '../context/ShopContext';
import GoogleAutocomplete from './GoogleAutocomplete';
import calculateActPricing from '../pages/utils/pricing';

const SearchBar = () => {
  const { acts } = useContext(ShopContext);
  const [county, setCounty] = useState('');
  const [filteredActs, setFilteredActs] = useState([]);
  const navigate = useNavigate();
  const [localAddress, setLocalAddress] = useState("");
  const [localDate, setLocalDate] = useState("");

  const handleSearch = async () => {
    sessionStorage.setItem("selectedAddress", localAddress);
    sessionStorage.setItem("selectedDate", localDate);
    sessionStorage.setItem("selectedCounty", county);

    if (!localAddress.trim()) {
      alert("Please enter a venue address.");
      return;
    }
    if (!localDate.trim()) {
      alert("Please select a date.");
      return;
    }
    if (!county.trim()) {
      alert("Please wait for the venue to be selected or try again.");
      return;
    }

    // Filter acts based on the selected county
    const updatedActs = await Promise.all(
      acts.map(async (act) => ({
        ...act,
        formattedPrice: await calculateActPricing(act, county, localAddress, localDate),
      }))
    );

    setFilteredActs(updatedActs);

    navigate('/acts', {
      state: {
        county,
        selectedAddress: localAddress,
        selectedDate: localDate,
      },
    });
          window.scrollTo({ top: 0, left: 0 }); // or just window.scrollTo(0,0)

  };

  return (
    <section className="w-full bg-black py-6">
      <div className="mx-auto max-w-6xl px-4">
        {/* Row 1: Title */}
        <div className="mb-4">
          <h2 className="text-white text-3xl sm:text-4xl font-semibold">Quick Search</h2>
        </div>

        {/* Row 2: Controls (wrap on small screens) */}
        <div className="flex flex-wrap items-end gap-4">
          {/* Date */}
          <div className="flex-1 min-w-[220px]">
            <label className="block text-white text-xs sm:text-sm mb-1" htmlFor="qs-date">DATE</label>
            <input
              id="qs-date"
              type="date"
              className="w-full border-2 border-gray-300 p-2 shadow-sm text-gray-700 rounded"
              value={localDate}
              onChange={(e) => setLocalDate(e.target.value)}
              min={new Date().toISOString().split('T')[0]}
            />
          </div>

          {/* Venue */}
          <div className="flex-[2] min-w-[260px]">
            <label className="block text-white text-xs sm:text-sm mb-1" htmlFor="qs-venue">VENUE</label>
            <GoogleAutocomplete
              setAddress={setLocalAddress}
              setCounty={setCounty}
              className="w-full text-base px-3 py-2 border-2 border-gray-300 rounded"
              placeholder="Start typing your venue..."
              inputId="qs-venue"
            />
          </div>

          {/* Search button */}
          <div className="w-full sm:w-auto">
            <button
              type="button"
              onClick={handleSearch}
              className="w-full sm:w-auto px-6 py-3 bg-[#ff6667] hover:opacity-90 text-white font-medium rounded transition"
            >
              SEARCH
            </button>
          </div>
        </div>
      </div>
    </section>
  );
};

export default SearchBar;