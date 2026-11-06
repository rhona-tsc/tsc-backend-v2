import { buildOriginalsEmail } from './originalsEmailTemplate.js';

export const buildOriginalSubmissionConfirmationEmail = ({ project, submission, firstName = 'there' }) => {
  const title = project.title || 'Your Originals project';
  const role = submission.roleName || 'Project role';
  const updated = Number(submission.revision || 1) > 1;
  const type = submission.category === 'mix' ? 'mix' : submission.category === 'master' ? 'master' : 'take';
  const heading = `Your ${updated ? 'updated ' : ''}${type} has been submitted`;
  const description = `We’ve received your ${updated ? 'updated ' : ''}${type} for ${role} on “${title}”. Thank you for contributing to the project.`;
  const next = 'This confirms your submission was received. Selection is confirmed separately; you can check its status in the project workspace.';
  const base = String(process.env.ADMIN_FRONTEND_URL || 'https://admin.thesupremecollective.co.uk').replace(/\/$/, '');
  const url = `${base}/originals/${encodeURIComponent(String(project._id))}`;
  return buildOriginalsEmail({
    subject: `${updated ? 'Updated submission' : 'Submission'} received: ${role} — ${title}`,
    heading, firstName, paragraphs: [description, next], buttonUrl: url, buttonLabel: 'View the project',
  });
};
