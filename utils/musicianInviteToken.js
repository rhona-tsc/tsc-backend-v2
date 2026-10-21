export const inviteTokenCanBeUsed = (musician = {}) =>
  Boolean(String(musician?.inviteTokenHash || "").trim());

export const NON_EXPIRING_INVITE_TOKEN_DATE = null;
