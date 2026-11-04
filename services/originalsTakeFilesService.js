export const originalTakeStems = take => Array.isArray(take.stemAssetIds) ? take.stemAssetIds : take.stemAssetId ? [take.stemAssetId] : [];
export const originalTakeAssetIds = takes => takes.flatMap(take => [...originalTakeStems(take), take.mixdownAssetId, ...(take.wetStemAssetId ? [take.wetStemAssetId] : [])]);
export const originalTakeKindsValid = (takes, assets) => {
  const kinds = new Map(assets.map(asset => [String(asset._id), asset.kind]));
  return takes.every(take => {
    if (take.stemAssetIds !== undefined && !Array.isArray(take.stemAssetIds)) return false;
    const stems = originalTakeStems(take).map(String);
    return stems.length >= 1 && stems.length + (take.wetStemAssetId ? 1 : 0) <= 3 && new Set(stems).size === stems.length && stems.includes(String(take.stemAssetId)) && stems.every(id => kinds.get(id) === 'take_stem') && kinds.get(String(take.mixdownAssetId)) === 'take_mixdown' && (!take.wetStemAssetId || (!stems.includes(String(take.wetStemAssetId)) && kinds.get(String(take.wetStemAssetId)) === 'take_stem'));
  });
};
