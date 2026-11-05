import { escapeEmailHtml as escape, buildTscEmailFooter, buildTscEmailFooterText } from './tscEmailBranding.js';

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
  return {
    subject: `${updated ? 'Updated submission' : 'Submission'} received: ${role} — ${title}`,
    text: `Hi ${firstName},\n\n${description}\n\n${next}\n\nView the project: ${url}\n\nWarmest wishes,\nThe Supreme Collective\n\n${buildTscEmailFooterText()}`,
    html: `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Submission received</title></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:Arial,Helvetica,sans-serif;color:#111111;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:640px;background:#ffffff;border:1px solid #e5e7eb;border-radius:20px;">
<tr><td style="padding:26px 24px;background:#111111;border-radius:20px 20px 0 0;">
<p style="margin:0 0 12px;font-size:12px;line-height:18px;letter-spacing:2px;font-weight:700;color:#ff8585;">TSC ORIGINALS</p>
<h1 style="margin:0;font-size:28px;line-height:35px;color:#ffffff;">${escape(heading)}</h1></td></tr>
<tr><td style="padding:28px 24px;">
<p style="margin:0 0 18px;font-size:16px;line-height:26px;">Hi ${escape(firstName)},</p>
<p style="margin:0 0 18px;font-size:16px;line-height:26px;color:#444444;">${escape(description)}</p>
<p style="margin:0 0 18px;font-size:16px;line-height:26px;color:#444444;">${escape(next)}</p>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0;"><tr><td bgcolor="#ff6667" style="border-radius:8px;text-align:center;">
<a href="${escape(url)}" style="display:inline-block;padding:14px 24px;font-size:16px;line-height:24px;font-weight:700;color:#111111;text-decoration:none;">View the project</a></td></tr></table>
<p style="margin:0;font-size:15px;line-height:25px;color:#444444;">Warmest wishes,<br><strong>The Supreme Collective</strong></p>
${buildTscEmailFooter({ audience: 'musician' })}
</td></tr></table></td></tr></table></body></html>`,
  };
};
