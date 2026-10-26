const clean = (value) => String(value ?? "").trim();

const PLACEHOLDER_VALUE = /^(?:tbc|n\/a|unknown|the band|your act|venue|location tbc)$/i;

export const positiveFee = (value) => {
  const parsed = Number(String(value ?? "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
};

export const validateOpportunityDetails = ({
  actName,
  date,
  address,
  duties,
  fee,
} = {}) => {
  const missing = [];
  const requiredText = [
    ["act", actName],
    ["date", date],
    ["address", address],
    ["duties", duties],
  ];

  for (const [label, value] of requiredText) {
    const text = clean(value);
    if (!text || PLACEHOLDER_VALUE.test(text)) missing.push(label);
  }

  if (!positiveFee(fee)) missing.push("positive fee");

  if (missing.length) {
    throw new Error(
      `WhatsApp message blocked: missing or invalid ${missing.join(", ")}. No message was sent.`,
    );
  }

  return true;
};

