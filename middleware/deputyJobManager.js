import { canManageDeputyJob } from '../utils/deputyJobVisibility.js';

export const deputyJobManagerGuard = loadJob => async (req, res, next) => {
  if (!/^[a-f\d]{24}$/i.test(req.params.id || '')) {
    return res.status(400).json({ success: false, message: 'Invalid deputy job ID' });
  }
  try {
    const job = await loadJob(req.params.id);
    if (!job) return res.status(404).json({ success: false, message: 'Deputy job not found' });
    if (!canManageDeputyJob(job, req.user)) {
      return res.status(403).json({ success: false, message: 'You do not have permission to manage this deputy job' });
    }
    return next();
  } catch {
    return res.status(500).json({ success: false, message: 'Unable to check deputy job access' });
  }
};
