import React from 'react';
import PropTypes from 'prop-types';
import { assets } from '../assets/assets';
import Title from './Title';
import CustomToast from "./CustomToast";
import { toast } from "react-toastify";

const setlistDescriptions = {
  smallTailoring: ' performs our signature setlist that we know works brilliantly with any audience.',
  mediumTailoring: ' blends client favourites with our signature hits — usually around 50% client picks, 50% proven crowd-pleasers.',
  largeTailoring: ' endeavours to accommodate as many client suggestions as possible — typically 90-100% of the set is built from client suggestions.'
};

const SongSuggestions = ({ favourites, actData, toggleFavourite, addToCart }) => {
  return (
    <div className="w-full bg-white">
      <div className="sticky top-0 bg-white z-10 pb-1">
          <div className="text-2xl">
            <Title text1="YOUR" text2="SUGGESTIONS" /> 
          </div>      
        <p className="mb-4 p-3 text-[17px] text-gray-600"> 
          {actData?.tscName}
          {setlistDescriptions[actData?.setlist] || ' performs a great mix of client requests and band favourites.'}
        </p>
      </div>
    <div className="border border-gray-300 rounded p-4 max-h-[319px] overflow-y-scroll">
      {favourites.length === 0 ? (
        <p className="italic text-gray-500 flex items-center gap-2 ">
          <img
            src={assets.heart_icon}
            alt="Song shortlisted"
            className="w-4 h-4 md:w-5 md:h-5"
          />
          Heart your favourite tunes, add them to your cart, and we’ll pass them to {actData?.tscName || 'the band'} upon booking.
        </p>
      ) : (
        <ul className="list-inside space-y-1">
          {favourites.map((song, idx) => (
            <li
              key={`${song.title}-${song.artist}-${idx}`}
              className="flex justify-between items-center group text-sm text-gray-800 bg-white p-2 rounded border border-gray-200 hover:bg-gray-100 transition-colors duration-150"
            >
              <span>{song.title} – {song.artist}</span>
              <button
                onClick={() => {
                  console.log("❌ Removing song:", song);
                  toggleFavourite(song);
                }}
                className="text-gray-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity duration-200"
                aria-label="Remove from favourites"
              >
                &#x2715;
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
    {favourites.length > 0 && (
      <div className="mt-4 border border-gray-300 rounded p-4 bg-gray-50 flex justify-between items-center">
        <p className="text-sm text-gray-800">
          Add these {favourites.length} suggested song{favourites.length > 1 ? 's' : ''} to the cart
        </p>
          <img
            src={assets.add_to_cart_icon}
            alt="Add to cart"
            className="w-6 cursor-pointer"
            onClick={() => {
              if (addToCart) {
                // Add empty selectedAfternoonSets as new param
                addToCart(actData._id, actData.lineups?.[0]?._id, [], [], favourites);
                toast(<CustomToast type="success" message="Suggested songs added to cart!" />, {
                  position: "top-right",
                  autoClose: 2000,
                });
              }
            }}
          />
      </div>
    )}
    </div>
  );
};

SongSuggestions.propTypes = {
  favourites: PropTypes.array.isRequired,
  actData: PropTypes.object,
  toggleFavourite: PropTypes.func.isRequired,
  addToCart: PropTypes.func.isRequired,
};

export default SongSuggestions;
