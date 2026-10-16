const clean = (value) => String(value || "").trim();
const normalizedName = (value) => clean(value).toLowerCase();

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
