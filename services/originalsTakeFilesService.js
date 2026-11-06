export const originalTakeStems = take => Array.isArray(take.stemAssetIds) ? take.stemAssetIds : take.stemAssetId ? [take.stemAssetId] : [];
export const originalTakeAssetIds = takes => takes.flatMap(take => [...originalTakeStems(take), ...(take.mixdownAssetId ? [take.mixdownAssetId] : []), ...(take.wetStemAssetId ? [take.wetStemAssetId] : [])]);
// Listening mixes remain valid optional references, but new contributions can
// be reviewed against the project stems directly in the browser.
export const originalTakeNeedsListeningMix = () => false;
export const originalTakeKindsValid = (takes, assets, { listeningMixRequired = true } = {}) => {
  const kinds = new Map(assets.map(asset => [String(asset._id), asset.kind]));
  const allStems = takes.flatMap(take => [...originalTakeStems(take), ...(take.wetStemAssetId ? [take.wetStemAssetId] : [])]);
  if (new Set(allStems.map(String)).size > 4) return false;
  return takes.every(take => {
    if (take.effects !== undefined && !['with_effects', 'without_effects', 'not_specified'].includes(take.effects)) return false;
    if (take.stemAssetIds !== undefined && !Array.isArray(take.stemAssetIds)) return false;
    const stems = originalTakeStems(take).map(String);
    const mixValid = take.mixdownAssetId ? kinds.get(String(take.mixdownAssetId)) === 'take_mixdown' : !listeningMixRequired;
    return stems.length >= 1 && stems.length + (take.wetStemAssetId ? 1 : 0) <= 4 && new Set(stems).size === stems.length && stems.includes(String(take.stemAssetId)) && stems.every(id => kinds.get(id) === 'take_stem') && mixValid && (!take.wetStemAssetId || (!stems.includes(String(take.wetStemAssetId)) && kinds.get(String(take.wetStemAssetId)) === 'take_stem'));
  });
};
