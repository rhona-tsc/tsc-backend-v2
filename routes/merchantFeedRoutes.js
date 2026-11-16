import express from 'express';
import Act from '../models/actModel.js';
import { publicActStatuses } from '../utils/publicActStatuses.js';
import { buildMerchantFeed } from '../services/merchantFeed.js';

const router = express.Router();
router.get('/acts.tsv', async (_req, res) => {
  res.set('Cache-Control', 'no-store, max-age=0');
  try {
    const acts = await Act.find({ status: { $in: publicActStatuses }, isTest: { $ne: true } })
      .select('_id tscName tscDescription slug status isTest minDisplayPrice coverImage.url images.url')
      .sort({ slug: 1 }).lean();
    const feed = buildMerchantFeed(acts);
    res.set('Content-Type', 'text/tab-separated-values; charset=utf-8');
    res.set('Content-Disposition', 'inline; filename="acts_merchant_feed.tsv"');
    res.send(feed);
  } catch (error) {
    console.error('Merchant feed unavailable:', error.message);
    res.status(503).type('text/plain').send('Product feed is temporarily unavailable. Please retry later.');
  }
});
export default router;
