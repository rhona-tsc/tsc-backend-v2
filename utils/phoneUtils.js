// utils/phoneUtils.js
export function normalize(phoneRaw = "") {
  if (!phoneRaw) return [];

  let digits = phoneRaw.trim();

  // Remove Twilio "whatsapp:" prefix
  digits = digits.replace(/^whatsapp:/i, "");

  // Strip spaces, dashes, parentheses
  digits = digits.replace(/[\s\-\(\)]/g, "");

  const candidates = new Set();

  if (digits.startsWith("+44")) {
    candidates.add(digits);
    candidates.add("0" + digits.slice(3));
    candidates.add(digits.slice(1));
  } else if (digits.startsWith("44")) {
    candidates.add("+" + digits);
    candidates.add("0" + digits.slice(2));
    candidates.add(digits);
  } else if (digits.startsWith("0")) {
    candidates.add(digits);
    candidates.add("+44" + digits.slice(1));
    candidates.add("44" + digits.slice(1));
  }

  return Array.from(candidates);
}