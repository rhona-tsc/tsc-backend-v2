import React from "react";
import PropTypes from "prop-types";
import { assets } from "../assets/assets";
import Title from "./Title";

const setlistDescriptions = {
  smallTailoring:
    " performs our signature setlist that we know works brilliantly with any audience.",
  mediumTailoring:
    " blends client favourites with our signature hits — usually around 50% client picks, 50% proven crowd-pleasers.",
  largeTailoring:
    " endeavours to accommodate as many client suggestions as possible — typically 90–100% of the set is built from client suggestions.",
};

const MusicianSongSuggestions = ({
  favourites,
  actData,
  toggleFavourite,
}) => {
  return (
    <div className="w-full bg-white">
      <div className="sticky top-0 bg-white z-10 pb-1">
        <div className="text-2xl">
          <Title text1="YOUR" text2="SHORTLIST" />
        </div>
        <p className="mb-4 p-3 text-[17px] text-gray-600">
          {(() => {
            const name =
              [`${actData?.firstName || ""}`]
                .join(" ")
                .trim() || actData?.tscName || "This musician";
            const tail =
              "Gather your favourite songs here";
            return (
              <>
                
                {tail}
              </>
            );
          })()}
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
            {(() => {
              const name =
                [`${actData?.firstName || ""}}`]
                  .join(" ")
                  .trim() || actData?.tscName || "the performer";
              return (
                <>Heart your preferred tunes to add them to the shortlist.</>
              );
            })()}
          </p>
        ) : (
          <ul className="list-inside space-y-1">
            {favourites.map((song, idx) => (
              <li
                key={`${song.title}-${song.artist}-${idx}`}
                className="flex justify-between items-center group text-sm text-gray-800 bg-white p-2 rounded border border-gray-200 hover:bg-gray-100 transition-colors duration-150"
              >
                <span>
                  {song.title} – {song.artist}
                </span>
                <button
                  onClick={() => {
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
        <div className="mt-4 border border-gray-300 rounded p-4 bg-gray-50">
          <p className="text-sm text-gray-800 mb-2">
            You have {favourites.length} shortlisted song{favourites.length > 1 ? "s" : ""}.
          </p>

          {/* Copyable list */}
        

          <div className="flex items-center gap-2">
            <button
              type="button"
              className="px-3 py-2 text-sm bg-black text-white rounded hover:bg-[#ff6667]"
              onClick={async () => {
                const text = favourites
                  .map((s, i) => `${i + 1}. ${s.title} – ${s.artist}`)
                  .join("\n");
                try {
                  await navigator.clipboard.writeText(text);
                  alert("Song list copied to clipboard.");
                } catch (e) {
                  // Fallback if clipboard permissions fail
                  window.prompt("Copy the list:", text);
                }
              }}
            >
              Copy list
            </button>

            <button
              type="button"
              className="px-3 py-2 text-sm bg-black text-white rounded hover:bg-[#ff6667]"
              onClick={() => {
                const text = favourites
                  .map((s, i) => `${i + 1}. ${s.title} – ${s.artist}`)
                  .join("\n");
                const win = window.open("", "_blank");
                if (!win) return;
                win.document.write(`<!doctype html>
                  <html>
                    <head>
                      <meta charset="utf-8" />
                      <title>Shortlisted Songs</title>
                      <style>
                        body { font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, \"Apple Color Emoji\", \"Segoe UI Emoji\"; margin: 32px; }
                        h1 { font-size: 18px; margin-bottom: 12px; }
                        pre { white-space: pre-wrap; font-size: 14px; }
                      </style>
                    </head>
                    <body>
                      <h1>Shortlisted Songs</h1>
                      <pre>${text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</pre>
                      <script>window.onload = () => window.print();<\/script>
                    </body>
                  </html>`);
                win.document.close();
              }}
            >
              Download / Print PDF
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

MusicianSongSuggestions.propTypes = {
  favourites: PropTypes.array.isRequired,
  actData: PropTypes.object,
  toggleFavourite: PropTypes.func.isRequired,
};

export default MusicianSongSuggestions;