export const cleanBandSheetToken = (value = "") =>
  String(value || "").trim();

export const bandSheetTokenLookup = (value = "") => {
  const token = cleanBandSheetToken(value);
  return token
    ? {
        $or: [
          { "eventSheet.bandSheetToken": token },
          { bandSheetTokens: token },
        ],
      }
    : { _id: null };
};

export const bandSheetTokenPersistenceUpdate = (value = "") => {
  const token = cleanBandSheetToken(value);
  if (!token) return null;
  return {
    $set: { "eventSheet.bandSheetToken": token },
    $addToSet: { bandSheetTokens: token },
  };
};
