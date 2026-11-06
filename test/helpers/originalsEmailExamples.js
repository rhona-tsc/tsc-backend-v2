import { buildOriginalSubmissionConfirmationEmail } from '../../utils/originalsSubmissionConfirmationEmail.js';
import { buildOriginalSubmissionEmail, buildOriginalProjectModerationEmail } from '../../services/originalsProjectEmailService.js';
import { buildOriginalProjectApprovedEmail } from '../../services/originalsNotificationService.js';
import { buildOriginalChatEmail } from '../../services/originalsChatNotificationService.js';
import { buildOriginalPrivateInvitationEmail, buildOriginalRoundClosedEmail } from '../../services/originalsRoundLifecycleNotificationService.js';
import { buildOriginalRoundOpenEmail, buildOriginalAgreementReviewEmail } from '../../services/originalsRoundNotificationService.js';
import { buildOriginalReferralEmail } from '../../services/originalsReferralService.js';
import { buildOriginalReservationReminderEmail } from '../../services/originalsReservationReminderService.js';
import { buildOriginalRevisionEmail } from '../../services/originalsRevisionService.js';
import { buildOriginalAgreementReceiptEmail } from '../../services/originalsAgreementReceiptService.js';

export function originalsEmailExamples(overrides = {}) {
  const project = { _id: 'example-project', title: 'Test: Dolly Parton 9to5', ownerName: 'Rhona Downie', ownerEmail: 'owner@example.test', description: 'Record a lively soul arrangement.\nKeep all stems aligned to the project start.', genres: ['Soul'], requestedRoles: [{ name: 'Bass' }], ...overrides.project };
  const firstName = overrides.firstName || 'Rhona';
  const roleName = overrides.roleName || 'Bass';
  const note = overrides.note || 'Please try a quieter second verse.\nKeep the same start point.';
  const deadline = new Date('2026-11-07T14:21:00Z');
  const reservation = { roleName, expiresAt: deadline };
  const submission = { roleName, category: 'contribution', revision: 1, ...overrides.submission };
  const params = { project, firstName };
  const examples = [
    ['moderation', buildOriginalProjectModerationEmail(project)],
    ['project-open', buildOriginalProjectApprovedEmail(params)],
    ['chat', buildOriginalChatEmail(params)],
    ['invitation', buildOriginalPrivateInvitationEmail({ ...params, invitation: { roleName, message: note } })],
    ['recommendation', buildOriginalReferralEmail({ project, referral: { fullName: firstName, referrerName: 'Ewan', roleName, email: 'musician@example.test' }, token: 'example-token' })],
    ['round-open', buildOriginalRoundOpenEmail({ ...params, reservation })],
    ['agreement-review', buildOriginalAgreementReviewEmail({ ...params, reservation })],
    ['round-closed', buildOriginalRoundClosedEmail({ ...params, roleNames: [roleName] })],
  ];
  for (const category of ['contribution', 'mix', 'master']) {
    const contribution = { ...submission, category };
    examples.push([`review-${category}`, buildOriginalSubmissionEmail({ project, submission: contribution })]);
    for (const revision of [1, 2]) examples.push([`receipt-${category}-${revision}`, buildOriginalSubmissionConfirmationEmail({ ...params, submission: { ...contribution, revision } })]);
    examples.push([`reminder-${category}`, buildOriginalReservationReminderEmail({ ...params, reservation, hours: 6, round: { type: category === 'contribution' ? 'instrument' : category } })]);
  }
  for (const action of ['requested', 'opened', 'declined', 'expired', 'escalated']) examples.push([`revision-${action}`, buildOriginalRevisionEmail({ project, submission, action, note, deadline })]);
  for (const type of ['contributor', 'owner', 'mix', 'master']) examples.push([`agreement-${type}`, buildOriginalAgreementReceiptEmail({ projectId: project._id, projectTitle: project.title, roleName, type, fullName: firstName, acceptedAt: new Date('2026-11-06T14:21:00Z') }, firstName)]);
  return examples.map(([name, message]) => ({ name, message }));
}
