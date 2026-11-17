import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import ffmpeg from 'ffmpeg-static';
import cloudinary from '../config/cloudinary.js';
import { Resvg } from '@resvg/resvg-js';
import { managedStoryUrl } from '../utils/bookingStoryPolicy.js';

const escape = s => String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export function storyTemplate(job, imageData) {
  const month = new Date(`${job.eventDateISO}T12:00:00Z`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'Europe/London' }).toUpperCase();
  const text = (value, y, size, color = '#fff8ec', family = 'Lato', weight = '700') => `<text x="540" y="${y}" text-anchor="middle" font-family="${family}" font-weight="${weight}" font-size="${Math.min(size, Math.floor(900 / Math.max(String(value).length * 0.58, 1)))}" fill="${color}">${escape(value)}</text>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="1080" height="1920" viewBox="0 0 1080 1920"><defs><linearGradient id="shade" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#10101b" stop-opacity="0.88"/><stop offset="0.48" stop-color="#10101b" stop-opacity="0.44"/><stop offset="1" stop-color="#10101b" stop-opacity="0.85"/></linearGradient></defs><image xlink:href="${imageData}" width="1080" height="1920" preserveAspectRatio="xMidYMid slice"/><rect width="1080" height="1920" fill="url(#shade)"/>${text('THE SUPREME COLLECTIVE',180,27)}<path d="M420 222H660" stroke="#dfc18d" stroke-width="2"/>${text('JUST BOOKED',326,76)}${text(job.actName.toUpperCase(),410,48,'#dfc18d')}${text('WE’RE HEADING TO',506,23)}${text(job.venueName,595,67,'#fff8ec','Cormorant Garamond','400')}${text(job.venueLocation.toUpperCase(),655,25,'#dfc18d','Lato','400')}${text(month,720,29)}${text('THESUPREMECOLLECTIVE.CO.UK',1750,23)}</svg>`;
}
async function download(url, destination) {
  if (!managedStoryUrl(url)) throw new Error('Use an uploaded Cloudinary story asset.');
  const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(60000) });
  if (!response.ok) throw new Error('Story asset could not be downloaded');
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > 100 * 1024 * 1024) throw new Error('Story asset exceeds 100 MB');
  await writeFile(destination, bytes); return bytes;
}
export async function renderBookingStory(job) {
  if (!job.venueName || !job.eventDateISO || !job.actName) throw new Error('Act, venue and verified event date are required.');
  const folder = await mkdtemp(path.join(os.tmpdir(), 'tsc-story-'));
  try {
    const photo = await download(job.venuePhotoUrl, path.join(folder, 'photo'));
    await download(job.stickerUrl, path.join(folder, 'sticker.webm'));
    const background = new Resvg(storyTemplate(job, `data:image/jpeg;base64,${photo.toString('base64')}`), { font: { loadSystemFonts: false, defaultFontFamily: 'Lato', fontFiles: ['Lato-Regular.ttf', 'Lato-Bold.ttf', 'CormorantGaramond.ttf'].map(name => fileURLToPath(new URL(`../assets/story-fonts/${name}`, import.meta.url))) } }).render().asPng();
    await writeFile(path.join(folder, 'background.png'), background);
    const result = path.join(folder, 'story.mp4');
    await promisify(execFile)(ffmpeg, ['-y', '-filter_complex_threads', '1', '-threads', '1', '-loop', '1', '-i', path.join(folder, 'background.png'),
      '-stream_loop', '-1', '-c:v', 'libvpx-vp9', '-threads', '1', '-i', path.join(folder, 'sticker.webm'),
      '-filter_complex', '[1:v]scale=800:1000:force_original_aspect_ratio=decrease,format=rgba[s];[0:v][s]overlay=(W-w)/2:H-h-290:shortest=1,format=yuv420p[v]',
      '-map', '[v]', '-t', '10', '-r', '30', '-c:v', 'libx264', '-preset', 'fast', '-threads', '1', '-crf', '20', '-movflags', '+faststart', '-an', result], { timeout: 240000 });
    const upload = await cloudinary.uploader.upload(result, { resource_type: 'video', folder: 'tsc/booking-stories', public_id: `${job._id}-${Date.now()}` });
    return upload.secure_url;
  } finally { await rm(folder, { recursive: true, force: true }); }
}
