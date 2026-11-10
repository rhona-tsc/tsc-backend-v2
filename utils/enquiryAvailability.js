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

export const vocalistIdentity = (row = {}) => clean(row.musicianId || row.phone || row.email || displayName(row)).toLowerCase();

// A person can cover several roles, but can fill only one of them at an event.
export function assignDistinctVocalists(requiredSlots, bySlot, allowedIds = null) {
  const visit = (index, used, chosen) => {
    if (index === requiredSlots.length) return chosen;
    for (const row of bySlot.get(requiredSlots[index]) || []) {
      const id = vocalistIdentity(row);
      if (!id || used.has(id) || (allowedIds && !allowedIds.has(id))) continue;
      const result = visit(index + 1, new Set([...used, id]), [...chosen, row]);
      if (result) return result;
    }
    return null;
  };
  return visit(0, new Set(), []);
}

export const availableVocalistsForLineup = (rows = [], lineup = {}) => {
  const vocalContacts = sortedVocalContacts(lineup);
  const requiredSlots = vocalContacts.map((_, index) => index);
  const slotContacts = new Map(vocalContacts.map((member, index) => [index, member]));
  // A later withdrawal supersedes a previous yes. Repeated replies are not
  // additional deputy choices. Keep each person's most recent response per role.
  const latest = new Map();
  [...rows].sort((a, b) => replyTime(a) - replyTime(b)).forEach(row => {
    const id = vocalistIdentity(row);
    if (id) latest.set(`${Number(row.slotIndex ?? 0)}:${id}`, row);
  });
  const current = [...latest.values()];
  const bySlot = new Map(requiredSlots.map(slotIndex => [slotIndex,
    current.filter(row => Number(row.slotIndex ?? 0) === slotIndex && row.reply === "yes")
      .sort((a, b) => Number(Boolean(a.isDeputy)) - Number(Boolean(b.isDeputy)) || replyTime(a) - replyTime(b))
      .map(row => ({ ...row, displayName: displayName(row) }))
  ]));
  const selected = assignDistinctVocalists(requiredSlots, bySlot);
  const complete = requiredSlots.length > 0 && Boolean(selected);
  const anyRegularAvailable = current.some(row => requiredSlots.includes(Number(row.slotIndex ?? 0)) && !row.isDeputy && row.reply === "yes");
  const allRegularUnavailable = requiredSlots.length > 0 && requiredSlots.every(slotIndex => {
    const regular = current.filter(row => Number(row.slotIndex ?? 0) === slotIndex && !row.isDeputy);
    return regular.length > 0 && regular.every(row => ["no", "unavailable"].includes(row.reply));
  });
  const deputyChoicesReady = requiredSlots.length > 0 && requiredSlots.every(slotIndex =>
    (bySlot.get(slotIndex) || []).filter(row => row.isDeputy).length >= 2);
  return { requiredSlots, slotContacts, bySlot, complete, selected: selected || [],
    all: requiredSlots.flatMap(slot => bySlot.get(slot) || []),
    anyRegularAvailable, allRegularUnavailable, deputyChoicesReady,
    readyToNotify: complete && (anyRegularAvailable || (allRegularUnavailable && deputyChoicesReady)),
    deputyOnly: complete && !anyRegularAvailable && allRegularUnavailable,
  };
};
