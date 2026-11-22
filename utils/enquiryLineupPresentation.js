import { isEnquiryOnlyLineup, websiteActView } from './websiteLineups.js';

const ids = lineup => [lineup?._id, lineup?.lineupId].filter(Boolean).map(String);
export const sameLineup = (lineup, id) => ids(lineup).includes(String(id || ''));
export const htmlEscape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

// Only a selected lineup from the exact availability/enquiry context may be
// added to the public catalogue. Never use an act/date-wide availability badge.
export function lineupsForEnquiry(act, selectedId) {
  const publicLineups = websiteActView(act)?.lineups || [];
  const selected = (act?.lineups || []).find(l => sameLineup(l, selectedId));
  return selected && isEnquiryOnlyLineup(selected)
    ? [selected, ...publicLineups]
    : publicLineups;
}

export function bespokeLineupDescription(lineup) {
  const members = (lineup?.bandMembers || []).filter(m => {
    const role = String(m.instrument || m.role || '').trim();
    return role && !m.isManager && !m.isNonPerformer &&
      !/manager|management|sound engineer|sound tech|audio engineer|\bfoh\b/i.test(role);
  });
  const count = members.length;
  const label = count === 1 ? 'Solo' : count === 2 ? 'Duo' : count === 3 ? 'Trio' : `${count}-piece`;
  const roles = members.map(m => String(m.instrument || m.role).trim());
  return { label, description: `${label}: ${roles.join(', ') || 'Your agreed bespoke lineup'}` };
}

export function bespokeBookingAction({ lineup, enquiryRef, agent, dateISO, actName }) {
  const { label } = bespokeLineupDescription(lineup);
  // Encore pricing and acceptance stay on Encore, never a freshly calculated
  // website cart price. Agency enquiries remain with their original agent.
  if (/^encore$/i.test(String(agent || '')) && /^[a-z0-9]{5}$/i.test(String(enquiryRef || ''))) {
    return { label: `Book this ${label.toLowerCase()} on Encore`, url: `https://encoremusicians.com/jobs/${enquiryRef}` };
  }
  const subject = `Book ${actName || 'the band'} — ${label.toLowerCase()} — ${dateISO} — ${enquiryRef || ''}`;
  return { label: `Request to book this ${label.toLowerCase()}`, url: `mailto:hello@thesupremecollective.co.uk?subject=${encodeURIComponent(subject)}` };
}
