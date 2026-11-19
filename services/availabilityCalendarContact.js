const clean = value => String(value || '').trim();
const email = value => clean(value).toLowerCase();
const phone = value => {
  let result = clean(value).replace(/^whatsapp:/i, '').replace(/[\s()-]/g, '');
  if (result.startsWith('00')) result = `+${result.slice(2)}`;
  if (/^0\d{10}$/.test(result)) result = `+44${result.slice(1)}`;
  if (/^44\d+$/.test(result)) result = `+${result}`;
  return result;
};
const contactPhone = person => phone(person?.phoneNormalized || person?.phone || person?.phoneNumber);

// A name is display text, never evidence that an email belongs to the respondent.
export function availabilityCalendarContact({ request, musician, act }) {
  const sender = contactPhone(request);
  if (!sender) return null;
  if (musician && contactPhone(musician) !== sender) {
    throw new Error('Calendar contact does not match the availability respondent.');
  }
  const canonicalEmail = email(musician?.email);
  if (canonicalEmail) return canonicalEmail;
  const lineup = act?.lineups?.find(item => String(item._id) === String(request.lineupId));
  const contacts = (lineup?.bandMembers || []).flatMap(member => [member, ...(member.deputies || [])]);
  const emails = [...new Set(contacts.filter(member => contactPhone(member) === sender)
    .map(member => email(member.email)).filter(Boolean))];
  if (emails.length > 1) throw new Error('Multiple emails match this lineup contact; calendar invitation held.');
  return emails[0] || null;
}
