import React, { useContext, useEffect, useState } from 'react';
import { ShopContext } from '../context/ShopContext';
import { assets } from '../assets/assets';
import { useLocation } from 'react-router-dom';
import GoogleAutocomplete from './GoogleAutocomplete';

const SearchBox = () => {
  const location = useLocation();
  const { showSearch, setShowSearch, selectedAddress, setSelectedAddress, selectedDate, setSelectedDate } = useContext(ShopContext);
  const [localAddress, setLocalAddress] = useState("");
  const [localDate, setLocalDate] = useState("");
  const [county, setCounty] = useState("");
  const [animate, setAnimate] = useState(false);

  // ✅ Sync local state with stored address & date on mount
  useEffect(() => {
    setLocalAddress(selectedAddress || "");
    setLocalDate(selectedDate || "");
  }, [selectedAddress, selectedDate]);



  useEffect(() => {
    if (location.pathname !== "/acts" && showSearch) {
      setAnimate(false); // Start closing animation
  
      setTimeout(() => {
        setShowSearch(false); // Close search box after animation
      }, 300); // Adjust timing to match animation duration
    }
  }, [location.pathname, showSearch]);

useEffect(() => {
  if (showSearch) {
    setAnimate(true);
  }
}, [showSearch]);

  const handleClose = () => {
    setAnimate(false);
    setTimeout(() => {
      setShowSearch(false);
    }, 500);
  };

  const handleSearch = () => {
    if (!localAddress.trim()) {
      alert("Please enter a venue address.");
      return;
    }

    if (!localDate.trim()) {
      alert("Please select a date.");
      return;
    }


    setSelectedAddress(localAddress);
    setSelectedDate(localDate);

    sessionStorage.setItem("selectedAddress", localAddress);
    sessionStorage.setItem("selectedDate", localDate);

    handleClose();
  };

  return (showSearch || animate) ? (
    <div className={`fixed top-16 left-0 right-0 border-t border-b bg-gray-50 text-center shadow-md z-50 py-4 
      transition-all duration-500 ${animate ? 'opacity-100 scale-100' : 'opacity-0 scale-95'}`}>

      <div className='flex flex-col sm:flex-row items-center justify-center gap-4 px-5'>

        {/* Date Picker */}
        <div className='flex items-center gap-2'>
          <p className='font-medium text-sm text-gray-700'>DATE</p>
          <input 
            type="date" 
            className='border-2 border-gray-300 p-2 text-gray-500'
            value={localDate}
            onChange={(e) => setLocalDate(e.target.value)}
            min={new Date().toISOString().split("T")[0]} 
            required
          />
        </div>

        {/* Google Autocomplete */}
        <div className='flex items-center gap-2'>
          <p className='font-medium text-sm text-gray-700'>VENUE</p>
          <GoogleAutocomplete setAddress={setLocalAddress} setCounty={setCounty} initialValue={localAddress} className="text-base px-3 py-2 w-72 border-2 border-gray-300" placeholder="Start typing your venue..." required/>
        </div>

        {/* Search Button */}
        <button
          className="px-6 py-2 bg-[#ff6667] text-white hover:bg-[#ff3333] transition duration-300"
          onClick={handleSearch}
        >
          SEARCH
        </button>

        {/* Close Button */}
        <img 
          onClick={handleClose} 
          className='w-4 cursor-pointer' 
          src={assets.cross_icon} 
          alt="Close"
        />
      </div>
    </div>
  ) : null;
};

export default SearchBox;