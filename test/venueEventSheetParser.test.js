import test from "node:test";
import assert from "node:assert/strict";
import {
  addressFromLocationLines,
  countyFromAddress,
  roomNameFrom,
} from "../services/venueEventSheetParser.js";

test("uses the filled answer box when a placeholder is printed above it", () => {
  assert.equal(
    addressFromLocationLines([
      "Venue TBC - Leighton Buzzard",
      "Please provide a google map pin or what3words location of the loading point for the band.",
      "Brooklands Residents Association, Garden Leys, Leighton Buzzard LU7 3PQ",
    ]),
    "Brooklands Residents Association, Garden Leys, Leighton Buzzard LU7 3PQ",
  );
});

test("uses an explicitly written county ahead of an overlapping postcode district", () => {
  assert.equal(
    countyFromAddress("Hedsor House, Taplow, Buckinghamshire SL6 0HX"),
    "Buckinghamshire",
  );
});

test("recognises Greater London from a London postcode", () => {
  assert.equal(
    countyFromAddress("The Savoy, Strand, London WC2R 0EZ"),
    "Greater London",
  );
});

test("extracts a room name embedded in a performance-area sentence", () => {
  assert.equal(
    roomNameFrom([], "The band will be performing in the Orangery. There is power nearby."),
    "Orangery",
  );
  assert.equal(
    roomNameFrom([], "Performance will take place in the Great Hall, with loading from the rear."),
    "Great Hall",
  );
});

test("does not invent a room name from generic performance-area instructions", () => {
  assert.equal(
    roomNameFrom([], "There is a 5m x 4m performance area in front of the windows."),
    "Main / unspecified room",
  );
});

const parkingQuestion = 'Could I ask if there will be free parking available for X cars?';
const parkingPinQuestion = 'If you have a Google Map pin or a what3words location of the parking please provide that below.';
const paQuestion = 'Is there an in-house PA system that the band needs to use, or would you prefer that they bring and use their own?';
const closeQuestion = 'The DJ takes 30 minutes to pack down everything and leave the site from the moment the music is turned off. Is there a hard venue close time for the DJ in terms of packing down and offloading? For example, any gates that shut at midnight or requirements from the venue to be off-site by a certain time?';
const contactQuestion = 'Who is the DJ’s point of contact on the day, and could you kindly provide their mobile number, please?';
const roomQuestion = 'What room will the DJ be performing in? And what area in that room would you like the DJ to set up in? If you are having the DJ perform outdoors please note that arrangements for cover over the DJ must be made to ensure equipment is protected in the event of rain.';
const addressQuestion = 'For the address we have: ........ and . If you could kindly confirm the full address that would be most helpful. Please also provide a google map pin or what3words location of the loading point for the band.';

test('removes the supplied template wording while preserving every section answer', async () => {
  const { sectionsFrom } = await import('../services/venueEventSheetParser.js');
  const sections = sectionsFrom([
    'LOCATION', addressQuestion,
    'Hedsor House, Taplow, Buckinghamshire SL6 0HX', 'https://maps.app.goo.gl/loading',
    'PARKING', parkingQuestion, 'Yes, free parking for five cars beside the barn.', parkingPinQuestion, 'https://what3words.com/park.here.please',
    'PA SYSTEM', paQuestion, 'Please bring your own PA and lights; there is no in-house system.',
    'ROOM & AREA', roomQuestion, 'The DJ will be performing in the Great Hall, beside the windows.',
    'VENUE CLOSE TIME', closeQuestion, 'Music off at midnight; vehicles off site by 01:00.',
    'DJ’S POINT OF CONTACT', contactQuestion, 'Venue manager: Alex, 07000000000.',
  ].join('\n'));
  assert.deepEqual(sections.LOCATION, ['Hedsor House, Taplow, Buckinghamshire SL6 0HX', 'https://maps.app.goo.gl/loading']);
  assert.deepEqual(sections.PARKING, ['Yes, free parking for five cars beside the barn.', 'https://what3words.com/park.here.please']);
  assert.deepEqual(sections['PA SYSTEM & LIGHTS'], ['Please bring your own PA and lights; there is no in-house system.']);
  assert.deepEqual(sections['ROOM & AREA'], ['The DJ will be performing in the Great Hall, beside the windows.']);
  assert.deepEqual(sections['VENUE CLOSE TIME'], ['Music off at midnight; vehicles off site by 01:00.']);
  assert.deepEqual(sections["BAND'S POINT OF CONTACT"], ['Venue manager: Alex, 07000000000.']);
  assert.doesNotMatch(JSON.stringify(sections), /Could I ask|If you have a Google|Is there an in-house|The DJ takes|Who is the|What room will|For the address we have/);
});

test('handles wrapped questions, numeric car counts and answers on the same paragraph', async () => {
  const { sectionsFrom } = await import('../services/venueEventSheetParser.js');
  const wrap = text => text.replace(/ /g, '\n');
  const sections = sectionsFrom([
    'PARKING', `${parkingQuestion.replace('X', '4')} Four free spaces.`, wrap(parkingPinQuestion), '///park.here.please',
    'PA SYSTEM & LIGHTS', `${wrap(paQuestion)} Use the house PA; bring lights.`,
    'VENUE CLOSE TIME', `${wrap(closeQuestion)} Off site by 01:00.`,
    "DJ'S POINT OF CONTACT", `${wrap(contactQuestion.replaceAll('’', "'"))} Alex at reception.`,
    'ROOM & AREA', `${wrap(roomQuestion)} Main Barn.`,
    'LOCATION', `${wrap(addressQuestion)} Example Venue, Taplow, Buckinghamshire SL6 0HX`,
  ].join('\n'));
  assert.deepEqual(sections.PARKING, ['Four free spaces.', '///park.here.please']);
  assert.deepEqual(sections['PA SYSTEM & LIGHTS'], ['Use the house PA; bring lights.']);
  assert.deepEqual(sections['VENUE CLOSE TIME'], ['Off site by 01:00.']);
  assert.deepEqual(sections["BAND'S POINT OF CONTACT"], ['Alex at reception.']);
  assert.deepEqual(sections['ROOM & AREA'], ['Main Barn.']);
  assert.deepEqual(sections.LOCATION, ['Example Venue, Taplow, Buckinghamshire SL6 0HX']);
});

test('empty template boxes do not become venue information', async () => {
  const { sectionsFrom } = await import('../services/venueEventSheetParser.js');
  const sections = sectionsFrom(['LOCATION', addressQuestion, 'PARKING', parkingQuestion, parkingPinQuestion, 'PA SYSTEM', paQuestion, 'ROOM & AREA', roomQuestion, 'VENUE CLOSE TIME', closeQuestion, 'DJ’S POINT OF CONTACT', contactQuestion].join('\n'));
  assert.ok(Object.values(sections).every(values => values.length === 0));
});

test('the complete import routes PA answers correctly and keeps DJ contact text out of curfew', async () => {
  const { default: mammoth } = await import('mammoth');
  const { parseVenueEventSheet } = await import('../services/venueEventSheetParser.js');
  const original = mammoth.extractRawText;
  mammoth.extractRawText = async () => ({ messages: [], value: [
    'LOCATION', addressQuestion, 'Hedsor House, Taplow, Buckinghamshire SL6 0HX',
    'PARKING', parkingQuestion, 'Five spaces.', parkingPinQuestion, 'https://maps.app.goo.gl/parking',
    'ROOM & AREA', roomQuestion, 'The DJ will be performing in the Great Hall.',
    'PA SYSTEM', paQuestion, 'Use the venue PA; the DJ should bring lights.',
    'VENUE CLOSE TIME', closeQuestion, 'Off site by 01:00.',
    'DJ’S POINT OF CONTACT', contactQuestion, 'Alex at reception.',
  ].join('\n') });
  try {
    const { venue } = await parseVenueEventSheet({ buffer: Buffer.from('test'), originalname: 'event-sheet.docx' });
    assert.equal(venue.address, 'Hedsor House, Taplow, Buckinghamshire SL6 0HX');
    assert.equal(venue.parking, 'Five spaces.\nhttps://maps.app.goo.gl/parking');
    assert.equal(venue.parkingPinUrl, 'https://maps.app.goo.gl/parking');
    assert.equal(venue.rooms[0].paAndLighting, 'Use the venue PA; the DJ should bring lights.');
    assert.equal(venue.rooms[0].curfewAndCloseTime, 'Off site by 01:00.');
    assert.equal(venue.rooms[0].performanceArea, 'The DJ will be performing in the Great Hall.');
  } finally {
    mammoth.extractRawText = original;
  }
});

test('excludes the band contact template and separates its answer from other venue fields', async () => {
  const { sectionsFrom } = await import('../services/venueEventSheetParser.js');
  const question = "Who is the band's point of contact on the day (often the best man, bridesmaid, or wedding planner), and could you kindly provide their mobile number, please?";
  for (const prompt of [question, question.replace("band's", 'band’s').replace(/ /g, '\n')]) {
    const sections = sectionsFrom([
      'VENUE CLOSE TIME', 'Off site by 01:00.',
      'POINT OF CONTACT', `${prompt} Alex, 07000000000.`,
      'PA SYSTEM', 'Bring your own PA and lights.',
    ].join('\n'));
    assert.deepEqual(sections['VENUE CLOSE TIME'], ['Off site by 01:00.']);
    assert.deepEqual(sections["BAND'S POINT OF CONTACT"], ['Alex, 07000000000.']);
    assert.deepEqual(sections['PA SYSTEM & LIGHTS'], ['Bring your own PA and lights.']);
    assert.doesNotMatch(JSON.stringify(sections), /Who is|best man|bridesmaid|wedding planner/);
  }
  assert.deepEqual(sectionsFrom(`POINT OF CONTACT\n${question}`)["BAND'S POINT OF CONTACT"], []);
});
