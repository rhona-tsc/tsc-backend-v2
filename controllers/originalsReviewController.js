import Submission from '../models/originalSubmissionModel.js';
import { requireOriginalProjectManager } from '../services/originalsAccessService.js';
import { originalReviewStatus } from '../services/originalsReviewService.js';

export async function getOriginalReviewStatus(req, res) {
  try {
    const project = await requireOriginalProjectManager(req, res, req.params.id);
    if (!project) return;
    const submissions = await Submission.find({ projectId: project._id, state: 'submitted' }).select('_id revision state').lean();
    res.set('Cache-Control', 'no-store');
    return res.json({ success: true, ...originalReviewStatus(submissions) });
  } catch { return res.status(500).json({ success: false, message: 'Could not refresh submissions awaiting review' }); }
}
