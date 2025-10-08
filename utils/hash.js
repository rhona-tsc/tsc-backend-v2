// utils/hash.js (tiny helper)
export function hashBase36(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  // Base36, lowercase, no symbols; keep length <= 22 to be safe
  return Math.abs(h).toString(36);
}