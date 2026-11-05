import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { v2 as cloudinary } from 'cloudinary';
import Asset from '../models/originalAssetModel.js';
import { loadOriginalRecordingContext } from '../services/originalsRecordingContextService.js';
import { authoriseOriginalAsset } from '../services/originalsAssetAccessService.js';
import { getOriginalsUserId } from '../services/originalsPolicyService.js';
const fail = (res, error) => res.status(error.status || 500).json({ success: false, message: error.status ? error.message : 'Could not prepare the recording' });

async function ownStem(req) {
  const asset = await Asset.findById(req.params.assetId).lean();
  if (!asset || asset.state !== 'active') throw Object.assign(new Error('Stem not found'), { status: 404 });
  if (asset.kind !== 'take_stem' || String(asset.ownerId) !== getOriginalsUserId(req.user)) throw Object.assign(new Error('Only the contributor can confirm this stem'), { status: 403 });
  return asset;
}
export async function getOriginalStemPreview(req, res) {
  try {
    const asset = await ownStem(req);
    const { contextKey, tracks } = await loadOriginalRecordingContext({ projectId: asset.projectId, excludeId: asset._id });
    res.set('Cache-Control', 'no-store');
    return res.json({ success: true, contextKey, stem: { _id: asset._id, originalName: asset.originalName, kind: asset.kind, state: asset.state }, tracks });
  } catch (error) { return fail(res, error); }
}
export async function confirmOriginalStemReview(req, res) {
  try {
    const asset = await ownStem(req);
    if (req.body?.reviewed !== true) return res.status(400).json({ success: false, message: 'Listen to the preview and confirm that the stem lines up.' });
    const { contextKey } = await loadOriginalRecordingContext({ projectId: asset.projectId, excludeId: asset._id });
    if (req.body.contextKey !== contextKey) return res.status(409).json({ success: false, message: 'The approved project tracks have changed. Reload the preview and listen again.' });
    const alignmentReview = { contextKey, reviewedAt: new Date(), reviewedBy: getOriginalsUserId(req.user) };
    const result = await Asset.updateOne({ _id: asset._id, ownerId: alignmentReview.reviewedBy, state: 'active' }, { $set: { alignmentReview } });
    if (!result.matchedCount) return res.status(409).json({ success: false, message: 'This stem is no longer available' });
    return res.json({ success: true, alignmentReview });
  } catch (error) { return fail(res, error); }
}
// Web Audio needs readable bytes. Stream through the authenticated API rather
// than depending on CORS support on a short-lived private Cloudinary download.
export async function streamOriginalAudio(req, res) {
  const abort = new AbortController();
  res.on('close', () => { if (!res.writableFinished) abort.abort(); });
  try {
    const asset = await authoriseOriginalAsset(req);
    if (!asset.mimeType?.startsWith('audio/')) return res.status(415).json({ success: false, message: 'Choose an audio recording' });
    const url = cloudinary.utils.private_download_url(asset.cloudinaryPublicId, asset.cloudinaryFormat || null, { resource_type: asset.cloudinaryResourceType, type: 'authenticated', expires_at: Math.floor(Date.now() / 1000) + 300 });
    const upstream = await fetch(url, { signal: AbortSignal.any([abort.signal, AbortSignal.timeout(60000)]) });
    if (!upstream.ok || !upstream.body) throw Object.assign(new Error('The audio could not be loaded. Please try again.'), { status: 502 });
    let bytes = 0;
    const limit = new Transform({ transform(chunk, encoding, done) { bytes += chunk.length; done(bytes > 100 * 1024 * 1024 ? new Error('Audio exceeds the upload size limit') : null, chunk); } });
    res.set({ 'Content-Type': asset.mimeType, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' });
    await pipeline(Readable.fromWeb(upstream.body), limit, res);
  } catch (error) {
    abort.abort();
    if (!res.headersSent && !res.destroyed) return fail(res, error);
    if (!res.destroyed) res.destroy();
  }
}
