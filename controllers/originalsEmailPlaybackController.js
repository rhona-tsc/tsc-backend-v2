import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { v2 as cloudinary } from 'cloudinary';
import Asset from '../models/originalAssetModel.js';
import Project from '../models/originalProjectModel.js';
import { escapeEmailHtml } from '../utils/tscEmailBranding.js';
import { verifyOriginalsEmailPlaybackToken } from '../services/originalsEmailPlaybackService.js';

const unavailableStates = new Set(['paused', 'cancelled', 'archived']);
const playableKinds = new Set(['guide_track']);

async function authorisedRecording(token) {
  const payload = verifyOriginalsEmailPlaybackToken(token);
  const [project, asset] = await Promise.all([
    Project.findById(payload.projectId).select('title state moderation.status').lean(),
    Asset.findById(payload.assetId).lean(),
  ]);
  if (!project || project.moderation?.status !== 'approved' || unavailableStates.has(project.state)) throw Object.assign(new Error('This listening link is no longer available.'), { status: 404 });
  if (!asset || String(asset.projectId) !== String(project._id) || asset.state !== 'active' || !playableKinds.has(asset.kind) || !asset.mimeType?.startsWith('audio/')) throw Object.assign(new Error('This guide recording is no longer available.'), { status: 404 });
  return { project, asset };
}

const fail = (res, error) => res.status(error.status || 404).type('text/plain').send(error.status ? error.message : 'This listening link is unavailable.');

export async function streamOriginalsEmailRecording(req, res) {
  const abort = new AbortController();
  res.on('close', () => { if (!res.writableFinished) abort.abort(); });
  try {
    const { asset } = await authorisedRecording(req.params.token);
    const url = cloudinary.utils.private_download_url(asset.cloudinaryPublicId, asset.cloudinaryFormat || null, { resource_type: asset.cloudinaryResourceType, type: 'authenticated', expires_at: Math.floor(Date.now() / 1000) + 300 });
    const headers = req.headers.range ? { Range: req.headers.range } : undefined;
    const upstream = await fetch(url, { headers, signal: AbortSignal.any([abort.signal, AbortSignal.timeout(60000)]) });
    if (!upstream.ok || !upstream.body) throw Object.assign(new Error('The guide recording could not be loaded.'), { status: 502 });
    let bytes = 0;
    const limit = new Transform({ transform(chunk, encoding, done) { bytes += chunk.length; done(bytes > 100 * 1024 * 1024 ? new Error('Audio exceeds the playback limit') : null, chunk); } });
    const responseHeaders = { 'Content-Type': asset.mimeType, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Accept-Ranges': upstream.headers.get('accept-ranges') || 'bytes' };
    for (const name of ['content-length', 'content-range']) { const value = upstream.headers.get(name); if (value) responseHeaders[name] = value; }
    res.status(upstream.status).set(responseHeaders);
    await pipeline(Readable.fromWeb(upstream.body), limit, res);
  } catch (error) {
    abort.abort();
    if (!res.headersSent && !res.destroyed) return fail(res, error);
    if (!res.destroyed) res.destroy();
  }
}

export async function showOriginalsEmailListeningPage(req, res) {
  try {
    const { project, asset } = await authorisedRecording(req.params.token);
    const title = escapeEmailHtml(project.title || 'TSC Originals guide recording');
    const audioUrl = `/api/originals/email-listen/${encodeURIComponent(req.params.token)}/audio`;
    const projectUrl = `${String(process.env.ADMIN_FRONTEND_URL || 'https://admin.thesupremecollective.co.uk').replace(/\/+$/, '')}/originals/${encodeURIComponent(String(project._id))}`;
    res.set({ 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex, nofollow', 'Content-Security-Policy': "default-src 'none'; media-src 'self'; style-src 'unsafe-inline'; img-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'" });
    return res.type('html').send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} — TSC Originals</title></head><body style="margin:0;background:#f3f4f6;color:#111;font-family:Arial,Helvetica,sans-serif"><main style="max-width:620px;margin:48px auto;padding:0 18px"><section style="overflow:hidden;background:#fff;border:1px solid #e5e7eb;border-radius:22px;box-shadow:0 14px 40px rgba(17,24,39,.08)"><header style="padding:28px;background:#111;color:#fff"><div style="color:#ff8585;font-size:12px;font-weight:700;letter-spacing:2px">TSC ORIGINALS</div><h1 style="margin:12px 0 6px;font-size:30px">${title}</h1><p style="margin:0;color:#d1d5db">Guide recording</p></header><div style="padding:30px"><p style="margin:0 0 18px;line-height:1.6;color:#444">The vocal is a guide and will be rerecorded. The lyrics and melody are the direction we expect to keep.</p><audio controls preload="metadata" style="display:block;width:100%"><source src="${audioUrl}" type="${escapeEmailHtml(asset.mimeType)}">Your browser cannot play this recording.</audio><p style="margin:24px 0 0"><a href="${escapeEmailHtml(projectUrl)}" style="display:inline-block;padding:14px 22px;border-radius:9px;background:#ff6667;color:#111;text-decoration:none;font-weight:700">Open the project</a></p></div></section></main></body></html>`);
  } catch (error) { return fail(res, error); }
}
