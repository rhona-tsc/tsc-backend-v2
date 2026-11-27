const sections = [
  ['location_documents', 'Location & Load-in'],
  ['parking_documents', 'Parking'],
  ['room_area_documents', 'Room & Area'],
];

// Only fetch documents from the uploader's canonical storage path. Event-sheet
// answers are client input, not permission for the PDF generator to fetch arbitrary URLs.
export function getSectionAttachments(answers = {}, cloudName = process.env.REACT_APP_CLOUDINARY_NAME) {
  return sections.flatMap(([key, section]) => (Array.isArray(answers[key]) ? answers[key] : []).slice(0, 10)
    .filter(document => {
      try {
        const url = new URL(document?.url);
        return Boolean(cloudName) && url.protocol === 'https:' && url.hostname === 'res.cloudinary.com' &&
          !url.username && !url.password && !url.port && !url.search && !url.hash &&
          url.pathname.startsWith(`/${cloudName}/raw/upload/`) &&
          new RegExp(`^/${cloudName}/raw/upload/v[0-9]+/event-sheets/docs/[^/]+$`).test(url.pathname) &&
          /\.(pdf|docx?|jpe?g|png|webp)$/i.test(url.pathname);
      } catch { return false; }
    }).map(document => ({ ...document, section, purpose: 'information', name: String(document.name || 'Attachment').slice(0, 200) })));
}
