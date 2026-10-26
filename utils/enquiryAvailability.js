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
  const requiredSlots = requiredVocalistSlotIndexes(lineup);
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

