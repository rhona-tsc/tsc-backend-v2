const normalizedCountyKey = (value = "") =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");

const entriesOf = (value) => {
  if (!value) return [];
  if (typeof value.entries === "function") return [...value.entries()];
  if (typeof value === "object" && !Array.isArray(value)) return Object.entries(value);
  return [];
};

export const getMemberCountyTravelFee = (member, county, fallback = 0) => {
  const wanted = normalizedCountyKey(county);
  if (!wanted) return Number(fallback) || 0;
  const match = entriesOf(member?.countyTravelFees).find(
    ([key]) => normalizedCountyKey(key) === wanted,
  );
  if (!match) return Number(fallback) || 0;
  const fee = Number(match[1]);
  return Number.isFinite(fee) ? fee : Number(fallback) || 0;
};

export const hasMemberCountyTravelFee = (member, county) => {
  const wanted = normalizedCountyKey(county);
  return !!wanted && entriesOf(member?.countyTravelFees).some(
    ([key]) => normalizedCountyKey(key) === wanted,
  );
};
