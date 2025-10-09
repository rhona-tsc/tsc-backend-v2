import React, { useContext, useState, useEffect } from "react";
import axios from "axios";
import { ShopContext } from "../context/ShopContext";
import Title from "./Title";
import ActItem from "./ActItem";

const BestSeller = () => {
  const [bestSeller, setBestSeller] = useState([]);
  const {
    acts,
    userId,
    shortlistAct,
    shortlistItems,
    setShortlistedActs,
    isShortlisted,  
  } = useContext(ShopContext);

  

  // Build bestsellers with fallback
  useEffect(() => {
    const list = Array.isArray(acts) ? acts : [];
    const approvedActs = list.filter(
      (a) => a?.status === "approved" || a?.status === "Approved, changes pending"
    );

    // Accept either 'bestseller' or 'bestSeller' flags
    let flagged = approvedActs.filter(
      (a) => Boolean(a?.bestseller) || Boolean(a?.bestSeller)
    );

    // Fallback: if nothing flagged, pick by timesShortlisted desc, else first 5
    if (flagged.length === 0) {
      const byPopularity = [...approvedActs].sort(
        (A, B) => (B?.timesShortlisted || 0) - (A?.timesShortlisted || 0)
      );
      flagged = byPopularity.slice(0, 5);
    } else {
      flagged = flagged.slice(0, 5);
    }

    // Trace what was chosen
    // (Open DevTools > Console to see this once after load)
    console.debug("[BestSeller] chosen", flagged.map(a => ({
      id: a?._id, name: a?.tscName || a?.name, bestseller: a?.bestseller ?? a?.bestSeller,
      timesShortlisted: a?.timesShortlisted
    })));

    setBestSeller(flagged);
  }, [acts]);

  return (
    <div className="my-10">
      <div className="text-center text-3xl py-8">
        <Title text1={"YOUR"} text2={"FAVES"} />
        <p className="w-3/4 m-auto text-xs sm:text-sm md:text-base text-gray-600">
          Make your life as easy as possible. Cut to the chase and book the
          cream of the crop.
        </p>
      </div>

      {bestSeller.length === 0 ? (
        <p className="text-center text-sm text-gray-500">No featured acts yet.</p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4 gap-y-6">
          {bestSeller.map((item) => (
           <ActItem
  key={item._id}
  actData={item}
  isShortlisted={isShortlisted(item._id)}
  onShortlistToggle={() => shortlistAct(userId, item._id)}
  price={item.formattedPrice}
/>
          ))}
        </div>
      )}
    </div>
  );
};

export default BestSeller;