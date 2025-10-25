import express from 'express';
import upload from '../middleware/multer.js';
import {
  addAct,
  createActV2,
  getActByIdV2,
  getAllActsV2,
  removeAct,
  singleAct,
  updateActStatus, 
  updateActV2
} from '../controllers/actV2Controller.js';
import musicianAuth from '../middleware/adminAuth.js';
import agentAuth from '../middleware/agentAuth.js';


const actRouter = express.Router();

// POST: Add act
actRouter.post('/add', musicianAuth, upload, addAct);

// ✅ Add status update route
actRouter.post('/status', agentAuth, updateActStatus);

// GET: List all acts
console.log("🔍 /api/act/list route hit");
actRouter.get('/list', getAllActsV2);

// Optional: Other routes
actRouter.post('/remove', removeAct);
actRouter.post('/single', singleAct);

// --- V2 Routes ---
actRouter.get('/v2/acts', getAllActsV2);
actRouter.get('/v2/acts/:id', getActByIdV2);
actRouter.post('/v2/acts', createActV2);
actRouter.put('/v2/acts/:id', updateActV2);

export default actRouter;