import mongoose from 'mongoose';

export const ENQUIRY_PREFERENCE_KEYS = ['styles', 'preferredSize', 'mustHaveInstruments', 'selectedBands'];
const clean = value => String(value ?? '').trim();
const bounded = (value, max) => {
  if (typeof value !== 'string' || value.length > max) throw new Error('Preference text is too long or invalid.');
  return value.trim();
};
const tags = value => {
  if (!Array.isArray(value) || value.length > 20) throw new Error('Choose up to 20 preference values.');
  return [...new Map(value.map(item => bounded(item, 100)).filter(Boolean).map(item => [item.toLowerCase(), item])).values()];
};

// Partial patches retain omitted fields. Explicit empty values clear them.
export function normalizeEnquiryPreferences(input = {}) {
  const result = {};
  for (const key of ['styles', 'mustHaveInstruments']) if (Object.hasOwn(input, key)) result[key] = tags(input[key]);
  if (Object.hasOwn(input, 'preferredSize')) result.preferredSize = bounded(input.preferredSize, 80);
  if (Object.hasOwn(input, 'selectedBands')) {
    if (!Array.isArray(input.selectedBands) || input.selectedBands.length > 20) throw new Error('Choose up to 20 bands.');
    const seen = new Set();
    result.selectedBands = input.selectedBands.map(band => {
      if (!band || typeof band !== 'object' || Array.isArray(band)) throw new Error('Invalid selected band.');
      const actId = clean(band.actId);
      if (actId && !/^[a-f0-9]{24}$/i.test(actId)) throw new Error('Invalid selected band reference.');
      const name = bounded(band.name || '', 160);
      const lineupId = bounded(band.lineupId || '', 100);
      if (!actId && !name) throw new Error('Selected bands need a name or catalogue reference.');
      return { ...(actId ? { actId: new mongoose.Types.ObjectId(actId) } : {}), name, lineupId };
    }).filter(band => {
      const key = `${band.actId || band.name.toLowerCase()}|${band.lineupId}`;
      if (seen.has(key)) return false;
      seen.add(key); return true;
    });
  }
  return result;
}

export const enquiryPreferenceSearchValues = row => [
  ...(row?.styles || []), row?.preferredSize, ...(row?.mustHaveInstruments || []),
  ...(row?.selectedBands || []).map(band => band.name),
];

export async function resolveSelectedBands(bands, loadActs) {
  const ids = [...new Set(bands.map(band => clean(band.actId)).filter(Boolean))];
  if (!ids.length) return bands;
  const acts = await loadActs(ids);
  return bands.map(band => {
    if (!band.actId) return band;
    const act = acts.find(item => String(item._id) === String(band.actId));
    if (!act) throw new Error('A selected band could not be found. Please choose it again.');
    if (band.lineupId && !(act.lineups || []).some(lineup => String(lineup.lineupId || lineup._id) === band.lineupId)) throw new Error('A selected lineup no longer belongs to that band.');
    return { ...band, name: clean(act.tscName || act.name) };
  });
}
