// routes/agentDashboardRoutes.js
import express from "express";
import requireAdminDashboard from "../middleware/requireAdminDashboard.js";
import { getAllShortlistsAdmin, getAllUsersAdmin } from "../controllers/agentDashboardController.js";

const router = express.Router();

// Useful alias if you later want to call it from the dashboard:
// GET /api/agent-dashboard/shortlists
router.get("/shortlists", requireAdminDashboard, getAllShortlistsAdmin);
router.get("/users", requireAdminDashboard, getAllUsersAdmin); // ✅ ADD THIS

export default router;