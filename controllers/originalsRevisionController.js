import mongoose from 'mongoose';
import { manageOriginalRevision } from '../services/originalsRevisionService.js';
export async function changeOriginalRevision(req, res) {
  if (!mongoose.Types.ObjectId.isValid(req.params.submissionId)) return res.status(400).json({ success: false, message: 'Invalid submission' });
  try {
    const submission = await manageOriginalRevision({ submissionId: req.params.submissionId, action: req.body?.action, note: req.body?.note, requestId: req.body?.requestId, user: req.user });
    return res.json({ success: true, submission });
  } catch (error) { return res.status(error.status || 500).json({ success: false, message: error.status ? error.message : 'Could not update the revision session. Please try again.' }); }
}
