import Musician from '../models/musicianModel.js';
import { decryptSocialToken } from '../utils/socialTokenCrypto.js';

const version = () => process.env.META_GRAPH_VERSION || 'v23.0';
export async function graph(path, token, data, method = data ? 'POST' : 'GET') {
  const response = await fetch(`https://graph.facebook.com/${version()}/${path}`, {
    method, headers: { Authorization: `Bearer ${token}`, ...(data ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) },
    ...(data ? { body: new URLSearchParams(data) } : {}), signal: AbortSignal.timeout(45000),
  });
  const body = await response.json();
  if (!response.ok || body.error) throw new Error(body.error?.message || `Meta request failed (${response.status})`);
  return body;
}
export async function publisherConnection(settings, { revealToken = false } = {}) {
  const musician = settings.accountMusicianId && await Musician.findById(settings.accountMusicianId)
    .select('socialConnections.meta +socialConnections.meta.accessTokenEncrypted').lean();
  const c = musician?.socialConnections?.meta;
  const missing = ['instagram_content_publish', 'pages_manage_posts'].filter(p => !c?.scopes?.includes(p));
  const matches = Boolean(c?.accountId && c?.pageId && c.accountId === settings.expectedInstagramId && c.pageId === settings.expectedPageId);
  const expired = c?.expiresAt && new Date(c.expiresAt) <= new Date();
  const ready = matches && !expired && !missing.length && Boolean(c?.accessTokenEncrypted);
  const result = { ready, instagramId: c?.accountId || '', pageId: c?.pageId || '', missing,
    reason: !matches ? 'Choose and verify the TSC publishing account.' : expired ? 'Meta connection expired. Reconnect.'
      : missing.length ? `Reconnect Meta with publishing access: ${missing.join(', ')}` : '', };
  if (revealToken && ready) result.token = decryptSocialToken(c.accessTokenEncrypted);
  return result;
}

// Persist each provider ID before advancing. An ambiguous publish response is
// held for manual reconciliation rather than risking a second public story.
export async function publishStoryDestination(job, platform, connection) {
  const token = connection.token;
  const state = job[platform];
  if (state.state === 'published' || state.state === 'needs_check') return;
  try {
    if (platform === 'instagram') {
      if (!state.containerId) {
        const created = await graph(`${connection.instagramId}/media`, token, { media_type: 'STORIES', video_url: job.mediaUrl });
        if (!created.id) throw new Error('Meta did not return an Instagram container ID');
        state.containerId = created.id; state.state = 'processing'; await job.save();
      }
      const progress = await graph(`${state.containerId}?fields=status_code,status`, token);
      if (progress.status_code === 'ERROR' || progress.status_code === 'EXPIRED') throw new Error(progress.status || 'Instagram processing failed');
      if (progress.status_code !== 'FINISHED') return;
      state.state = 'publishing'; await job.save();
      const published = await graph(`${connection.instagramId}/media_publish`, token, { creation_id: state.containerId });
      if (!published.id) throw new Error('Instagram publish outcome is unknown');
      state.mediaId = published.id;
    } else {
      if (!state.containerId) {
        const upload = await graph(`${connection.pageId}/video_stories`, token, { upload_phase: 'start' });
        if (!upload.video_id || !upload.upload_url) throw new Error('Facebook did not return an upload session');
        const target = new URL(upload.upload_url);
        if (target.protocol !== 'https:' || target.hostname !== 'rupload.facebook.com') throw new Error('Unexpected Meta upload destination');
        state.containerId = upload.video_id; state.state = 'uploading'; await job.save();
        const response = await fetch(target, { method: 'POST', headers: { Authorization: `OAuth ${token}`, file_url: job.mediaUrl }, signal: AbortSignal.timeout(60000) });
        const body = await response.json(); if (!response.ok || !body.success) throw new Error(body.error?.message || 'Facebook video upload failed');
        state.state = 'processing'; await job.save();
      }
      const progress = await graph(`${state.containerId}?fields=status`, token);
      if (progress.status?.video_status === 'error') throw new Error('Facebook video processing failed');
      if (progress.status?.video_status !== 'ready') return;
      state.state = 'publishing'; await job.save();
      const published = await graph(`${connection.pageId}/video_stories`, token, { upload_phase: 'finish', video_id: state.containerId });
      if (!published.success) throw new Error('Facebook publish outcome is unknown');
      state.mediaId = published.post_id || state.containerId;
    }
    state.state = 'published'; state.publishedAt = new Date(); state.error = ''; await job.save();
  } catch (error) {
    state.error = error.message;
    state.state = 'needs_check';
    await job.save();
  }
}
