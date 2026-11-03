import assert from "node:assert/strict";
import test from "node:test";
import {
  buildBandSheetPdfUrl,
  buildBandSheetShareUrl,
} from "../utils/bandSheetUrl.js";

test("band sheet shares use the branded public URL while PDFs stay on the backend", () => {
  const token = "secure_token-123";
  assert.equal(
    buildBandSheetShareUrl(token),
    "https://thesupremecollective.co.uk/sheet/secure_token-123",
  );
  assert.equal(
    buildBandSheetPdfUrl(token),
    "https://tsc-backend-v2.onrender.com/api/booking/band-sheet/secure_token-123",
  );
});
