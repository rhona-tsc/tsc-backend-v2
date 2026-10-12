import "dotenv/config";
import mongoose from "mongoose";
import Venue from "../models/venueModel.js";

const corrections = [
  ["Brockwell Hall", "Nearest Stations: Herne Hill (National Rail) or Brixton (Underground)", "Main Hall"],
  ["Tudor Barn Elthan", "Main Venue Entrance: ///shins.daring.events", "Tudor Gallery"],
  ["Tudor Barn Elthan", "Main / unspecified room", "Tudor Gallery"],
  ["Wasing Park Estate - Wasing Park", "///tummy.backfired.police", "Castle Barn"],
  ["Brocket Hall", "Entrance gate: ally.hero.glow Parking at the hall: estate.spared.rested", "Downstairs Boardroom"],
  ["Patch", "///save.shrimp.late", "Main / unspecified room"],
  ["The Winchester Room", "///glaze.owner.shirts", "Winchester Room"],
  ["The Granary", "///passes.walls.validated", "Tipi"],
  ["Rockwater", "What3words - ///saying.copy.rocket", "Roof Terrace"],
  ["For the address we have: Houchins Wedding Venue", "///replays.afflicted.fillings", "Dance Barn"],
  ["Oaklyn", "What3Words: ///spot.survey.index", "Marquee"],
  ["Syon House", "wiped.miss.stuff", "Great Conservatory"],
  ["The Lordship Pub", "wide.nerve.softly", "Main / unspecified room"],
  ["Montague Farm", "There is a long entrance into the farm, it will be sign posted but please see a map below", "Main Barn"],
  ["Thorpe Garden", "///assorted.salads.venturing - what 3 words", "Yurt"],
  ["Garrawalla", "essential.heeding.breakaway", "Marquee"],
  ["The Great Barn", "///shop.objecting.pigs", "Aynho Barn"],
  ["The Rectory Hotel", "///stood.unsigned.nobody", "Dining Room"],
  ["The Normans", "Note: There are a number of nearby addresses that share our post code!", "Grain Shed"],
  ["Easton grange", "Richly.wrenching.strategy", "Main / unspecified room"],
  ["Fanhams Hall", "For the courtyard: https://maps.app.goo.gl/zpKnFC8KUkxDktvB8", "Great Hall"],
  ["White Syke Fields", "developer.tubes.snowstorm", "Wheelhouse Barn"],
  ["Emmanuel College Cambridge", "2 spaces available in this location for band cars.", "Old Library"],
  ["The Ashes Barn", "///euphoric.embers.extra", "Wedding Breakfast Barn"],
  ["Somersbury Barn", "///trickles.lock.congratulations", "Main Barn"],
  ["Great Bower Barn", "///pranced.destined.mirror", "Barn"],
  ["The Barn at Botley Hill", "///awake.misty.owners", "Main Barn"],
  ["Winchester House", "You will be performing in the Riverview Ballroom", "Riverview Ballroom"],
  ["The Canary Shed", "What3Words: factored.feed.haunt", "Main / unspecified room"],
  ["The Boathouse", "pretty.needed.chill", "Outdoor Space"],
  ["Bullocks Farm", "There is a large area for parking by the entrance of the farm W3W: docks.scales.mega", "Marquee"],
  ["Flint Barns", "Drive up the driveway to the Flint Barns at the end. What 3 words: tastier.disposing.hiring", "Sailcloth Marquee"],
  ["The Black Barn", "Chain.loses.cheek", "Main Barn"],
  ["QRRA Club", "What 3 words - Swims.Called.Deep as postcode does not take you there directly", "Outdoor Stage"],
  ["The Londesborough", "barn.fingernails.poet", "Main Room"],
  ["The Assembly Hall", "They are performing in the Assembly Hall", "Assembly Hall"],
  ["Cottesmore golf and country club", "what3words: ///reform.feared.avoid", "Buchan Suite"],
  ["Milsoms Talbooth Restaurant", "duet.pixies.learning", "Marquee"],
  ["London City Beach", "For load in W3W - ///stick.combining.natively", "Main Marquee"],
  ["Salomons Estates", "///specifies.timidly.physical", "Theatre"],
  ["LIMEKILN", "corrects.starting.speared", "Alder Room"],
  ["Balls Brothers Austin Friars", "///gain.pages.salads", "Main Area"],
  ["The Field", "///ticket.inner.could", "Outdoor Performance Area"],
  ["Braxted Park Estate", "Braxted Park Estate - Google Maps", "Outdoor Stage"],
  ["Divinity schools", "radio.bottom.jabs ( what 3 words for main gate / loading point )", "Divinity School"],
  ["Turner Contemporary Rendezvous", "reveal.exchanges.empire", "Foyle Room"],
  ["Goodnestone Court", "W3W - ///aura.wrong.sonic", "Wedding Marquee"],
  ["Kindred", "Loading bay documentation: Loading Bay.docx", "Main Hall"],
  ["Whindrove Farm", "Brightens.vital.convert", "Tipi"],
  ["Motel Studios", "W3W ///smart.known.waddle", "Studio 3"],
  ["De Vere Latimer Estate", "venues.muddy.mimic", "Cavendish Suite"],
  ["The Catherine Wheel", "Pranced.Subtitle.Lime", "Dining Area"],
  ["Hilmore House", "Hilmore House - Google Maps", "Atrium"],
  ["The Old House Inn", "Vibe.fakes.traps (car park adjacent to pub)", "Main Area"],
  ["Pipers Farm", "///potential.bulk.behind - unloading location.", "Stretch Tent"],
  ["Hodsock Priory", "Here is the google maps pin:", "Pavilion"],
  ["The Bedford", "///action.amused.front - Tradesman entrance.", "Club Room"],
  ["London SW1W 8BG, UK", "Chelsea Barracks, 1 Garrison Square, SW1 W8BG", "Main Area"],
  ["Smiths of Smithfield", "top floor", "Top Floor"],
  ["Huntsmill Farm", "main barn", "Main Barn"],
  ["The Estate Barn", "main barn", "Main Barn"],
  ["Clevedon Hall", "Great Hall.", "Great Hall"],
  ["Birdsall House", "old kitchens nightclub", "Old Kitchens Nightclub"],
  ["Garden Museum", "Lighter Brick Building from this google map pin", "Nave"],
  ["Royal Holloway", "From the venue:", "Founder's Dining Hall"],
  ["Ships Timbers - 30 Green End", "Swarm,taxi,impulses", "Garden Gazebo"],
  ["Pembroke Lodge", "The venue have sent these instructions below", "Belvedere Suite"],
  ["Norwood Park", "Norwood Park", "Bar Area"],
  ["Trump Turnberry Maidens Rd", "Trump Turnberry Maidens Rd.", "Main Hall"],
];

const clean = (value) => String(value || "").trim();
const w3wCodes = (value) => [...String(value || "").matchAll(/(?:\/\/\/)?([a-z]+\.[a-z]+\.[a-z]+)/gi)].map((match) => match[1].toLowerCase());
const w3wUrl = (code) => code ? `https://what3words.com/${code}` : "";
const mergeText = (current, incoming) => clean(current) || clean(incoming);

const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
if (!uri) throw new Error("MONGODB_URI is required");
const apply = process.argv.includes("--apply");
await mongoose.connect(uri);

let changed = 0;
for (const [venueName, oldName, newName] of corrections) {
  const venue = await Venue.findOne({ name: venueName });
  if (!venue) { console.log(`MISSING VENUE: ${venueName}`); continue; }
  const oldRoom = venue.rooms.find((room) => clean(room.name).toLowerCase() === oldName.toLowerCase());
  if (!oldRoom) { console.log(`MISSING ROOM: ${venueName} / ${oldName}`); continue; }
  console.log(`${apply ? "FIX" : "WOULD FIX"}: ${venueName}: ${oldName} -> ${newName}`);
  if (!apply) continue;

  const codes = [...new Set([...w3wCodes(oldName), ...w3wCodes(venue.loadingPinUrl)])];
  if (codes.length) {
    const parkingContext = /parking|car park/i.test(oldName);
    if (parkingContext && !clean(venue.parkingPinUrl)) venue.parkingPinUrl = w3wUrl(codes.at(-1));
    else if (!/^https?:\/\//i.test(clean(venue.loadingPinUrl))) venue.loadingPinUrl = w3wUrl(codes[0]);
    if (codes.length > 1 && !clean(venue.parkingPinUrl)) venue.parkingPinUrl = w3wUrl(codes[1]);
    if (!clean(venue.what3wordsUrl)) venue.what3wordsUrl = w3wUrl(codes[0]);
  }

  const target = venue.rooms.find((room) => room !== oldRoom && clean(room.name).toLowerCase() === newName.toLowerCase());
  if (target) {
    for (const field of ["performanceArea", "accessAndLoading", "changingRoom", "soundLimitations", "soundLimiterDb", "curfewAndCloseTime", "paAndLighting", "powerAndStage", "capacity", "notes"]) target[field] = mergeText(target[field], oldRoom[field]);
    target.aliases = [...new Set([...(target.aliases || []), ...(oldRoom.aliases || []), oldName].map(clean).filter(Boolean))];
    for (const source of oldRoom.sources || []) if (!target.sources.some((entry) => entry.kind === source.kind && entry.sourceId === source.sourceId)) target.sources.push(source);
    venue.rooms.pull(oldRoom._id);
  } else {
    oldRoom.aliases = [...new Set([...(oldRoom.aliases || []), oldName].map(clean).filter(Boolean))];
    oldRoom.name = newName;
  }
  for (const visit of venue.visits || []) if (clean(visit.roomName).toLowerCase() === oldName.toLowerCase()) visit.roomName = newName;
  await venue.save();
  changed += 1;
}

console.log(`${apply ? "Updated" : "Reviewed"} ${changed} room records.`);
await mongoose.disconnect();
