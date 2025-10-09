// frontend/src/components/RelatedMusicians.jsx
import React, { useEffect, useState } from "react";
import Title from "./Title";
import axios from "axios";

/**
 * Musicians PERFORMED WITH (co-booked on same gigs)
 *
 * Backend expectation (any one of these may exist; we try them in order):
 *   GET /api/musician/performed-with/:musicianId
 *   GET /api/musicians/performed-with/:musicianId
 *
 * Response shape:
 *   { musicians: [ { _id, firstName, lastName, tscName, profilePicture, additionalImages, instrumentation } ] }
 *   or directly an array of musicians
 */
const RelatedMusicians = ({ currentActId }) => {
  const [performedWith, setPerformedWith] = useState([]);
  const [loading, setLoading] = useState(true);
  const backendUrl = import.meta.env.VITE_BACKEND_URL || "";

  useEffect(() => {
    let abort = false;

    const fetchPerformedWith = async () => {
      if (!currentActId) {
        setPerformedWith([]);
        setLoading(false);
        return;
      }

      setLoading(true);

      const base = backendUrl ? backendUrl.replace(/\/$/, "") : "";
      const tryUrls = [
        `${base}/api/musician/performed-with/${currentActId}`,
        `${base}/api/musicians/performed-with/${currentActId}`,
        `/api/musician/performed-with/${currentActId}`,
        `/api/musicians/performed-with/${currentActId}`,
      ];

      for (const url of tryUrls) {
        try {
          const { data } = await axios.get(url);
          if (abort) return;
          const list = Array.isArray(data?.musicians)
            ? data.musicians
            : Array.isArray(data)
            ? data
            : [];
          setPerformedWith(list);
          setLoading(false);
          return; // success
        } catch (e) {
          // try next URL
        }
      }

      if (!abort) {
        setPerformedWith([]);
        setLoading(false);
      }
    };

    fetchPerformedWith();
    return () => {
      abort = true;
    };
  }, [backendUrl, currentActId]);

  const displayName = (m) =>
    [`${m?.firstName || ""}`, `${m?.lastName || ""}`].join(" ").trim() ||
    m?.tscName ||
    "Musician";

  const displayImage = (m) =>
    m?.profilePicture ||
    (Array.isArray(m?.additionalImages) ? m.additionalImages[0] : "") ||
    "";

  const toMusicianHref = (m) => `/musician/${m?._id}`;

  return (
    <div>
      <div className="text-center text-3xl py-2 mt-12">
        <Title text1={"MUSICIANS"} text2={"PERFORMED WITH"} />
      </div>

      {loading ? (
        <p className="text-center text-gray-500 mt-5">Loading…</p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4 gap-y-6">
          {performedWith.length > 0 ? (
            performedWith.map((m) => {
              const img = displayImage(m);
              const name = displayName(m);
              return (
                <a
                  key={m._id}
                  href={toMusicianHref(m)}
                  className="block group border rounded overflow-hidden bg-white hover:shadow-md transition-shadow"
                >
                  <div
                    className="w-full aspect-[4/3] bg-gray-100 overflow-hidden"
                    aria-hidden="true"
                  >
                    {img ? (
                      <img
                        src={img}
                        alt={name}
                        className="w-full h-full object-cover group-hover:scale-[1.02] transition-transform"
                        loading="lazy"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-gray-400 text-sm">
                        No image
                      </div>
                    )}
                  </div>
                  <div className="p-3">
                    <div className="font-medium text-gray-900 line-clamp-1">
                      {name}
                    </div>
                    {Array.isArray(m?.instrumentation) &&
                      m.instrumentation.length > 0 && (
                        <div className="text-xs text-gray-500 mt-1 line-clamp-1">
                          {m.instrumentation
                            .map((i) => i?.instrument)
                            .filter(Boolean)
                            .join(", ")}
                        </div>
                      )}
                  </div>
                </a>
              );
            })
          ) : (
            <p className="text-center text-gray-500 mt-5">
              No co-performers found yet.
            </p>
          )}
        </div>
      )}
    </div>
  );
};

export default RelatedMusicians;