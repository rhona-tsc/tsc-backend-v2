const DEFAULT_BAND_SHEET_ORIGIN = "https://tsc-backend-v2.onrender.com";

export const getBandSheetOrigin = () =>
  String(
    process.env.BAND_SHEET_PUBLIC_BASE_URL || DEFAULT_BAND_SHEET_ORIGIN,
  ).replace(/\/$/, "");

export const buildBandSheetPdfUrl = (token) =>
  `${getBandSheetOrigin()}/api/booking/band-sheet/${encodeURIComponent(
    String(token || "").trim(),
  )}`;

