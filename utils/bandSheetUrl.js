const DEFAULT_BAND_SHEET_ORIGIN = "https://tsc-backend-v2.onrender.com";
const DEFAULT_BAND_SHEET_SHARE_ORIGIN = "https://thesupremecollective.co.uk";

export const getBandSheetOrigin = () =>
  String(
    process.env.BAND_SHEET_PUBLIC_BASE_URL || DEFAULT_BAND_SHEET_ORIGIN,
  )
    .replace(/^https:\/\/tsc2025\.onrender\.com(?=\/|$)/i, DEFAULT_BAND_SHEET_ORIGIN)
    .replace(/\/$/, "");

export const buildBandSheetPdfUrl = (token) =>
  `${getBandSheetOrigin()}/api/booking/band-sheet/${encodeURIComponent(
    String(token || "").trim(),
  )}`;

export const getBandSheetShareOrigin = () =>
  String(
    process.env.BAND_SHEET_SHARE_BASE_URL ||
      process.env.PUBLIC_SITE_URL ||
      DEFAULT_BAND_SHEET_SHARE_ORIGIN,
  ).replace(/\/$/, "");

export const buildBandSheetShareUrl = (token) =>
  `${getBandSheetShareOrigin()}/sheet/${encodeURIComponent(
    String(token || "").trim(),
  )}`;
