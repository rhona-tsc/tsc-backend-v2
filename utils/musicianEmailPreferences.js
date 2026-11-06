import { createHash, createHmac } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { escapeEmailHtml } from './tscEmailBranding.js';
export const normaliseMusicianEmail = email => String(email || '').trim().toLowerCase();
export const musicianEmailHash = email => createHash('sha256').update(normaliseMusicianEmail(email)).digest('hex');
// Preferences links must never double as account authentication tokens.
const secret = () => process.env.EMAIL_UNSUBSCRIBE_SECRET || (process.env.JWT_SECRET ? createHmac('sha256', process.env.JWT_SECRET).update('musician-email-preferences').digest('hex') : undefined);
export function musicianEmailPreferencesUrl(email) {
  const base = String(process.env.ADMIN_FRONTEND_URL || 'https://admin.thesupremecollective.co.uk').replace(/\/+$/, '');
  // A missing signing key falls back to the authenticated account preferences.
  if (!normaliseMusicianEmail(email) || !secret()) return `${base}/email-preferences`;
  const token = jwt.sign({ purpose: 'musician_email_preferences', emailHash: musicianEmailHash(email) }, secret(), { algorithm: 'HS256' });
  return `${base}/email-preferences?token=${encodeURIComponent(token)}`;
}
export function verifyMusicianEmailPreferencesToken(token) {
  const payload = jwt.verify(String(token || ''), secret(), { algorithms: ['HS256'] });
  if (payload.purpose !== 'musician_email_preferences' || !/^[a-f0-9]{64}$/.test(payload.emailHash || '')) throw Object.assign(new Error('Invalid preferences link'), { status: 400 });
  return payload.emailHash;
}
export function addMusicianEmailPreferences({ html = '', text = '', email }) {
  const url = musicianEmailPreferencesUrl(email);
  const link = `<p data-musician-email-preferences style="margin:24px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:20px;color:#666666;"><a href="${escapeEmailHtml(url)}" style="color:#b53639;text-decoration:underline;">Manage email preferences or unsubscribe</a><br>Choose which opportunity emails you receive from The Supreme Collective.</p>`;
  return {
    html: html.includes('data-musician-email-preferences') ? html : html.includes('<!-- musician-email-preferences -->') ? html.replace('<!-- musician-email-preferences -->', link) : /<\/body>/i.test(html) ? html.replace(/<\/body>/i, `${link}</body>`) : `${html}${link}`,
    text: text.includes(url) ? text : `${text}\n\nManage email preferences or unsubscribe: ${url}`,
  };
}
