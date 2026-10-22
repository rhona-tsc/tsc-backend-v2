import express from 'express';
import { getLocationPages } from '../services/locationPageService.js';
import { getPublicPerformanceHistory } from '../services/publicPerformanceHistory.js';
const router = express.Router();
router.get('/acts/:slug', async (req, res) => {
  try {
    const { histories } = await getPublicPerformanceHistory();
    const history = Object.hasOwn(histories, req.params.slug) ? histories[req.params.slug] : null;
    if (!history) return res.status(404).json({ success: false, message: 'Band history not found' });
    res.set('Cache-Control', 'public, max-age=60');
    res.json({ success: true, history });
  } catch (error) {
    console.error('Public band history unavailable:', error.message);
    res.status(503).json({ success: false, message: 'Band history is temporarily unavailable' });
  }
});
router.get('/public', async (_req, res) => {
  try {
    res.set('Cache-Control', 'public, max-age=60');
    res.json({ success: true, locations: await getLocationPages() });
  } catch (error) {
    console.error('Location pages unavailable:', error.message);
    res.status(503).json({ success: false, message: 'Location information is temporarily unavailable' });
  }
});
export default router;
