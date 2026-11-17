import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import ffmpeg from 'ffmpeg-static';
import cloudinary from '../config/cloudinary.js';
import { launchPdfBrowser } from './pdfRenderer.js';
import { managedStoryUrl } from '../utils/bookingStoryPolicy.js';

const escape = s => String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export function storyTemplate(job, imageData) {
  const month = new Date(`${job.eventDateISO}T12:00:00Z`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'Europe/London' }).toUpperCase();
  return `<html><style>*{box-sizing:border-box}body{margin:0;width:1080px;height:1920px;background:#111;color:#fff8ec;text-align:center;font-family:Arial,sans-serif}.photo{position:absolute;inset:0;background:url('${imageData}') center/cover}.shade{position:absolute;inset:0;background:linear-gradient(#10101be0,#10101b70 48%,#10101bd9)}.copy{position:absolute;top:155px;left:65px;width:950px}.brand{font-size:27px;font-weight:700;letter-spacing:2px}.line{width:240px;height:2px;background:#dfc18d;margin:35px auto}.headline{font-size:76px;font-weight:800;margin:35px 0 20px}.act{font-size:48px;font-weight:800;color:#dfc18d}.heading{font-size:23px;font-weight:700;margin-top:65px}.venue{font-family:Georgia,serif;font-size:67px;margin:22px 0}.location{font-size:25px;color:#dfc18d}.date{font-size:29px;font-weight:700;margin-top:32px}.footer{position:absolute;bottom:165px;width:100%;font-size:23px;font-weight:700;letter-spacing:1px}</style><div class=photo></div><div class=shade></div><div class=copy><div class=brand>THE SUPREME COLLECTIVE</div><div class=line></div><div class=headline>JUST BOOKED</div><div class=act>${escape(job.actName).toUpperCase()}</div><div class=heading>WE’RE HEADING TO</div><div class=venue>${escape(job.venueName)}</div><div class=location>${escape(job.venueLocation).toUpperCase()}</div><div class=date>${month}</div></div><div class=footer>THESUPREMECOLLECTIVE.CO.UK</div></html>`;
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
  let browser;
  try {
    const photo = await download(job.venuePhotoUrl, path.join(folder, 'photo'));
    await download(job.stickerUrl, path.join(folder, 'sticker.webm'));
    browser = await launchPdfBrowser(); const page = await browser.newPage();
    await page.setViewport({ width: 1080, height: 1920, deviceScaleFactor: 1 });
    await page.setContent(storyTemplate(job, `data:image/jpeg;base64,${photo.toString('base64')}`), { waitUntil: 'load' });
    await page.screenshot({ path: path.join(folder, 'background.png') }); await browser.close(); browser = null;
    const result = path.join(folder, 'story.mp4');
    await promisify(execFile)(ffmpeg, ['-y', '-loop', '1', '-i', path.join(folder, 'background.png'),
      '-stream_loop', '-1', '-c:v', 'libvpx-vp9', '-i', path.join(folder, 'sticker.webm'),
      '-filter_complex', '[1:v]scale=800:1000:force_original_aspect_ratio=decrease,format=rgba[s];[0:v][s]overlay=(W-w)/2:H-h-290:shortest=1,format=yuv420p[v]',
      '-map', '[v]', '-t', '10', '-r', '30', '-c:v', 'libx264', '-preset', 'fast', '-crf', '20', '-movflags', '+faststart', '-an', result], { timeout: 240000 });
    const upload = await cloudinary.uploader.upload(result, { resource_type: 'video', folder: 'tsc/booking-stories', public_id: `${job._id}-${Date.now()}` });
    return upload.secure_url;
  } finally { if (browser) await browser.close(); await rm(folder, { recursive: true, force: true }); }
}
