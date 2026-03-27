import express from "express";
import {
  createDeputyOpportunity,
  getDeputyOpportunities,
  getDeputyOpportunityById,
  applyToDeputyOpportunity,
  getDeputyOpportunityApplicants,
  assignDeputyOpportunity,
  closeDeputyOpportunity,
} from "../controllers/deputyOpportunityController.js";
import authUser from "../middleware/auth.js";

const deputyOpportunityRoutes = express.Router();

// public / member-visible list
deputyOpportunityRoutes.get("/", getDeputyOpportunities);
deputyOpportunityRoutes.get("/:id", getDeputyOpportunityById);

// authenticated actions
deputyOpportunityRoutes.post("/", authUser, createDeputyOpportunity);
deputyOpportunityRoutes.post("/:id/apply", authUser, applyToDeputyOpportunity);

// creator/admin actions
deputyOpportunityRoutes.get("/:id/applicants", authUser, getDeputyOpportunityApplicants);
deputyOpportunityRoutes.post("/:id/assign", authUser, assignDeputyOpportunity);
deputyOpportunityRoutes.post("/:id/close", authUser, closeDeputyOpportunity);

export default deputyOpportunityRoutes;