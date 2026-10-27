import express from "express";
import verifyToken from "../middleware/agentAuth.js";
import {
  AutomationConfig,
  AutomationConfigRevision,
} from "../models/automationConfigModel.js";

const router = express.Router();
const CONFIG_KEY = "client-email-rules";
const MAX_RULES = 100;
const MAX_SERIALIZED_BYTES = 2_000_000;

const validRules = (rules) =>
  Array.isArray(rules) &&
  rules.length > 0 &&
  rules.length <= MAX_RULES &&
  rules.every(
    (rule) =>
      rule &&
      typeof rule === "object" &&
      !Array.isArray(rule) &&
      String(rule.id || "").trim(),
  ) &&
  Buffer.byteLength(JSON.stringify(rules), "utf8") <= MAX_SERIALIZED_BYTES;

router.get("/rules", verifyToken, async (_req, res) => {
  const config = await AutomationConfig.findOne({ key: CONFIG_KEY }).lean();
  return res.json({
    success: true,
    exists: Boolean(config),
    rules: config?.rules || [],
    version: config?.version || 0,
    updatedAt: config?.updatedAt || null,
    updatedBy: config?.updatedBy || "",
    updateSource: config?.updateSource || "",
  });
});

router.put("/rules", verifyToken, async (req, res) => {
  const rules = req.body?.rules;
  const expectedVersion = Number(req.body?.expectedVersion ?? 0);
  const source = String(req.body?.source || "dashboard_save").slice(0, 80);
  if (!validRules(rules)) {
    return res.status(400).json({
      success: false,
      message: "A valid automation rule collection is required.",
    });
  }
  if (!Number.isInteger(expectedVersion) || expectedVersion < 0) {
    return res.status(400).json({
      success: false,
      message: "A valid expectedVersion is required.",
    });
  }

  const actor = String(req.user?.email || "").toLowerCase();
  const filter = { key: CONFIG_KEY, version: expectedVersion };
  let config = await AutomationConfig.findOneAndUpdate(
    filter,
    {
      $set: {
        rules,
        updatedBy: actor,
        updateSource: source,
      },
      $inc: { version: 1 },
      $setOnInsert: { key: CONFIG_KEY },
    },
    {
      new: true,
      upsert: expectedVersion === 0,
      runValidators: true,
    },
  ).lean().catch((error) => {
    if (error?.code === 11000) return null;
    throw error;
  });

  if (!config) {
    const current = await AutomationConfig.findOne({ key: CONFIG_KEY })
      .select("version updatedAt updatedBy")
      .lean();
    return res.status(409).json({
      success: false,
      message: "These rules changed in another browser. Reload before saving.",
      currentVersion: current?.version || 0,
      updatedAt: current?.updatedAt || null,
      updatedBy: current?.updatedBy || "",
    });
  }

  await AutomationConfigRevision.create({
    configKey: CONFIG_KEY,
    version: config.version,
    rules,
    actor,
    source,
    userAgent: String(req.get("user-agent") || "").slice(0, 500),
  });

  return res.json({
    success: true,
    rules: config.rules,
    version: config.version,
    updatedAt: config.updatedAt,
    updatedBy: config.updatedBy,
    updateSource: config.updateSource,
  });
});

router.get("/rules/history", verifyToken, async (req, res) => {
  const limit = Math.min(Math.max(Number(req.query?.limit) || 20, 1), 100);
  const revisions = await AutomationConfigRevision.find({
    configKey: CONFIG_KEY,
  })
    .sort({ version: -1 })
    .limit(limit)
    .select("version actor source createdAt")
    .lean();
  return res.json({ success: true, revisions });
});

export default router;

