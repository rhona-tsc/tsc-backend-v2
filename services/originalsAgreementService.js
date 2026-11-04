import { createHash } from 'node:crypto';
import Acceptance from '../models/originalAgreementAcceptanceModel.js';

export const originalAgreementType = round => ['mix', 'master'].includes(round?.type) ? round.type : 'contributor';
const notice = 'Provisional private-pilot terms. These terms still require specialist UK music-law review before public launch.';
const common = [
  { title: 'Confidentiality and project use', text: 'Keep unreleased music, reference files, messages and participant information confidential. Use project material only for this collaboration. Do not reuse it on other records, use it for DJ performances or training, or redistribute it outside the project without the relevant written permission.' },
  { title: 'Selection and rejected material', text: 'A reservation or submission does not guarantee selection. The owner may select a whole take or part of a take. Multiple selected takes or ranges by the same person in one role count as one role share. Rejected material remains its contributor’s property and must not be reused or distributed. Any later reinstatement requires a recorded decision and review of the contributor’s rights and royalty position.' },
  { title: 'Master income', text: 'After contractually permitted direct costs, the pilot master-income framework allocates 20% to TSC, 20% to the project owner, 40% equally across accepted contributor roles, 10% to the selected mix producer and 10% to the selected mastering engineer. One person can earn shares for more than one accepted role. These are contractual master-income allocations; statutory performer allocations remain separately tracked.' },
  { title: 'Songwriting and final splits', text: 'Songwriting is separate from master income. At submission, declare whether you request a songwriting contribution as well as master royalties and describe the original composition you contributed. Where the owner supplies source material, it forms an initial writing unit and each accepted creative role adds a potential equal unit: claimed units go to the contributor and unclaimed units accrue to the original owner/songwriter. Without owner source material, writing is shared equally between accepted roles claiming songwriting; if nobody claims, it is shared equally between accepted foundation roles. Listing alone creates no writing share. These provisional rules do not override statutory authorship or performer rights. Affected parties must confirm the versioned final splits before the master progresses beyond the pilot.' },
  { title: 'Credits, identity and records', text: 'Use your public name or chosen artistic credit name. Anonymity does not remove TSC’s private identity and audit records. TSC retains original files, decisions and agreement evidence for audit and disputes, including where files are hidden from ordinary participants. Legal identity remains private to TSC except where disclosure is required for a dispute, legal obligation or separately agreed next phase.' },
  { title: 'Scope and future changes', text: 'These terms cover the private Phase 1 collaboration. Release, distribution, collection-society registration, sync, promotion and live activity require separate arrangements. The exact accepted wording, version, name, account, project, role and time are retained. Changed terms require fresh acceptance; earlier evidence is retained.' },
];

export function getOriginalAgreement(type = 'contributor') {
  if (!['contributor', 'mix', 'master'].includes(type)) throw Object.assign(new Error('Unknown agreement type'), { status: 400 });
  const production = type !== 'contributor';
  const title = production ? `${type === 'mix' ? 'Mix producer' : 'Mastering engineer'} agreement` : 'Contributor agreement';
  const version = `originals-${type}-v0.1-legal-review`;
  const sections = [
    { title: 'Reservation and deliverables', text: production
      ? `Your recording reservation lasts 24 hours once this round opens and your place activates. Up to three extensions may be approved separately. Submit the ${type === 'mix' ? 'mix' : 'master'} output specified in the project brief. The selected ${type === 'mix' ? 'mix producer' : 'mastering engineer'} receives the 10% selected-role master allocation. Controlled source downloads are authorised only for this project. Rejected material requires recorded authorisation and contributor-rights review before use.`
      : 'An advance place has no recording countdown until its round opens. A recording reservation then lasts 24 hours; extensions require separate approval, up to three times. Provide one to three aligned instrument stems and one listening mix combining them with the authorised reference. Reference access is restricted and expires when participation ends unless an accepted contribution or later role requires continued access. Reference material must not be used outside this project.' },
    ...common.map(section => production && section.title === 'Songwriting and final splits'
      ? { ...section, text: 'Selection as a mix producer or mastering engineer carries the selected-role master allocation; it does not automatically create a songwriting share. Songwriting remains separate and is determined from accepted creative contributions and their recorded claims. Final master and composition splits are versioned and require confirmation by the affected parties before progression beyond the pilot. Statutory authorship and performer rights are not overridden by this acknowledgement.' }
      : { ...section }),
  ];
  const text = [title, version, notice, ...sections.flatMap(section => [section.title, section.text])].join('\n\n');
  return { type, title, version, notice, sections, text, textHash: createHash('sha256').update(text).digest('hex') };
}

const required = message => Object.assign(new Error(message), { status: 409, code: 'ORIGINALS_AGREEMENT_REQUIRED' });
export async function recordOriginalAgreement({ input, projectId, musicianId, roleName, type = 'contributor', now = new Date() }) {
  const agreement = getOriginalAgreement(type);
  if (input?.accepted !== true) throw required('Read and accept the agreement before reserving a place.');
  if (input.version !== agreement.version || input.textHash !== agreement.textHash) throw required('The agreement has changed. Review the current version before reserving.');
  const fullName = typeof input.fullName === 'string' ? input.fullName.trim().replace(/\s+/g, ' ') : '';
  if (!fullName || fullName.length > 160 || /[\x00-\x1f\x7f]/.test(input.fullName)) throw Object.assign(new Error('Enter your full name to acknowledge the agreement.'), { status: 400 });
  return Acceptance.create({ projectId, musicianId, roleName: String(roleName).trim().toLowerCase(), type, version: agreement.version, text: agreement.text, textHash: agreement.textHash, fullName, accepted: true, acceptedAt: now });
}

export async function requireCurrentOriginalAgreement({ agreementAcceptanceId, projectId, musicianId, roleName, type = 'contributor' }) {
  const current = getOriginalAgreement(type);
  const saved = agreementAcceptanceId ? await Acceptance.findById(agreementAcceptanceId).lean() : null;
  if (!saved || saved.accepted !== true || !saved.acceptedAt || !saved.fullName || String(saved.projectId) !== String(projectId) || String(saved.musicianId) !== String(musicianId) || saved.roleName !== String(roleName).trim().toLowerCase() || saved.type !== type || saved.version !== current.version || saved.textHash !== current.textHash || saved.text !== current.text) throw required('Review and accept the current agreement before this place can become a recording reservation.');
  return saved;
}
