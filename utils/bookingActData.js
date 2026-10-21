const clean = (value) => String(value || "").trim();
const normalizedName = (value) => clean(value).toLowerCase();
const normalizedLooseName = (value) => normalizedName(value).replace(/[^a-z0-9]/g, "");

const editDistance = (leftValue, rightValue) => {
  const left = normalizedLooseName(leftValue);
  const right = normalizedLooseName(rightValue);
  if (!left) return right.length;
  if (!right) return left.length;

  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      current[rightIndex] = Math.min(
        current[rightIndex - 1] + 1,
        previous[rightIndex] + 1,
        previous[rightIndex - 1] + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1),
      );
    }
    previous.splice(0, previous.length, ...current);
  }
  return previous[right.length];
};

export const actReferenceCandidates = (row = {}) => ({
  ids: [
    row.actId,
    row.linkedActId,
    row.act,
    row.selectedAct?._id,
    row.actsSummary?.[0]?.actId,
  ].map(clean).filter(Boolean),
  names: [
    row.actTscName,
    row.actName,
    row.bandName,
    row.selectedAct?.tscName,
    row.selectedAct?.name,
    row.actsSummary?.[0]?.tscName,
    row.actsSummary?.[0]?.actName,
    row.actsSummary?.[0]?.name,
  ].map(clean).filter(Boolean),
});

export const buildActProfileLookup = (acts = []) => {
  const lookup = new Map();
  acts.forEach((act) => {
    const id = clean(act?._id);
    if (id) lookup.set(`id:${id}`, act);
    [act?.name, act?.tscName].map(normalizedName).filter(Boolean).forEach((name) => {
      lookup.set(`name:${name}`, act);
    });
  });
  return lookup;
};

export const findBestActProfile = (row = {}, acts = []) => {
  const candidates = actReferenceCandidates(row);
  const byId = candidates.ids
    .map((id) => acts.find((act) => clean(act?._id) === id))
    .find(Boolean);
  if (byId) return byId;

  const requestedNames = candidates.names.map(normalizedLooseName).filter(Boolean);
  const exact = requestedNames
    .map((requestedName) => acts.find((act) => (
      [act?.name, act?.tscName]
        .map(normalizedLooseName)
        .filter(Boolean)
        .includes(requestedName)
    )))
    .find(Boolean);
  if (exact) return exact;

  const ranked = acts
    .map((act) => {
      const actNames = [act?.name, act?.tscName]
        .map(normalizedLooseName)
        .filter(Boolean);
      const distances = requestedNames.flatMap((requestedName) => (
        actNames.map((actName) => ({
          distance: editDistance(requestedName, actName),
          referenceLength: Math.max(requestedName.length, actName.length),
        }))
      ));
      const best = distances.sort((a, b) => a.distance - b.distance)[0];
      return best ? { act, ...best } : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.distance - b.distance);

  const best = ranked[0];
  const next = ranked[1];
  if (!best || best.distance === next?.distance) return null;
  const allowedDistance = Math.min(2, Math.max(1, Math.floor(best.referenceLength * 0.15)));
  return best.distance <= allowedDistance ? best.act : null;
};

export const findActLineup = (act = {}, row = {}) => {
  const lineups = Array.isArray(act?.lineups) ? act.lineups : [];
  const requestedIds = [
    row.lineupId,
    row.actsSummary?.[0]?.lineupId,
  ].map(clean).filter(Boolean);
  const byId = requestedIds
    .map((id) => lineups.find((lineup) => (
      clean(lineup?._id) === id || clean(lineup?.lineupId) === id
    )))
    .find(Boolean);
  if (byId) return byId;

  const selectedLabel = clean(row.lineupSelected || row.actsSummary?.[0]?.lineupLabel);
  const requestedSize = Number(row.bandSize)
    || Number(selectedLabel.match(/(\d+)\s*[- ]?piece/i)?.[1])
    || 0;
  if (requestedSize) {
    const matchingSize = lineups.filter((lineup) => (
      Number(String(lineup?.actSize || "").match(/\d+/)?.[0]) === requestedSize
      || lineup?.bandMembers?.length === requestedSize
    ));
    if (matchingSize.length === 1) return matchingSize[0];
  }

  return lineups.length === 1 ? lineups[0] : null;
};

export const attachActProfileData = (row = {}, lookup = new Map()) => {
  const candidates = actReferenceCandidates(row);
  const linkedAct = candidates.ids
    .map((id) => lookup.get(`id:${id}`))
    .find(Boolean) || candidates.names
    .map((name) => lookup.get(`name:${normalizedName(name)}`))
    .find(Boolean);

  if (!linkedAct) return row;
  return {
    ...row,
    actId: row.actId || linkedAct._id,
    actData: {
      _id: linkedAct._id,
      name: linkedAct.name || "",
      tscName: linkedAct.tscName || "",
      extras: linkedAct.extras || {},
      paSystem: linkedAct.paSystem || null,
      lightingSystem: linkedAct.lightingSystem || null,
    },
  };
};
