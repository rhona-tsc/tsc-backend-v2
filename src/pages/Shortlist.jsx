import React, { useContext, useEffect, useLayoutEffect, useState } from 'react';
import { ShopContext } from '../context/ShopContext';
import ShortlistItem from './ShortlistItem';
import axios from 'axios';
import ShortlistPreviewPanel from './ShortlistPreviewPanel';
import Title from '../components/Title';
import { useNavigate } from 'react-router-dom';

// ✅ Race-safe list fetch hook for an array of IDs
function useStableFetchList(ids, fetchById, options = {}) {
  const { onEmpty = () => {} } = options;
  const [data, setData] = useState([]);

  useEffect(() => {
    let cancelled = false;

    // No ids → clear data immediately
    if (!ids || ids.length === 0) {
      setData([]);
      onEmpty();
      return;
    }

    (async () => {
      try {
        const results = await Promise.all(ids.map((id) => fetchById(id)));
        if (!cancelled) setData(results);
      } catch (err) {
        if (!cancelled) {
          console.error('❌ Error fetching list:', err);
          setData([]);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [JSON.stringify(Array.from(new Set(ids)))]); // stringify for stable dependency with deduplication

  return [data, setData];
}

const Shortlist = () => {
  const {
    shortlistItems,
    shortlistedActs,
    userId,
    shortlistAct,
    selectedDate,
    selectedAddress,
    setShowSearch,
    isActUnavailableForSelectedDate,
    availLoading,
  } = useContext(ShopContext);

  // Always prefer the canonical list if present; fall back otherwise
  const shortlistIds = React.useMemo(() => {
    if (Array.isArray(shortlistedActs) && shortlistedActs.length >= 0) return [...shortlistedActs];
    return Array.isArray(shortlistItems) ? [...shortlistItems] : [];
  }, [shortlistedActs, shortlistItems]);

  const navigate = useNavigate();

  // Always start at the top when navigating to Shortlist
  useLayoutEffect(() => {
    // temporarily override browser scroll restoration for this view
    let prevRestoration;
    if (typeof window !== 'undefined' && 'scrollRestoration' in window.history) {
      prevRestoration = window.history.scrollRestoration;
      window.history.scrollRestoration = 'manual';
    }

    // Jump to the top synchronously before paint
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });

    return () => {
      // restore previous behavior on unmount
      if (typeof window !== 'undefined' && 'scrollRestoration' in window.history && prevRestoration) {
        window.history.scrollRestoration = prevRestoration;
      }
    };
  }, []);

  const [hoveredAct, setHoveredAct] = useState(null);
  // Track items currently animating out so we can keep them in the DOM until the fade completes
  const [removingIds, setRemovingIds] = useState(new Set());
  const isShortlisted = (actId) => shortlistIds.includes(actId);
  const [sortType, setSortType] = useState('relavent');
  const storedPlace = sessionStorage.getItem('selectedPlace') || '';

  // 🔹 Purge any stale shortlist caches when this page mounts (once)
  useEffect(() => {
    const keys = Object.keys(sessionStorage);
    for (const k of keys) {
      if (k === 'shortlistCache') {
        sessionStorage.removeItem(k);
      }
    }
  }, []);

  const [actsData, setActsData] = useStableFetchList(
    shortlistIds,
    (id) => axios.get(`/api/acts/${id}`).then((res) => res.data),
    { onEmpty: () => setHoveredAct(null) }
  );

  // 🔍 Hide acts that are explicitly unavailable for the currently selected date
  const visibleShortlist = React.useMemo(() => {
    // keep items that are fading out so their animation can complete
    const base = actsData.filter(
      (item) => shortlistIds.includes(item._id) || removingIds.has(item._id)
    );
    return selectedDate
      ? base.filter((item) => !isActUnavailableForSelectedDate(item._id))
      : base;
  }, [actsData, shortlistIds, removingIds, selectedDate, isActUnavailableForSelectedDate]);

  const formatDate = (dateString) => {
    if (!dateString) return '';
    const date = new Date(dateString);
    const day = date.getDate();
    const month = date.toLocaleString('en-GB', { month: 'long' });
    const year = date.getFullYear();
    const suffix = ['th', 'st', 'nd', 'rd'][(day % 10 > 3) ? 0 : (day % 100 - day % 10 !== 10) * (day % 10)];
    return `${day}${suffix} of ${month} ${year}`;
  };

  // Placeholder declarations for cart, paMap, lightMap
  const cart = {};
  const paMap = {};
  const lightMap = {};

  const triggerSearch = () => {
    setShowSearch(true);  // ✅ Open the search box
    navigate('/shortlist');
  };

  return (
    <div>
      <div className="flex-1">
        <div className="flex justify-left text-base justify-between sm:text-2xl mb-4 mt-10 pt-10">
          <Title text1={'YOUR'} text2={'SHORTLIST'} />
          <div className="flex text-base sm:text-2xl justify-between gap-6">
            <select
              className="border-2 border-gray-300 text-sm px-2"
              onChange={(e) => setSortType(e.target.value)}
              value={sortType}
            >
              <option value="relevent">Sort by: Relevant</option>
              <option value="low-high">Sort by: Low to High</option>
              <option value="high-low">Sort by: High to Low</option>
            </select>
          </div>
        </div>

        {/* ✅ Now dynamically shows selected date & address */}
        <div>
          {selectedDate && selectedAddress ? (
            <p className="text-sm mt-3 justify-right p-2 text-gray-500">
              Showing Results for:
              <span className="text-gray-700">
                {' '}
                {formatDate(selectedDate)} at {storedPlace && `${storedPlace}, `}{selectedAddress}
              </span>
              <span onClick={triggerSearch} className="text-blue-600 cursor-pointer underline ml-2">
                edit search
              </span>
            </p>
          ) : (
            <p className="text-sm mt-3 justify-right p-2 text-gray-500">
              Please select a date and location for an accurate quote!
              <span onClick={triggerSearch} className="text-blue-600 cursor-pointer underline ml-2">
                Begin Search
              </span>
            </p>
          )}
        </div>
      </div>

      <div className="flex">
        {/* Left: shortlist items */}
<div className="w-full lg:w-[50%] p-6">
  <div className="flex flex-wrap gap-4">
    {/* Availability status bar while we load the map for the selected date */}
    {selectedDate && availLoading && (
      <div className="p-4 text-center text-gray-600">Checking availability…</div>
    )}

    {visibleShortlist.length > 0 ? (
      visibleShortlist.map((item, index) =>
        item && item.lineups && item.lineups.length > 0 ? (
          <div
            key={item._id || index}
            className={
              'transition-all duration-300 ease-out ' +
              (removingIds.has(item._id)
                ? 'opacity-0 scale-95 translate-y-1 pointer-events-none'
                : 'opacity-100 scale-100')
            }
          >
            <ShortlistItem
              actData={item}
              _id={item._id}
              actId={item._id}
              userId={userId}
              shortlistCount={item.timesShortlisted || 0}
              isShortlisted={isShortlisted(item._id)}
              onShortlistToggle={async () => {
                if (removingIds.has(item._id)) return; // prevent duplicate timers
                // Start fade-out immediately
                setRemovingIds((prev) => new Set([...prev, item._id]));

                // Perform the toggle in context/backend right away
                await shortlistAct(userId, item._id);

                // After the animation, remove from local list and cleanup
                setTimeout(() => {
                  setActsData((prev) => {
                    // If the context still says it is shortlisted, keep it (server echo), otherwise drop it
                    const stillShortlisted = shortlistIds.includes(item._id);
                    return stillShortlisted ? prev : prev.filter((a) => a._id !== item._id);
                  });
                  setHoveredAct((prev) => (prev?.actId === item._id ? null : prev));
                  setRemovingIds((prev) => {
                    const next = new Set(prev);
                    next.delete(item._id);
                    return next;
                  });
                }, 300);
              }}
              price={item.formattedPrice}
              onMouseEnter={() => {
                setHoveredAct((prev) => {
                  if (prev?.actId === item._id) return prev;
                  return {
                    actData: item,
                    actId: item._id,
                    tscBio: item.bio,
                    isInCart: cart?.[item._id] ?? false,
                    cartItems: cart,
                    setSelectedLineup: (lineup) =>
                      setHoveredAct((prevState) => ({ ...prevState, selectedLineup: lineup })),
                    setFormattedPrice: (price) =>
                      setHoveredAct((prevState) => ({ ...prevState, formattedPrice: price })),
                    finalTravelPrice: item.finalTravelPrice || null,
                    paMap,
                    lightMap,
                  };
                });
              }}
            />
          </div>
        ) : null
      )
    ) : (
      <div className="p-6 text-center text-gray-600">
        {selectedDate
          ? 'No shortlisted acts are available for your date.'
          : 'Your shortlist is empty. Start adding your favorite acts!'}
      </div>
    )}
  </div>
</div>

        {/* Right: preview panel */}
       <div
  className={`
    hidden lg:block              /* ← hide on < lg */
    lg:w-[50%] p-4 border-l min-h-screen
    transition-all duration-300 ease-in-out
    ${hoveredAct ? 'opacity-100 translate-x-0 pointer-events-auto' : 'opacity-50 pointer-events-none'}
  `}
>
  {hoveredAct ? (
    <ShortlistPreviewPanel hoveredAct={hoveredAct} />
  ) : (
    <p className="text-gray-500 text-center mt-20">Hover over a shortlist item to preview details</p>
  )}
</div>
      </div>
    </div>
  );
};

export default Shortlist;
