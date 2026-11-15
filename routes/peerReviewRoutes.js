import express from 'express';
import musicianAuth from '../middleware/musicianAuth.js';
import requireStaffAuth from '../middleware/requireStaffAuth.js';
import PeerReview from '../models/peerReviewModel.js';
import mongoose from 'mongoose';
import { categories, tasksFor, reviewBookings, validateReview, deliverReviewEmail, reviewEmail } from '../services/peerReviewService.js';
const router = express.Router();
router.post('/rollout', requireStaffAuth, async (req, res) => {
  try {
    const musicians = await mongoose.connection.collection('musicians').find({ role: 'musician', status: { $ne: 'rejected' }, email: { $type: 'string', $ne: '' } }).project({ email: 1, firstName: 1, lastName: 1 }).toArray();
    const eligible = [...new Map(musicians.filter(m => !/\btest\b|testing|example\.(com|org|net)|@example\.|@test\.|test@|^test[+.\d_-]/i.test(`${m.firstName} ${m.lastName} ${m.email}`)).map(m => [m.email.trim().toLowerCase(), m])).values()];
    const ledger = mongoose.connection.collection('peerreviewdeliveries');
    const done = new Set((await ledger.find({ _id: /^rollout:v1:/ }).project({ _id: 1 }).toArray()).map(r => r._id));
    const remaining = eligible.filter(m => !done.has(`rollout:v1:${m.email.trim().toLowerCase()}`));
    if (!req.body.send) return res.json({ eligible: eligible.length, remaining: remaining.length });
    const results = [];
    for (const m of remaining.slice(0, 10)) {
      const email = m.email.trim().toLowerCase();
      results.push({ email, sent: await deliverReviewEmail(`rollout:v1:${email}`, email, reviewEmail({ name: m.firstName, announcement: true })) });
    }
    res.json({ success: true, results, remaining: Math.max(0, remaining.length - results.length) });
  } catch { res.status(500).json({ message: 'Could not process rollout emails. Check the delivery ledger before retrying.' }); }
});
router.get('/tasks', musicianAuth, async (req, res) => {
  try { res.json({ success: true, categories, tasks: await tasksFor(req.userId) }); } catch { res.status(500).json({ message: 'Could not load feedback tasks.' }); }
});
router.post('/', musicianAuth, async (req, res) => {
  try {
    const b = (await reviewBookings()).find(b => b.key === req.body.bookingKey);
    const author = b?.roster.find(m => m.id === String(req.userId));
    const peer = b?.roster.find(m => m.id === String(req.body.recipientId));
    if (!author || !peer || author.id === peer.id) return res.status(403).json({ message: 'You can review only bandmates from a completed gig you both performed at.' });
    const values = validateReview(req.body);
    await PeerReview.create({ bookingKey: b.key, bookingRef: b.ref, eventDate: b.date, actName: b.act, reviewerId: author.id, reviewerName: author.name, reviewerEmail: author.email, recipientId: peer.id, recipientName: peer.name, ...values });
    res.json({ success: true });
  } catch (e) { res.status(e.code === 11000 ? 409 : 400).json({ message: e.code === 11000 ? 'You have already submitted feedback for this bandmate and gig.' : e.message }); }
});
router.get('/moderation', requireStaffAuth, async (req, res) => {
  try { res.json({ success: true, reviews: await PeerReview.find().sort({ createdAt: -1 }).limit(300).lean() }); } catch { res.status(500).json({ message: 'Could not load reviews.' }); }
});
router.patch('/moderation/:id', requireStaffAuth, async (req, res) => {
  try {
    if (!['reviewed', 'flagged', 'dismissed'].includes(req.body.status)) return res.status(400).json({ message: 'Choose a moderation action.' });
    const review = await PeerReview.findByIdAndUpdate(req.params.id, { $set: { status: req.body.status, moderationNote: String(req.body.note || '').slice(0, 2000), moderatedAt: new Date(), moderatedBy: req.user.email } }, { new: true });
    if (!review) return res.status(404).json({ message: 'Review not found.' });
    res.json({ success: true });
  } catch { res.status(400).json({ message: 'Could not update review.' }); }
});
export default router;
