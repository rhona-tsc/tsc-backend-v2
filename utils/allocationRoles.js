const ROLE_ALIASES = new Map([
  ["bass", "Bass Guitar"],
  ["bass guitar", "Bass Guitar"],
  ["keys", "Keyboard"],
  ["keyboards", "Keyboard"],
  ["keyboard", "Keyboard"],
  ["guitar", "Electric Guitar"],
  ["electric guitar", "Electric Guitar"],
  ["sax", "Saxophone"],
  ["saxophone", "Saxophone"],
  ["drummer", "Drums"],
  ["drums", "Drums"],
  ["female lead vocal", "Lead Female Vocal"],
  ["female lead vocals", "Lead Female Vocal"],
  ["lead female vocal", "Lead Female Vocal"],
  ["lead female vocals", "Lead Female Vocal"],
  ["male lead vocal", "Lead Male Vocal"],
  ["male lead vocals", "Lead Male Vocal"],
  ["lead male vocal", "Lead Male Vocal"],
  ["lead male vocals", "Lead Male Vocal"],
  ["female vocal/rapper", "Lead Female Vocal / Rapper"],
  ["lead female vocal/rapper", "Lead Female Vocal / Rapper"],
  ["male vocal/rapper", "Lead Male Vocal / Rapper"],
  ["lead male vocal/rapper", "Lead Male Vocal / Rapper"],
]);

const roleKey = (value = "") =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s*\/\s*/g, "/")
    .replace(/\s+/g, " ");

export const normaliseAllocationRole = (value = "") => {
  const cleaned = String(value || "").trim().replace(/\s+/g, " ");
  return ROLE_ALIASES.get(roleKey(cleaned)) || cleaned;
};

export const getAllocationRoleSlotNumber = (value = "") => {
  const match = String(value || "").trim().match(/-(\d+)$/);
  return match ? Number(match[1]) : 0;
};

export const allocationMatchesRoleSlot = (member = {}, slot = {}) => {
  const memberRole = normaliseAllocationRole(
    member?.role || member?.instrument || "",
  ).toLowerCase();
  const slotRole = normaliseAllocationRole(slot?.role || "").toLowerCase();
  if (!memberRole || memberRole !== slotRole) return false;

  const memberSlotNumber = getAllocationRoleSlotNumber(member?.roleSlotId);
  const slotNumber = getAllocationRoleSlotNumber(slot?.roleSlotId);
  return !memberSlotNumber || !slotNumber || memberSlotNumber === slotNumber;
};

