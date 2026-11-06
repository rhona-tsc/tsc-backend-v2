import express from 'express';
import { optionalAuthUser } from '../middleware/auth.js';
import { getMusicianEmailPreferences, saveMusicianEmailPreferences } from '../controllers/musicianEmailPreferencesController.js';
const router = express.Router();
router.use(optionalAuthUser);
router.get('/', getMusicianEmailPreferences);
router.post('/', express.json({ limit: '8kb' }), saveMusicianEmailPreferences);
export default router;
