import React, { useState, useEffect } from 'react';
import PropTypes from 'prop-types';

// import { assets } from '../assets/assets';

const pickHeroImageFromMusician = (m) => {
  if (!m) return '';
  if (m.coverHeroImage) return m.coverHeroImage;
  if (Array.isArray(m.additionalImages) && m.additionalImages[0]) return m.additionalImages[0];
  const wardrobes = [
    'digitalWardrobeBlackTie',
    'digitalWardrobeFormal',
    'digitalWardrobeSmartCasual',
    'digitalWardrobeSessionAllBlack',
  ];
  for (const key of wardrobes) {
    const arr = m[key];
    if (Array.isArray(arr) && arr.length && arr[0]) return arr[0];
  }
  return '';
};

const pickSubtitleFromMusician = (m) => {
  if (!m) return '';
  if (m.tagLine) return m.tagLine;
  if (Array.isArray(m.instrumentation) && m.instrumentation.length) {
    const instruments = m.instrumentation
      .map((i) => i?.instrument)
      .filter(Boolean)
      .slice(0, 4)
      .join(' • ');
    if (instruments) return instruments;
  }
  if (m.bio) {
    const t = String(m.bio);
    return t.length > 140 ? t.slice(0, 137) + '…' : t;
  }
  return '';
};

const MusicianHero = ({
  musicianId,
  musicians = [],
  hideHeart = true,
  actId,
  acts = [],
}) => {
  const [musician, setMusician] = useState(null);

  const resolvedId = musicianId || actId || null;
  const resolvedList = Array.isArray(musicians) && musicians.length ? musicians : acts;

  useEffect(() => {
    let mounted = true;

    // 1) Try provided list first
    const fromList =
      Array.isArray(resolvedList) &&
      resolvedList.find((item) => String(item?._id) === String(resolvedId));

    if (fromList) {
      if (mounted) setMusician(fromList);
      return () => { mounted = false; };
    }

    // 2) Otherwise fetch by id from API (try a few possible endpoints)
    const fetchMusician = async () => {
      if (!resolvedId) return;

      const base = (import.meta.env.VITE_BACKEND_URL || '').replace(/\/$/, '');
     const urls = [
       // ✅ your working endpoint that returns a musician document
       `${base}/api/musician/profile/${resolvedId}`,
       // Other common shapes, in case you add them later
        `${base}/api/musicians/${resolvedId}`,
       `${base}/api/musician/${resolvedId}`,
       // auth-required admin route (will 401 on public)
              `${base}/api/musician/moderation/deputy/${resolvedId}`      ];
    

      for (const url of urls) {
        try {
          const res = await fetch(url, { credentials: 'include' });
          if (!res.ok) continue;
          const data = await res.json();
          const doc = data?.musician || data?.deputy || data?.act || data?.actData || data;
          if (doc && mounted) {
            setMusician(doc);
            return;
          }
        } catch {
          // try next
        }
      }

      console.error('❌ Failed to load musician: no matching endpoint for id', resolvedId);
    };

    fetchMusician();

    return () => { mounted = false; };
  }, [resolvedId, resolvedList]);

  if (!musician) return null;

  const heroImage = pickHeroImageFromMusician(musician);
  const title = (() => {
    if (musician.firstName) {
      const lastInitial = musician.lastName ? ` ${musician.lastName.charAt(0)}` : '';
      return `${musician.firstName}${lastInitial}`;
    }
    return musician.stageName || 'Musician';
  })();
  const subtitle = pickSubtitleFromMusician(musician);

  return (
    <div className="relative w-full max-w-full">
      {heroImage && (
        <div
          className="relative w-full aspect-video bg-cover bg-center flex items-center justify-center text-white rounded-md overflow-hidden"
          style={{ backgroundImage: `url(${heroImage})` }}
        >
          {!hideHeart && (
            <div className="absolute top-4 left-4 p-2 z-20 opacity-60 pointer-events-none" />
          )}
          <div className="bg-black bg-opacity-50 p-6 rounded text-center max-w-2xl flex flex-col justify-center">
            <h1 className="text-3xl sm:text-4xl lg:text-5xl font-bold leading-snug">
              {title}
            </h1>
            {subtitle && (
              <div className="flex items-center gap-2 justify-center mt-4 text-sm tracking-wider">
                <span>{subtitle}</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

MusicianHero.propTypes = {
  musicianId: PropTypes.string,
  musicians: PropTypes.arrayOf(
    PropTypes.shape({
      _id: PropTypes.string,
      firstName: PropTypes.string,
      lastName: PropTypes.string,
      tagLine: PropTypes.string,
      bio: PropTypes.string,
      profilePicture: PropTypes.string,
      additionalImages: PropTypes.arrayOf(PropTypes.string),
      instrumentation: PropTypes.arrayOf(
        PropTypes.shape({ instrument: PropTypes.string, skill_level: PropTypes.string })
      ),
      digitalWardrobeBlackTie: PropTypes.arrayOf(PropTypes.string),
      digitalWardrobeFormal: PropTypes.arrayOf(PropTypes.string),
      digitalWardrobeSmartCasual: PropTypes.arrayOf(PropTypes.string),
      digitalWardrobeSessionAllBlack: PropTypes.arrayOf(PropTypes.string),
    })
  ),
  hideHeart: PropTypes.bool,
  actId: PropTypes.string,
  acts: PropTypes.array,
};

export default MusicianHero;