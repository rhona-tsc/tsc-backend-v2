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
