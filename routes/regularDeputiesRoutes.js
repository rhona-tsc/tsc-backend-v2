import express from "express";
import authUser from "../middleware/auth.js";
import {
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
router.patch("/acts/:actId/lineups/:lineupId/members/:memberId", updateRegularDeputyRole);
export default router;
