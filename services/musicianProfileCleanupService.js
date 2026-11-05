const protectedEmails = new Set(['hello@thesupremecollective.co.uk', 'rhona@thesupremecollective.co.uk']);
const emailOf = record => String(record?.email || '').trim().toLowerCase();

export function planMusicianProfileCleanup(records = []) {
  const plan = { remove: [], retainAsTest: [], protected: [] };
  for (const record of records) {
    const email = emailOf(record);
    if (protectedEmails.has(email)) { plan.protected.push(record); continue; }
    if (!/@thesupremecollective\.co\.uk$/.test(email) && !/^tsc[^@\s]*@gmail\.com$/.test(email)) continue;
    const firstName = String(record.firstName || record.basicInfo?.firstName || '').trim();
    if (/^rowan$/i.test(firstName) || record.privateTestProfile === true && record.musicianSlug === 'tsc-invite-test') plan.retainAsTest.push(record);
    else plan.remove.push(record);
  }
  return plan;
}

export const privateTestProfileUpdate = {
  firstName: 'Test', lastName: '', name: 'Test',
  'basicInfo.firstName': 'Test', 'basicInfo.lastName': '',
  musicianSlug: 'tsc-invite-test', privateTestProfile: true,
};
