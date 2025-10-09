import React, { useContext, useEffect, useState } from 'react';
import Title from './Title';
import { ShopContext } from '../context/ShopContext';
import ActItem from './ActItem';
import axios from 'axios';


const RelatedActs = ({ genres = [], instruments = [], vocalist = "", currentActId }) => {
  
    const [related, setRelated] = useState([]);
 const { acts, userId, isShortlisted, shortlistAct, shortlistitems } = useContext(ShopContext);          const backendUrl = import.meta.env.VITE_BACKEND_URL;

    const [shortlistedActs, setShortlistedActs] = useState([]);
    const [selectedCounty, setSelectedCounty] = useState(() => {
        return sessionStorage.getItem("selectedCounty")?.trim() || '';
    });

    // Helper to get shortlist fcount for an act from sessionStorage (or default to 0)
const getShortlistCountForAct = (actId) => {
  return shortlistedActs.includes(actId) ? 1 : 0;
};

const [isDesktop, setIsDesktop] = useState(
  typeof window !== "undefined"
    ? window.matchMedia("(min-width: 1024px)").matches
    : true
);

useEffect(() => {
  if (typeof window === "undefined") return;
  const mq = window.matchMedia("(min-width: 1024px)");
  const onChange = (e) => setIsDesktop(e.matches);
  try {
    mq.addEventListener("change", onChange);
  } catch {
    // Safari
    mq.addListener(onChange);
  }
  return () => {
    try {
      mq.removeEventListener("change", onChange);
    } catch {
      mq.removeListener(onChange);
    }
  };
}, []);

const itemsToRender = isDesktop ? related : related.slice(0, 4);



    // ✅ Function to calculate price (mirroring NewActs/BestSeller essential member pricing)
    const calculatePrice = (act) => {
      if (!act || !Array.isArray(act.lineups)) return null;

      const smallestLineup = act.lineups.reduce((smallest, current) => {
        return (current.bandMembers?.length || 0) < (smallest?.bandMembers?.length || Infinity) ? current : smallest;
      }, null);

      if (!smallestLineup || !Array.isArray(smallestLineup.bandMembers)) return null;

      const essentialFees = smallestLineup.bandMembers.flatMap((member) => {
        const baseFee = member.isEssential ? Number(member.fee) || 0 : 0;
        const additionalEssentialFees = (member.additionalRoles || [])
          .filter((role) => role.isEssential)
          .map((role) => Number(role.additionalFee) || 0);
        return [baseFee, ...additionalEssentialFees];
      });

      const totalFee = essentialFees.reduce((sum, fee) => sum + fee, 0);

      return Math.ceil(totalFee / 0.8); // Apply 20% margin
    };

    useEffect(() => {
        if (acts.length > 0 && genres.length > 0) {
            // Only include acts that are approved and not the current act
            let filteredActs = acts.filter(
                item => item._id !== currentActId && item.status === "approved"
            );

            const getGenreMatchCount = (actGenres) => {
                if (!Array.isArray(actGenres)) return 0;
                return actGenres.filter(genre => genres.includes(genre)).length;
            };

            const hasInstrumentMatch = (actInstruments) => {
                if (!Array.isArray(actInstruments)) return false;
                return actInstruments.some(inst => instruments.includes(inst));
            };

            const hasVocalistMatch = (actVocalist) => {
                if (!vocalist) return false;
                return actVocalist === vocalist;
            };

            filteredActs.sort((a, b) => {
                const genreMatchA = getGenreMatchCount(a.genre);
                const genreMatchB = getGenreMatchCount(b.genre);
                const vocalistMatchA = hasVocalistMatch(a.vocalist) ? 1 : 0;
                const vocalistMatchB = hasVocalistMatch(b.vocalist) ? 1 : 0;
                const instrumentMatchA = hasInstrumentMatch(a.instruments) ? 1 : 0;
                const instrumentMatchB = hasInstrumentMatch(b.instruments) ? 1 : 0;

                return (genreMatchB - genreMatchA) || (vocalistMatchB - vocalistMatchA) || (instrumentMatchB - instrumentMatchA);
            });

            // ✅ Apply price calculation
            const updatedRelated = filteredActs.slice(0, 5).map(act => ({
                ...act,
                formattedPrice: calculatePrice(act)
            }));

            setRelated(updatedRelated);
        }
    }, [acts, genres, instruments, vocalist, currentActId, selectedCounty]);

    return (
        <div>
            <div className='text-center text-3xl py-2 mt-12'>
                <Title text1={"SIMILAR"} text2={"ACTS"} />
            </div>

            <div className='grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4'>
           {itemsToRender.length > 0 ? (
  itemsToRender.map((item, index) => (
                 <ActItem
  key={item._id}
  actData={item}
  isShortlisted={isShortlisted(item._id)}
  onShortlistToggle={() => shortlistAct(userId, item._id)}
  price={item.formattedPrice}
/>
                    ))
                ) : (
                    <p className="text-center text-gray-500 mt-5">No similar acts found.</p>
                )}
            </div>
        </div>
    );
};

export default RelatedActs;