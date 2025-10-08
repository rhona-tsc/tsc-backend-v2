import express from 'express';
import upload from '../middleware/multer.js';
import {
  addAct,
  listActs,
  removeAct,
  singleAct,
  updateActStatus // ✅ Don't forget to import this
} from '../controllers/actController.js';
import musicianAuth from '../middleware/adminAuth.js';
import agentAuth from '../middleware/agentAuth.js';

const actRouter = express.Router();

// POST: Add act
actRouter.post('/add', musicianAuth, upload, addAct);

// ✅ Add status update route
actRouter.post('/status', agentAuth, updateActStatus);

// GET: List all acts
console.log("🔍 /api/act/list route hit");
actRouter.get('/list', listActs);

// Optional: Other routes
actRouter.post('/remove', removeAct);
actRouter.post('/single', singleAct);

export default actRouter;