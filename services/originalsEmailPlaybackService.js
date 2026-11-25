import { createHmac } from 'node:crypto';
import jwt from 'jsonwebtoken';

const playbackSecret = () => {
  if (process.env.ORIGINALS_EMAIL_PLAYBACK_SECRET) return process.env.ORIGINALS_EMAIL_PLAYBACK_SECRET;
  if (!process.env.JWT_SECRET) throw new Error('Originals email playback secret is not configured');
  return createHmac('sha256', process.env.JWT_SECRET).update('originals-email-playback-v1').digest('hex');
};

export function createOriginalsEmailPlaybackToken({ projectId, assetId, musicianId }) {
  return jwt.sign({
    purpose: 'originals_email_playback',
    projectId: String(projectId),
    assetId: String(assetId),
    musicianId: String(musicianId || ''),
  }, playbackSecret(), { algorithm: 'HS256', expiresIn: '30d' });
}

export function verifyOriginalsEmailPlaybackToken(token) {
  const payload = jwt.verify(String(token || ''), playbackSecret(), { algorithms: ['HS256'] });
  if (payload?.purpose !== 'originals_email_playback' || !payload.projectId || !payload.assetId) {
    throw new Error('Invalid Originals playback link');
  }
  return payload;
}

export function originalsEmailPlaybackUrls(token) {
  const base = String(process.env.BACKEND_PUBLIC_URL || process.env.BACKEND_URL || 'https://tsc-backend-v2.onrender.com').replace(/\/+$/, '');
  const encoded = encodeURIComponent(token);
  return {
    listenUrl: `${base}/api/originals/email-listen/${encoded}`,
    audioUrl: `${base}/api/originals/email-listen/${encoded}/audio`,
  };
}
