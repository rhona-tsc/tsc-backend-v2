import express from "express";
import authUser from "../middleware/auth.js";
import {
  copyFirstLineupDeputies,
  copyDeputiesFromAct,
  listRegularDeputies,
  getActMemberDetailsRequest,
  searchRegularDeputyMusicians,
  submitActMemberDetailsRequest,
  updateRegularDeputyRole,
} from "../controllers/regularDeputiesController.js";

const router = express.Router();
router.get("/details/:token", getActMemberDetailsRequest);
router.post("/details/:token", submitActMemberDetailsRequest);
router.use(authUser);
router.get("/", listRegularDeputies);
router.get("/musicians/search", searchRegularDeputyMusicians);
router.post("/acts/:actId/copy-first-lineup", copyFirstLineupDeputies);
router.post("/acts/:actId/copy-from-act", copyDeputiesFromAct);
router.patch("/acts/:actId/lineups/:lineupId/members/:memberId", updateRegularDeputyRole);
export default router;
