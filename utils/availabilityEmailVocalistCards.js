const escapeHtml = (value = "") =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const renderVideos = (name, videos = []) => {
  if (!Array.isArray(videos) || !videos.length) return "";
  return `
    <div style="margin:10px 0 0;">
      <p style="margin:0 0 6px; color:#555; font-weight:600;">Watch ${escapeHtml(name)}:</p>
      <ul style="margin:0; padding-left:18px;">
        ${videos
          .slice(0, 4)
          .map(
            (video, index) => `
              <li style="margin:4px 0;">
                <a href="${escapeHtml(video?.url || "")}" style="color:#ff6667; text-decoration:none;">
                  ${escapeHtml(video?.title || `Video ${index + 1}`)}
                </a>
              </li>
            `,
          )
          .join("")}
      </ul>
    </div>
  `;
};

export const renderAvailabilityVocalistCards = ({
  cards = [],
  heading = "Meet",
  includeRepertoire = false,
} = {}) =>
  cards
    .map((card = {}) => {
      const hasProfileContent =
        card.profileUrl || card.photoUrl || card.videos?.length;
      if (!hasProfileContent) return "";

      const name = card.shortName || card.name || "Vocalist";
      const fullName = card.name || name;
      const possessivePronoun = card.possessivePronoun || "their";

      return `
        <div style="margin:20px 0; border-top:1px solid #eee; padding-top:15px;">
          <h3 style="color:#111; margin-bottom:10px;">${escapeHtml(heading)} ${escapeHtml(name)}</h3>
          ${
            card.photoUrl
              ? card.profileUrl
                ? `
                  <a href="${escapeHtml(card.profileUrl)}" style="text-decoration:none;">
                    <img
                      src="${escapeHtml(card.photoUrl)}"
                      alt="${escapeHtml(fullName)}"
                      style="width:160px; height:160px; border-radius:50%; object-fit:cover; margin-bottom:10px; display:block;"
                    />
                  </a>
                `
                : `
                  <img
                    src="${escapeHtml(card.photoUrl)}"
                    alt="${escapeHtml(fullName)}"
                    style="width:160px; height:160px; border-radius:50%; object-fit:cover; margin-bottom:10px; display:block;"
                  />
                `
              : ""
          }
          ${
            card.profileUrl
              ? `<p style="margin:6px 0 0;"><a href="${escapeHtml(card.profileUrl)}" style="color:#ff6667; font-weight:600; text-decoration:none;">View ${escapeHtml(name)}&#39;s profile →</a></p>`
              : ""
          }
          ${renderVideos(name, card.videos)}
          ${
            includeRepertoire
              ? `
                <p style="margin:8px 0 0; color:#555;">
                  <strong>${escapeHtml(name)}</strong>${card.repertoireCount ? ` has <strong>${Number(card.repertoireCount)} songs</strong> in ${escapeHtml(possessivePronoun)} repertoire` : " has an extensive repertoire"}, and you’re very welcome to ${card.profileUrl ? `<a href="${escapeHtml(card.profileUrl)}" style="color:#ff6667; font-weight:600; text-decoration:none;">take a browse</a>` : "take a browse"} and suggest your favourites for ${escapeHtml(name)} and the band to perform.
                </p>
                <p style="margin:8px 0 0; color:#555;">
                  ${escapeHtml(name)}’s repertoire will form the basis of the band’s setlist for your event. If there are particular songs from the band’s original repertoire that you were hoping to hear, please let us know—${escapeHtml(name)} will do ${escapeHtml(possessivePronoun)} very best to accommodate your favourites.
                </p>
              `
              : ""
          }
        </div>
      `;
    })
    .join("");
