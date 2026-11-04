export const originalTakeAssetIds = takes => takes.flatMap(take => [take.stemAssetId, take.mixdownAssetId, ...(take.wetStemAssetId ? [take.wetStemAssetId] : [])]);
export const originalTakeKindsValid = (takes, assets) => {
  const kinds = new Map(assets.map(asset => [String(asset._id), asset.kind]));
  return takes.every(take => kinds.get(String(take.stemAssetId)) === 'take_stem' && kinds.get(String(take.mixdownAssetId)) === 'take_mixdown' && (!take.wetStemAssetId || (String(take.wetStemAssetId) !== String(take.stemAssetId) && kinds.get(String(take.wetStemAssetId)) === 'take_stem')));
};
