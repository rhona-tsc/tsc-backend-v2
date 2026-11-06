const PRIVATE_TEST_VIEWERS = new Set([
  'hello@thesupremecollective.co.uk',
  'rhona@thesupremecollective.co.uk',
  'rhonagdownie@gmail.com',
]);

// Pass only the authenticated token user, never a query/body supplied identity.
export const canSeePrivateTestMusicians = (user = {}) => PRIVATE_TEST_VIEWERS.has(
  String(user?.email || user?.useremail || '').trim().toLowerCase(),
);
export const musicianDirectoryVisibility = user => ({ profileDeletedAt: null, ...(canSeePrivateTestMusicians(user) ? {} : { privateTestProfile: { $ne: true } }) });
export const canSeeMusicianInDirectory = (musician, user) => !musician?.profileDeletedAt && (!musician?.privateTestProfile || canSeePrivateTestMusicians(user));
