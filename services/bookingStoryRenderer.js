import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';
import cloudinary from '../config/cloudinary.js';
import { managedStoryUrl } from '../utils/bookingStoryPolicy.js';

const escape = s => String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export function storyTemplate(job, imageData) {
  const month = new Date(`${job.eventDateISO}T12:00:00Z`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'Europe/London' }).toUpperCase();
  const text = (value, y, size, color = '#fff8ec', family = 'Lato', weight = '700') => `<text x="540" y="${y}" text-anchor="middle" font-family="${family}" font-weight="${weight}" font-size="${Math.min(size, Math.floor(900 / Math.max(String(value).length * 0.58, 1)))}" fill="${color}">${escape(value)}</text>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="1080" height="1920" viewBox="0 0 1080 1920"><defs><linearGradient id="shade" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#10101b" stop-opacity="0.88"/><stop offset="0.48" stop-color="#10101b" stop-opacity="0.44"/><stop offset="1" stop-color="#10101b" stop-opacity="0.85"/></linearGradient></defs><image xlink:href="${imageData}" width="1080" height="1920" preserveAspectRatio="xMidYMid slice"/><rect width="1080" height="1920" fill="url(#shade)"/>${text('THE SUPREME COLLECTIVE',180,27)}<path d="M420 222H660" stroke="#dfc18d" stroke-width="2"/>${text('JUST BOOKED',326,76)}${text(job.actName.toUpperCase(),410,48,'#dfc18d')}${text('WE’RE HEADING TO',506,23)}${text(job.venueName,595,67,'#fff8ec','Cormorant Garamond','400')}${text(job.venueLocation.toUpperCase(),655,25,'#dfc18d','Lato','400')}${text(month,720,29)}${text('THESUPREMECOLLECTIVE.CO.UK',1750,23)}</svg>`;
}
export async function renderBookingStory(job) {
  if (!job.venueName || !job.eventDateISO || !job.actName) throw new Error('Act, venue and verified event date are required.');
  if (!managedStoryUrl(job.venuePhotoUrl) || !managedStoryUrl(job.stickerUrl)) throw new Error('Use uploaded story assets.');
  const stickerPath = new URL(job.stickerUrl).pathname.match(/^\/[^/]+\/video\/upload\/v\d+\/(.+)\.[^/.]+$/)?.[1];
  if (!stickerPath) throw new Error('Use an original uploaded transparent video sticker.');
  const response = await fetch(job.venuePhotoUrl, { redirect: 'error', signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error('Venue photo could not be downloaded');
  const photo = Buffer.from(await response.arrayBuffer());
  if (photo.length > 20 * 1024 * 1024) throw new Error('Use a venue photo smaller than 20 MB');
  const background = new Resvg(storyTemplate(job, `data:image/jpeg;base64,${photo.toString('base64')}`), { font: { loadSystemFonts: false, defaultFontFamily: 'Lato', fontFiles: ['Lato-Regular.ttf', 'Lato-Bold.ttf', 'CormorantGaramond.ttf'].map(name => fileURLToPath(new URL(`../assets/story-fonts/${name}`, import.meta.url))) } }).render().asPng();
  const uploaded = await new Promise((resolve, reject) => {
    cloudinary.uploader.upload_stream({ resource_type: 'image', folder: 'tsc/booking-story-backgrounds', public_id: `${job._id}-${Date.now()}` }, (e, r) => e ? reject(e) : resolve(r)).end(background);
  });
  // Assemble remotely: the website's small web worker never runs a video encoder.
  const result = await cloudinary.uploader.explicit(process.env.STORY_CANVAS_PUBLIC_ID || 'tsc/booking-story-assets/story-canvas-5s', {
    resource_type: 'video', type: 'upload', eager_async: false,
    eager: [{ format: 'mp4', transformation: [
      { overlay: uploaded.public_id.replaceAll('/', ':') }, { width: 1080, height: 1920, crop: 'fill' }, { flags: 'layer_apply' },
      { overlay: `video:${decodeURIComponent(stickerPath).replaceAll('/', ':')}` }, { width: 800, height: 1000, crop: 'fit' },
      { flags: 'layer_apply', gravity: 'south', y: 290 }, { video_codec: 'h264', quality: 'auto:good' },
    ] }],
  });
  const url = result.eager?.[0]?.secure_url;
  if (!url || result.eager[0].status === 'failed') throw new Error('Story video assembly failed; try again.');
  return url;
}
