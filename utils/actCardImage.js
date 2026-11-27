// A card uses the act's selected profile photo; wide covers belong on the hero.
const url = value => {
  const item = Array.isArray(value) ? value.find(v => typeof v === 'string' ? v.trim() : v?.url?.trim()) : value;
  return typeof item === 'string' ? item : item?.url || '';
};
export const actCardImage = act => url(act?.profileImage) || url(act?.images) || url(act?.coverImage) || url(act?.heroImage) || '';
