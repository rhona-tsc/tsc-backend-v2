const clean = (value) => String(value || "").trim();

export const isVocalContact = (member = {}) => {
  const instrument = clean(member.instrument).toLowerCase();
  return ["vocal", "rapper", "mc", "vox", "singer"].some((term) =>
    instrument.includes(term),
  );
};

export const sortedVocalContacts = (lineup = {}) =>
  (Array.isArray(lineup?.bandMembers) ? lineup.bandMembers : [])
    .filter(isVocalContact)
    .sort((a, b) => {
      const instrumentCompare = clean(a.instrument)
        .toLowerCase()
        .localeCompare(clean(b.instrument).toLowerCase());
      if (instrumentCompare) return instrumentCompare;
      const emailCompare = clean(a.email)
        .toLowerCase()
        .localeCompare(clean(b.email).toLowerCase());
      if (emailCompare) return emailCompare;
      return clean(a.phoneNumber || a.phone).localeCompare(
        clean(b.phoneNumber || b.phone),
      );
    });

export const requiredVocalistSlotIndexes = (lineup = {}) =>
  sortedVocalContacts(lineup).map((_, index) => index);

const leadVocalPattern = /\blead\b.*\b(vocal|vocalist|singer)\b|\b(vocal|vocalist|singer)\b.*\blead\b/i;

export const musicianCanFrontVocalSlot = (musician = {}, slot = {}) => {
  if (!/^approved\b/i.test(clean(musician?.status))) return false;

  const declaredRoles = [
    ...(Array.isArray(musician?.vocals?.type) ? musician.vocals.type : []),
    ...(Array.isArray(musician?.instrumentation)
      ? musician.instrumentation.map((item) => item?.instrument)
      : []),
  ]
    .map(clean)
    .filter(Boolean);
  if (!declaredRoles.some((role) => leadVocalPattern.test(role))) return false;

  const slotRole = clean(slot?.instrument || slot?.role || slot?.duties).toLowerCase();
  const profileGender = clean(musician?.vocals?.gender).toLowerCase();
  if (/\bfemale\b/.test(slotRole) && profileGender && profileGender !== "female") {
    return false;
  }
  if (/\bmale\b/.test(slotRole) && profileGender && profileGender !== "male") {
    return false;
  }

  return true;
};

const replyTime = (row = {}) =>
  new Date(row.repliedAt || row.updatedAt || row.createdAt || 0).getTime();

const displayName = (row = {}) =>
  clean(
    row.selectedVocalistName ||
      row.vocalistName ||
      row.musicianName ||
      row.contactName,
  );

export const availableVocalistsForLineup = (rows = [], lineup = {}) => {
  const vocalContacts = sortedVocalContacts(lineup);
  const requiredSlots = vocalContacts.map((_, index) => index);
  const slotContacts = new Map(
    vocalContacts.map((member, index) => [index, member]),
  );
  const bySlot = new Map();

  requiredSlots.forEach((slotIndex) => {
    const candidates = rows
      .filter(
        (row) => Number(row?.slotIndex ?? 0) === slotIndex && row?.reply === "yes",
      )
      .sort((a, b) => {
        if (Boolean(a.isDeputy) !== Boolean(b.isDeputy)) {
          return a.isDeputy ? 1 : -1;
        }
        return replyTime(a) - replyTime(b);
      })
      .map((row) => ({
        ...row,
        displayName: displayName(row),
      }));
    bySlot.set(slotIndex, candidates);
  });

  return {
    requiredSlots,
    slotContacts,
    bySlot,
    complete:
      requiredSlots.length > 0 &&
      requiredSlots.every((slotIndex) => (bySlot.get(slotIndex) || []).length > 0),
    selected: requiredSlots
      .map((slotIndex) => (bySlot.get(slotIndex) || [])[0])
      .filter(Boolean),
    all: requiredSlots.flatMap((slotIndex) => bySlot.get(slotIndex) || []),
  };
};

