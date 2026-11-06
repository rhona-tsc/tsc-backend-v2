import { escapeEmailHtml, buildTscEmailFooter, buildTscEmailFooterText } from './tscEmailBranding.js';

export const originalsEmailParagraph = value => `<p style="margin:0 0 18px;font-size:16px;line-height:26px;color:#444444;">${escapeEmailHtml(value).replace(/\r\n|\r|\n/g, '<br>')}</p>`;

// All Originals messages use the submission receipt's layout. bodyHtml must be
// built from escaped values by the caller; ordinary paragraphs are escaped here.
export function buildOriginalsEmail({ subject, heading, firstName = 'there', paragraphs = [], bodyHtml, bodyText, buttonLabel = 'Open the project', buttonUrl, afterButton = [] }) {
  const content = bodyHtml ?? paragraphs.map(originalsEmailParagraph).join('\n');
  const text = [
    `Hi ${firstName},`, bodyText ?? paragraphs.join('\n\n'), `${buttonLabel}: ${buttonUrl}`,
    ...afterButton, 'Warmest wishes,\nThe Supreme Collective', buildTscEmailFooterText(),
  ].filter(Boolean).join('\n\n');
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeEmailHtml(heading)}</title></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:Arial,Helvetica,sans-serif;color:#111111;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f3f4f6;"><tr><td align="center" style="padding:24px 12px;">
<!--[if mso]><table role="presentation" width="640" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:640px;background:#ffffff;border:1px solid #e5e7eb;border-radius:20px;">
<tr><td style="padding:26px 24px;background:#111111;border-radius:20px 20px 0 0;">
<p style="margin:0 0 12px;font-size:12px;line-height:18px;letter-spacing:2px;font-weight:700;color:#ff8585;">TSC ORIGINALS</p>
<h1 style="margin:0;font-size:28px;line-height:35px;color:#ffffff;">${escapeEmailHtml(heading)}</h1></td></tr>
<tr><td style="padding:28px 24px;word-break:break-word;overflow-wrap:anywhere;">
${originalsEmailParagraph(`Hi ${firstName},`)}
${content}
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0;"><tr><td bgcolor="#ff6667" style="border-radius:8px;text-align:center;">
<a href="${escapeEmailHtml(buttonUrl)}" style="display:inline-block;padding:14px 24px;font-size:16px;line-height:24px;font-weight:700;color:#111111;text-decoration:none;">${escapeEmailHtml(buttonLabel)}</a></td></tr></table>
${afterButton.map(originalsEmailParagraph).join('\n')}
<p style="margin:0;font-size:15px;line-height:25px;color:#444444;">Warmest wishes,<br><strong>The Supreme Collective</strong></p>
${buildTscEmailFooter({ audience: 'musician' })}
<!-- musician-email-preferences -->
</td></tr></table><!--[if mso]></td></tr></table><![endif]--></td></tr></table></body></html>`;
  return { subject, text, html };
}
