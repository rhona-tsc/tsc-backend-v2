import { createHash, randomUUID } from 'node:crypto';
import PDFDocument from 'pdfkit';
import Acceptance from '../models/originalAgreementAcceptanceModel.js';
import Project from '../models/originalProjectModel.js';
import Musician from '../models/musicianModel.js';
import Notification from '../models/originalNotificationModel.js';
import sendEmail from '../utils/sendEmail.js';
import { isOriginalsEnabled } from './originalsPolicyService.js';
import { buildOriginalsEmail } from '../utils/originalsEmailTemplate.js';

const template = 'originals_signed_agreement_copy';
const titles = { contributor: 'Contributor agreement', mix: 'Mix producer agreement', master: 'Mastering engineer agreement', owner: 'Project owner agreement' };
const signingTime = value => new Date(value).toLocaleString('en-GB', { timeZone: 'Europe/London', dateStyle: 'long', timeStyle: 'long' });

export async function buildOriginalAgreementPdf(record) {
  if (!record.accepted || !record.fullName || !record.text || !record.version || !titles[record.type]
    || !Number.isFinite(new Date(record.acceptedAt).getTime())
    || createHash('sha256').update(record.text).digest('hex') !== record.textHash) throw new Error('The recorded signed agreement is incomplete or its text does not match');
  const doc = new PDFDocument({ size: 'A4', margin: 50, bufferPages: true, info: { Title: `${titles[record.type]} - ${record.projectTitle}`, Author: 'The Supreme Collective Ltd' } });
  const chunks = [];
  const result = new Promise((resolve, reject) => { doc.on('data', chunk => chunks.push(chunk)); doc.on('end', () => resolve(Buffer.concat(chunks))); doc.on('error', reject); });
  doc.font('Helvetica-Bold').fontSize(11).fillColor('#d74750').text('TSC ORIGINALS');
  doc.moveDown(0.7).fontSize(24).fillColor('#111827').text(titles[record.type]);
  doc.moveDown(0.4).font('Helvetica').fontSize(10).fillColor('#475569').text('Your electronically accepted agreement');
  doc.moveDown(1);
  const details = [
    ['Project', record.projectTitle], ['Role', record.roleName], ['Signed by', record.fullName],
    ['Accepted at (UK time)', signingTime(record.acceptedAt)], ['Accepted at (UTC)', new Date(record.acceptedAt).toISOString()],
    ['Agreement version', record.version], ['Account reference', String(record.musicianId)],
  ];
  for (const [label, value] of details) {
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#111827').text(`${label}: `, { continued: true });
    doc.font('Helvetica').text(String(value || ''), { lineGap: 3 });
    doc.moveDown(0.35);
  }
  const verification = `Project reference: ${record.projectId}\nAcceptance reference: ${record.reference}\nAccepted-text SHA-256: ${record.textHash}`;
  doc.moveDown(0.5).font('Helvetica').fontSize(8).fillColor('#64748b').text(verification, { lineGap: 3 });
  doc.moveDown(0.7).fontSize(9).fillColor('#475569').text('The wording below is the version recorded when you signed. Your typed name and acceptance time above identify your electronic acknowledgement.');
  doc.moveDown(1).font('Helvetica-Bold').fontSize(14).fillColor('#111827').text('Accepted terms');
  doc.moveDown(0.6);
  // Use the retained text, never today's terms. Keep every paragraph and the
  // accepted acknowledgement intact, with headings kept beside their first line.
  for (const paragraph of record.text.split('\n\n')) {
    const heading = paragraph.length < 100 && !paragraph.includes('\n') && !/[.!?]$/.test(paragraph);
    if (heading && doc.y > doc.page.height - 110) doc.addPage();
    doc.font(heading ? 'Helvetica-Bold' : 'Helvetica').fontSize(heading ? 11 : 10).fillColor('#111827').text(paragraph, { lineGap: 3 });
    doc.moveDown(heading ? 0.45 : 0.8);
  }
  const pages = doc.bufferedPageRange();
  for (let page = 0; page < pages.count; page++) {
    doc.switchToPage(page);
    const bottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.font('Helvetica').fontSize(8).fillColor('#64748b').text(`The Supreme Collective Ltd | Company no. 16883956`, 50, doc.page.height - 32, { lineBreak: false });
    doc.text(`${page + 1} / ${pages.count}`, doc.page.width - 95, doc.page.height - 32, { lineBreak: false });
    doc.page.margins.bottom = bottom;
  }
  doc.end();
  return result;
}

export function buildOriginalAgreementReceiptEmail(record, firstName = 'there') {
  const url = `${String(process.env.ADMIN_FRONTEND_URL || 'https://admin.thesupremecollective.co.uk').replace(/\/$/, '')}/originals/${encodeURIComponent(String(record.projectId))}`;
  const description = `Attached is your PDF copy of the ${titles[record.type].toLowerCase()} you electronically accepted for ${record.roleName} on “${record.projectTitle}”.`;
  const detail = `Signed as ${record.fullName} on ${signingTime(record.acceptedAt)} (UK time). The PDF contains the wording and agreement version recorded at signing. Please keep it for your records.`;
  return buildOriginalsEmail({
    subject: `Your signed agreement: ${record.roleName} — ${record.projectTitle}`, heading: 'Your signed agreement', firstName,
    paragraphs: [description, detail], buttonUrl: url,
  });
}

async function queueReceipt({ project, acceptance, musicianId, roleName, type, reference, eventKey, now }) {
  const record = {
    projectId: String(project._id), projectTitle: acceptance.projectTitle || project.title,
    musicianId: String(musicianId), roleName, type, reference,
    fullName: acceptance.fullName || acceptance.displayName, accepted: acceptance.accepted,
    acceptedAt: acceptance.acceptedAt, version: acceptance.version, text: acceptance.text, textHash: acceptance.textHash,
  };
  try {
    await Notification.updateOne({ recipientMusicianId: musicianId, eventKey }, { $setOnInsert: {
      projectId: project._id, recipientMusicianId: musicianId, eventKey, template, payload: { record },
      channels: ['email'], state: 'queued', sendAfter: now,
    } }, { upsert: true });
  } catch (error) { if (error.code !== 11000) throw error; }
}

export async function deliverOriginalAgreementReceipts({ emailSender = sendEmail, pdfBuilder = buildOriginalAgreementPdf, now = new Date(), limit = 25 } = {}) {
  if (!isOriginalsEnabled()) return;
  // Markers are saved with the acceptance. Only new signatures are emailed;
  // retries do not alter the retained terms or backfill historical agreements.
  const acceptances = await Acceptance.find({ receiptPending: true, accepted: true }).limit(limit).lean();
  for (const acceptance of acceptances) {
    try {
      const project = await Project.findById(acceptance.projectId).lean();
      if (!project) continue;
      await queueReceipt({ project, acceptance, musicianId: acceptance.musicianId, roleName: acceptance.roleName, type: acceptance.type, reference: String(acceptance._id), eventKey: `agreement-copy:${acceptance._id}`, now });
      await Acceptance.updateOne({ _id: acceptance._id, receiptPending: true }, { $set: { receiptPending: false } });
    } catch (error) { console.error('Originals agreement receipt queue will retry:', acceptance._id, error.message); }
  }
  const projects = await Project.find({ $or: [{ 'ownerAgreement.receiptPending': true }, { 'ownerAgreementHistory.receiptPending': true }] }).limit(limit).lean();
  for (const project of projects) {
    const entries = [{ acceptance: project.ownerAgreement, path: 'ownerAgreement' }, ...(project.ownerAgreementHistory || []).map((acceptance, index) => ({ acceptance, path: `ownerAgreementHistory.${index}` }))];
    for (const { acceptance, path } of entries) {
      if (!acceptance?.accepted || acceptance.receiptPending !== true) continue;
      try {
        const reference = `owner:${project._id}:${new Date(acceptance.acceptedAt).toISOString()}:${acceptance.textHash}`;
        await queueReceipt({ project, acceptance, musicianId: project.ownerId, roleName: 'Project owner', type: 'owner', reference, eventKey: `agreement-copy:${reference}`, now });
        await Project.updateOne({ _id: project._id, [`${path}.acceptedAt`]: acceptance.acceptedAt, [`${path}.textHash`]: acceptance.textHash }, { $set: { [`${path}.receiptPending`]: false } });
      } catch (error) { console.error('Originals owner agreement receipt queue will retry:', project._id, error.message); }
    }
  }
  for (let index = 0; index < limit; index++) {
    const leaseToken = randomUUID();
    const job = await Notification.findOneAndUpdate({ template, $or: [{ state: 'queued', sendAfter: { $lte: now } }, { state: 'sending', leaseExpiresAt: { $lte: now } }] }, { $set: { state: 'sending', leaseToken, leaseExpiresAt: new Date(+now + 300000) }, $inc: { attempts: 1 } }, { new: true }).lean();
    if (!job) break;
    const filter = { _id: job._id, state: 'sending', leaseToken };
    try {
      const record = job.payload?.record;
      if (!record || String(record.musicianId) !== String(job.recipientMusicianId) || String(record.projectId) !== String(job.projectId)) throw new Error('Agreement receipt recipient does not match its signing record');
      const recipient = await Musician.findById(job.recipientMusicianId).select('email firstName').lean();
      if (!recipient) { await Notification.updateOne(filter, { $set: { state: 'cancelled', leaseExpiresAt: null } }); continue; }
      if (!recipient.email) throw new Error('Signing musician has no email address');
      const content = await pdfBuilder(record);
      const filename = `TSC-Originals-${record.type}-agreement-${new Date(record.acceptedAt).toISOString().slice(0, 10)}.pdf`;
      const result = await emailSender({ musicianPreferences: true, to: recipient.email, ...buildOriginalAgreementReceiptEmail(record, recipient.firstName || 'there'), attachments: [{ filename, content, contentType: 'application/pdf' }] });
      if (!result?.ok) throw new Error(result?.error || 'Email was not accepted');
      await Notification.updateOne(filter, { $set: { state: 'sent', leaseExpiresAt: null, lastError: '' } });
    } catch (error) {
      await Notification.updateOne(filter, { $set: { state: job.attempts >= 5 ? 'failed' : 'queued', leaseExpiresAt: null, sendAfter: new Date(+now + 300000), lastError: String(error.message).slice(0, 500) } });
    }
  }
}
