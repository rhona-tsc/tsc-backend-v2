import mongoose from 'mongoose';
import { randomUUID } from 'node:crypto';
import Project from '../models/originalProjectModel.js';
import Musician from '../models/musicianModel.js';
import Email from '../models/originalProjectEmailModel.js';
import Event from '../models/originalEventModel.js';
import { canManageOriginalProject, getOriginalsUserId } from '../services/originalsPolicyService.js';
import { loadOriginalMembership, originalChatRecipients } from '../services/originalsMembershipService.js';
import { buildOriginalsEmail } from '../utils/originalsEmailTemplate.js';

export function buildOriginalProjectRenamedEmail({ project, oldTitle, oldDescription, firstName = 'there' }) {
  return buildOriginalsEmail({
    subject: oldTitle !== project.title ? `Originals project updated: ${oldTitle} → ${project.title}` : `Originals project updated: ${project.title}`,
    heading: 'Your project details have been updated', firstName,
    paragraphs: [
      ...(oldTitle !== project.title ? [`“${oldTitle}” has been renamed to “${project.title}”.`] : []),
      ...(oldDescription !== project.description ? [`Previous description:\n${oldDescription}`, `Updated description:\n${project.description}`] : []),
      'Your advance places, recordings and participation are unchanged.',
    ],
    buttonLabel: 'Open the project',
    buttonUrl: `${String(process.env.ADMIN_FRONTEND_URL || 'https://admin.thesupremecollective.co.uk').replace(/\/+$/, '')}/originals/${project._id}`,
  });
}

export async function renameOriginalProject(req, res) {
  const title = typeof req.body?.title === 'string' ? req.body.title.trim() : '';
  const description = typeof req.body?.description === 'string' ? req.body.description.trim() : '';
  const expectedTitle = req.body?.expectedTitle;
  const expectedDescription = req.body?.expectedDescription;
  if (!mongoose.Types.ObjectId.isValid(req.params.id) || !title || title.length > 160 || /[\r\n\x00-\x1f]/.test(title) || !description || description.length > 5000 || typeof expectedTitle !== 'string' || typeof expectedDescription !== 'string') return res.status(400).json({ success: false, message: 'Enter a project name of 1–160 characters and a description of 1–5,000 characters.' });
  const session = await mongoose.startSession();
  let result;
  try {
    await session.withTransaction(async () => {
      const project = await Project.findById(req.params.id).session(session).lean();
      if (!project) throw Object.assign(new Error('Project not found'), { status: 404 });
      if (!canManageOriginalProject(project, req.user)) throw Object.assign(new Error('Only the owner or an administrator can edit project details'), { status: 403 });
      if (project.title === title && project.description === description) { result = { title, description, queued: 0 }; return; }
      if (project.title !== expectedTitle || project.description !== expectedDescription) throw Object.assign(new Error('The project details have changed. Refresh before editing them.'), { status: 409 });
      const oldTitle = project.title;
      const oldDescription = project.description;
      const now = new Date();
      const pending = await Email.findOne({ projectId: project._id, kind: 'project_update', state: 'queued', attempts: 0 }).sort({ createdAt: -1 }).session(session).lean();
      const started = pending && await Email.exists({ projectId: project._id, updateBatchId: pending.updateBatchId, state: { $ne: 'queued' } }).session(session);
      const batch = pending && !started ? pending.updateBatchId : randomUUID();
      const before = pending && !started ? pending.updateBefore : { title: oldTitle, description: oldDescription };
      const sendAfter = new Date(now.getTime() + 15 * 60 * 1000);
      const membership = await loadOriginalMembership(project, session);
      const recipients = originalChatRecipients(membership, '');
      const people = await Musician.find({ _id: { $in: recipients }, profileDeletedAt: null }).select('_id email firstName').session(session).lean();
      const updated = await Project.updateOne({ _id: project._id, title: oldTitle, description: oldDescription }, { $set: { title, description } }, { session });
      if (updated.matchedCount !== 1) throw Object.assign(new Error('The project has changed. Refresh and try again.'), { status: 409 });
      const emails = new Set();
      let queued = 0;
      const reverted = before.title === title && before.description === description;
      if (pending && !started) await Email.updateMany({ projectId: project._id, updateBatchId: batch, state: 'queued' }, { $set: { state: 'cancelled' } }, { session });
      for (const person of people) {
        if (reverted) break;
        const to = String(person.email || '').trim().toLowerCase();
        if (!to || emails.has(to)) continue;
        emails.add(to);
        await Email.updateOne({ eventKey: `project-update:${project._id}:${batch}:${to}` }, { $set: {
          projectId: project._id, musicianId: person._id, kind: 'project_update',
          updateBatchId: batch, updateBefore: before, to, state: 'queued', sendAfter,
          ...buildOriginalProjectRenamedEmail({ project: { ...project, title, description }, oldTitle: before.title, oldDescription: before.description, firstName: person.firstName || 'there' }),
        } }, { session, upsert: true });
        queued++;
      }
      await Event.create([{ projectId: project._id, actorId: getOriginalsUserId(req.user), type: 'project_details_updated', metadata: { oldTitle, title, oldDescription, description, queued, sendAfter } }], { session });
      result = { title, description, queued, notifyAfter: reverted ? null : sendAfter };
    });
    return res.json({ success: true, ...result });
  } catch (error) {
    return res.status(error.status || 500).json({ success: false, message: error.status ? error.message : 'Could not update the project details. Please try again.' });
  } finally { await session.endSession(); }
}
