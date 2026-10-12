import mammoth from "mammoth";

const tidy = (value = "") => String(value).replace(/\u00a0/g, " ").replace(/[ \t]+/g, " ").trim();
const unique = (values) => [...new Set(values.map(tidy).filter(Boolean))];
const postcodeFrom = (value) => (tidy(value).toUpperCase().match(/\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/) || [""])[0].replace(/\s+/g, " ");
const urlsFrom = (value) => unique(String(value || "").match(/https?:\/\/[^\s]+/gi) || []).map((url) => url.replace(/[),.;]+$/, ""));

const sectionNames = [
  "DATE", "BAND NAME", "BAND SIZE", "EVENT TYPE", "COUPLE'S NAMES", "COUPLE’S NAMES", "ATTIRE", "LOCATION", "PARKING",
  "SPECIAL DIRECTIONS", "ROOM & AREA", "ROOM SIZE & EXPECTED NUMBER OF GUESTS", "PA SYSTEM & LIGHTS", "SOUND LIMITATIONS",
  "VENUE CLOSE TIME", "BAND'S POINT OF CONTACT", "BAND’S POINT OF CONTACT", "CHANGING ROOM", "FOOD & REFRESHMENTS",
  "BAND MEAL FAST-TRACK & KEEPING PLATES ASIDE", "TIME FOR BAND MEAL", "SCHEDULE", "SPOTIFY PLAYLIST", "ADVANCED DJ REQUESTS",
  "FIRST DANCE & SONG LIST", "SOCIALS (OPTIONAL)", "OTHER SUPPLIERS (OPTIONAL)", "PAYMENT", "NOTES",
];
const sectionSet = new Set(sectionNames.map((name) => name.replace(/[’]/g, "'").toUpperCase()));
const normalizedHeading = (line) => tidy(line).replace(/[’]/g, "'").toUpperCase();

const promptStarts = {
  LOCATION: ["please provide", "please also provide"],
  PARKING: ["as part of the booking"],
  "SPECIAL DIRECTIONS": ["are there any special directions"],
  "ROOM & AREA": ["what room will the band"],
  "ROOM SIZE & EXPECTED NUMBER OF GUESTS": ["roughly what size"],
  "PA SYSTEM & LIGHTS": ["is there an in-house pa", "is there an in house pa"],
  "SOUND LIMITATIONS": ["is there a sound limiter"],
  "VENUE CLOSE TIME": ["the band takes 60 minutes"],
  "CHANGING ROOM": ["is there a room available"],
};

function sectionsFrom(text) {
  const lines = String(text || "").split(/\r?\n/).map(tidy).filter(Boolean);
  const sections = {};
  let current = "";
  for (const line of lines) {
    const heading = normalizedHeading(line);
    if (sectionSet.has(heading)) { current = heading; sections[current] ||= []; continue; }
    if (current) sections[current].push(line);
  }
  for (const [name, starts] of Object.entries(promptStarts)) {
    const values = sections[name] || [];
    while (values.length && starts.some((start) => values[0].toLowerCase().startsWith(start))) values.shift();
  }
  return sections;
}

function roomNameFrom(locationLines, roomText) {
  const extraLocation = locationLines.slice(1).find((line) => !/^(load in|load out|https?:|please (also )?provide)/i.test(line) && !postcodeFrom(line));
  if (extraLocation && extraLocation.length < 100) return extraLocation;
  const patterns = [
    /\b(Studio\s+\d+)\b/i,
    /\b(Aisled Barn)\b/i,
    /\b(Main Barn)\b/i,
    /\b(top floor)\b/i,
    /\b([A-Z][\w' -]+(?:Barn|Ballroom|Suite|Hall|Room|Studio|Marquee))\b/,
  ];
  for (const pattern of patterns) { const match = roomText.match(pattern); if (match) return tidy(match[1]); }
  return "Main / unspecified room";
}

function dateFrom(value) {
  const normalized = tidy(value).replace(/(\d)(st|nd|rd|th)\b/gi, "$1").replace(/\s+of\s+/i, " ");
  const parsed = Date.parse(`${normalized} 12:00 UTC`);
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
}

export async function parseVenueEventSheet(file) {
  const { value, messages } = await mammoth.extractRawText({ buffer: file.buffer });
  const sections = sectionsFrom(value);
  const location = sections.LOCATION || [];
  const locationLine = location[0] || "";
  const roomArea = (sections["ROOM & AREA"] || []).join("\n");
  const sound = (sections["SOUND LIMITATIONS"] || []).join("\n");
  const allUrls = urlsFrom(value);
  const locationUrls = urlsFrom(location.join("\n"));
  const directions = (sections["SPECIAL DIRECTIONS"] || []).join("\n");
  const directionsUrls = urlsFrom(directions);
  const mapUrl = [...locationUrls, ...directionsUrls].find((url) => /google\.|maps\.app\.goo\.gl/i.test(url)) || "";
  const what3wordsUrl = [...locationUrls, ...directionsUrls].find((url) => /what3words|w3w\.co/i.test(url)) || "";
  const limiterMatch = sound.match(/\b(\d{2,3})\s*(?:dB(?:A|C)?|decibels?)\b/i);
  const limiter = limiterMatch ? `${limiterMatch[1]} dB` : "";
  const addressParts = locationLine.split(",").map(tidy).filter(Boolean);
  const venueName = addressParts.length > 1 ? addressParts[0] : locationLine;
  const eventDateText = (sections.DATE || [""])[0];
  const actName = (sections["BAND NAME"] || [""])[0];
  const roomName = roomNameFrom(location, roomArea);
  return {
    fileName: file.originalname,
    warnings: messages.map((message) => message.message).filter(Boolean),
    venue: {
      name: venueName,
      address: locationLine,
      postcode: postcodeFrom(locationLine),
      county: "",
      website: allUrls.find((url) => !/google\.|maps\.app\.goo\.gl|spotify|facebook|instagram|linkedin|pinterest|youtu/i.test(url)) || "",
      googleMapsUrl: mapUrl,
      what3wordsUrl,
      loadingPinUrl: mapUrl || what3wordsUrl || location.slice(1).join("\n"),
      parking: (sections.PARKING || []).join("\n"),
      parkingPinUrl: urlsFrom((sections.PARKING || []).join("\n")).find((url) => /google\.|maps\.app\.goo\.gl|what3words|w3w\.co/i.test(url)) || "",
      generalDirections: directions,
      reviewStatus: "review_needed",
      rooms: [{
        name: roomName,
        performanceArea: roomArea,
        accessAndLoading: directions,
        changingRoom: (sections["CHANGING ROOM"] || []).join("\n"),
        soundLimitations: sound,
        soundLimiterDb: limiter,
        curfewAndCloseTime: (sections["VENUE CLOSE TIME"] || []).join("\n"),
        paAndLighting: (sections["PA SYSTEM & LIGHTS"] || []).join("\n"),
        capacity: (sections["ROOM SIZE & EXPECTED NUMBER OF GUESTS"] || []).join("\n"),
      }],
      source: { kind: "event_sheet", sourceId: file.originalname, title: file.originalname, eventDate: dateFrom(eventDateText) },
      visit: { bookingId: `event-sheet:${file.originalname}`, eventDate: dateFrom(eventDateText), actName, roomName, sourceUrl: "" },
    },
  };
}

export { postcodeFrom };
