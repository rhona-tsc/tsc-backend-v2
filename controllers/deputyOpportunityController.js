import DeputyOpportunity from "../models/DeputyOpportunity.js";
import DeputyOpportunityApplication from "../models/DeputyOpportunityApplication.js";
import musicianModel from "../models/musicianModel.js";

const ADMIN_EMAIL = "hello@thesupremecollective.co.uk";

function getCommissionSettingsForJob(user) {
  const email = String(user?.email || "").toLowerCase().trim();
  const isAdminCreated = email === ADMIN_EMAIL;

  if (isAdminCreated) {
    return {
      commissionApplies: false,
      commissionPercent: 0,
    };
  }

  return {
    commissionApplies: true,
    commissionPercent: 10,
  };
}

function getApplicationReadiness(musician) {
  const missing = [];

  if (!musician?.basicInfo?.firstName) missing.push("first name");
  if (!musician?.basicInfo?.email && !musician?.email) missing.push("email");
  if (!musician?.basicInfo?.phone) missing.push("phone");
  if (!musician?.address?.postcode) missing.push("postcode");

  const instruments = Array.isArray(musician?.instrumentation)
    ? musician.instrumentation
    : [];

  if (!instruments.length) missing.push("instrumentation");

  return {
    canApply: missing.length === 0,
    missing,
  };
}

function isAdminUser(user) {
  return String(user?.email || "").toLowerCase().trim() === ADMIN_EMAIL;
}

function isCreator(job, user) {
  if (!job || !user) return false;

  const userId = String(user._id || user.id || "");
  const createdBy = String(job.createdBy || "");
  const createdByEmail = String(job.createdByEmail || "").toLowerCase().trim();
  const userEmail = String(user.email || "").toLowerCase().trim();

  return createdBy === userId || (createdByEmail && createdByEmail === userEmail);
}

function normaliseSkillArray(value) {
  if (Array.isArray(value)) {
    return value.map((v) => String(v).trim()).filter(Boolean);
  }
  if (typeof value === "string" && value.trim()) {
    return value
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean);
  }
  return [];
}

function matchesJobSkills(job, musician) {
  const requiredSkills = [
    ...normaliseSkillArray(job?.requiredInstruments),
    ...normaliseSkillArray(job?.requiredSkills),
    ...normaliseSkillArray(job?.tags),
  ].map((s) => s.toLowerCase());

  if (!requiredSkills.length) return true;

  const musicianSkills = [
    ...(Array.isArray(musician?.instrumentation) ? musician.instrumentation : []),
    ...(Array.isArray(musician?.otherSkills) ? musician.otherSkills : []),
    ...(Array.isArray(musician?.vocals) ? musician.vocals : []),
  ]
    .map((s) => String(s).toLowerCase().trim())
    .filter(Boolean);

  return requiredSkills.some((skill) =>
    musicianSkills.some((mSkill) => mSkill.includes(skill) || skill.includes(mSkill))
  );
}

async function sendEmailSafe({ to, subject, html, text }) {
  try {
    // plug your real email helper in here
    console.log("📧 sendEmailSafe", { to, subject });
    return true;
  } catch (error) {
    console.warn("⚠️ sendEmailSafe failed:", error.message);
    return false;
  }
}

async function sendAssignmentNotifications({ job, assignedMusician, application }) {
  const assignedEmail =
    assignedMusician?.basicInfo?.email || assignedMusician?.email || application?.email || "";

  const assignedName =
    assignedMusician?.basicInfo?.firstName ||
    assignedMusician?.firstName ||
    application?.name ||
    "there";

  if (assignedEmail) {
    await sendEmailSafe({
      to: assignedEmail,
      subject: `You've been booked for ${job.title || "a deputy opportunity"}`,
      html: `
        <p>Hi ${assignedName},</p>
        <p>Great news — you've been allocated to:</p>
        <p><strong>${job.title || "Deputy opportunity"}</strong></p>
        <p>Date: ${job.date || "TBC"}</p>
        <p>Venue: ${job.venue || job.location || "TBC"}</p>
        <p>Fee: £${Number(job.fee || 0).toFixed(2)}</p>
        <p>We'll follow up with any further details shortly.</p>
      `,
    });
  }

  if (job?.createdByEmail) {
    const commissionText = job.commissionApplies
      ? `A ${job.commissionPercent}% commission applies (£${Number(job.commissionAmount || 0).toFixed(2)}).`
      : `No commission applies on this job.`;

    await sendEmailSafe({
      to: job.createdByEmail,
      subject: `Deputy allocated: ${job.title || "Deputy opportunity"}`,
      html: `
        <p>Your deputy opportunity has now been allocated.</p>
        <p><strong>${job.title || "Deputy opportunity"}</strong></p>
        <p>Allocated to: ${assignedName}</p>
        <p>${commissionText}</p>
      `,
    });
  }
}

export const createDeputyOpportunity = async (req, res) => {
  try {
    const user = req.user;
    const {
      title,
      date,
      callTime,
      finishTime,
      venue,
      location,
      fee,
      notes,
      requiredInstruments,
      requiredSkills,
      tags,
    } = req.body;

    if (!title) {
      return res.status(400).json({
        success: false,
        message: "Title is required",
      });
    }

    const { commissionApplies, commissionPercent } = getCommissionSettingsForJob(user);
    const commissionAmount = commissionApplies
      ? Math.round((Number(fee || 0) * commissionPercent) / 100)
      : 0;

    const job = await DeputyOpportunity.create({
      title,
      date,
      callTime,
      finishTime,
      venue,
      location,
      fee: Number(fee || 0),
      notes: notes || "",
      requiredInstruments: normaliseSkillArray(requiredInstruments),
      requiredSkills: normaliseSkillArray(requiredSkills),
      tags: normaliseSkillArray(tags),
      createdBy: user?._id,
      createdByEmail: user?.email || "",
      createdByName: user?.name || user?.basicInfo?.firstName || "Member",
      commissionApplies,
      commissionPercent,
      commissionAmount,
      status: "open",
    });

    const candidateMusicians = await musicianModel.find({
      status: { $in: ["approved", "Approved", "live", "active"] },
    });

    const matchedMusicians = candidateMusicians.filter((musician) =>
      matchesJobSkills(job, musician)
    );

    for (const musician of matchedMusicians) {
      const email = musician?.basicInfo?.email || musician?.email;
      if (!email) continue;

      await sendEmailSafe({
        to: email,
        subject: `New deputy opportunity: ${job.title}`,
        html: `
          <p>A new deputy opportunity may suit your profile:</p>
          <p><strong>${job.title}</strong></p>
          <p>Date: ${job.date || "TBC"}</p>
          <p>Location: ${job.location || job.venue || "TBC"}</p>
          <p>Fee: £${Number(job.fee || 0).toFixed(2)}</p>
          <p>Log in to apply in one click.</p>
        `,
      });
    }

    return res.status(201).json({
      success: true,
      message: "Deputy opportunity created",
      job,
      matchedCount: matchedMusicians.length,
    });
  } catch (error) {
    console.error("❌ createDeputyOpportunity error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to create deputy opportunity",
    });
  }
};

export const getDeputyOpportunities = async (req, res) => {
  try {
    const jobs = await DeputyOpportunity.find({
      status: "open",
    })
      .sort({ date: 1, createdAt: -1 })
      .lean();

    return res.json({
      success: true,
      jobs,
    });
  } catch (error) {
    console.error("❌ getDeputyOpportunities error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch deputy opportunities",
    });
  }
};

export const getDeputyOpportunityById = async (req, res) => {
  try {
    const job = await DeputyOpportunity.findById(req.params.id).lean();

    if (!job) {
      return res.status(404).json({
        success: false,
        message: "Job not found",
      });
    }

    return res.json({
      success: true,
      job,
    });
  } catch (error) {
    console.error("❌ getDeputyOpportunityById error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch deputy opportunity",
    });
  }
};

export const applyToDeputyOpportunity = async (req, res) => {
  try {
    const user = req.user;
    const jobId = req.params.id;

    const job = await DeputyOpportunity.findById(jobId);
    if (!job) {
      return res.status(404).json({
        success: false,
        message: "Job not found",
      });
    }

    if (job.status !== "open") {
      return res.status(400).json({
        success: false,
        message: "This job is no longer open",
      });
    }

    const musician = await musicianModel.findOne({
      $or: [
        { userId: user?._id },
        { email: user?.email },
        { "basicInfo.email": user?.email },
      ],
    }).lean();

    if (!musician) {
      return res.status(404).json({
        success: false,
        message: "Musician profile not found",
      });
    }

    const readiness = getApplicationReadiness(musician);
    if (!readiness.canApply) {
      return res.status(400).json({
        success: false,
        message: "Profile is not ready to apply",
        missing: readiness.missing,
      });
    }

    const existing = await DeputyOpportunityApplication.findOne({
      deputyOpportunityId: jobId,
      musicianId: musician._id,
    });

    if (existing) {
      return res.status(400).json({
        success: false,
        message: "You have already applied for this job",
      });
    }

    const application = await DeputyOpportunityApplication.create({
      deputyOpportunityId: jobId,
      musicianId: musician._id,
      applicantUserId: user?._id,
      name:
        musician?.basicInfo?.firstName && musician?.basicInfo?.lastName
          ? `${musician.basicInfo.firstName} ${musician.basicInfo.lastName}`.trim()
          : musician?.basicInfo?.firstName || musician?.firstName || "Applicant",
      email: musician?.basicInfo?.email || musician?.email || "",
      phone: musician?.basicInfo?.phone || musician?.phone || "",
      postcode: musician?.address?.postcode || "",
      instrumentation: Array.isArray(musician?.instrumentation)
        ? musician.instrumentation
        : [],
      status: "applied",
      appliedAt: new Date(),
    });

    return res.status(201).json({
      success: true,
      message: "Applied successfully",
      application,
    });
  } catch (error) {
    console.error("❌ applyToDeputyOpportunity error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to apply for deputy opportunity",
    });
  }
};

export const getDeputyOpportunityApplicants = async (req, res) => {
  try {
    const user = req.user;
    const jobId = req.params.id;

    const job = await DeputyOpportunity.findById(jobId).lean();
    if (!job) {
      return res.status(404).json({
        success: false,
        message: "Job not found",
      });
    }

    if (!isAdminUser(user) && !isCreator(job, user)) {
      return res.status(403).json({
        success: false,
        message: "Not authorised to view applicants",
      });
    }

    const applications = await DeputyOpportunityApplication.find({
      deputyOpportunityId: jobId,
    })
      .sort({ appliedAt: -1 })
      .lean();

    return res.json({
      success: true,
      applications,
    });
  } catch (error) {
    console.error("❌ getDeputyOpportunityApplicants error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch applicants",
    });
  }
};

export const assignDeputyOpportunity = async (req, res) => {
  try {
    const user = req.user;
    const jobId = req.params.id;
    const { applicationId } = req.body;

    const job = await DeputyOpportunity.findById(jobId);
    if (!job) {
      return res.status(404).json({
        success: false,
        message: "Job not found",
      });
    }

    if (!isAdminUser(user) && !isCreator(job, user)) {
      return res.status(403).json({
        success: false,
        message: "Not authorised to assign this job",
      });
    }

    const application = await DeputyOpportunityApplication.findById(applicationId);
    if (!application) {
      return res.status(404).json({
        success: false,
        message: "Application not found",
      });
    }

    const musician = await musicianModel.findById(application.musicianId).lean();

    job.status = "assigned";
    job.assignedApplicationId = application._id;
    job.assignedMusicianId = application.musicianId;
    job.assignedAt = new Date();
    await job.save();

    application.status = "assigned";
    application.assignedAt = new Date();
    await application.save();

    await DeputyOpportunityApplication.updateMany(
      {
        deputyOpportunityId: jobId,
        _id: { $ne: application._id },
      },
      {
        $set: {
          status: "closed",
        },
      }
    );

    await sendAssignmentNotifications({
      job,
      assignedMusician: musician,
      application,
    });

    return res.json({
      success: true,
      message: "Deputy assigned successfully",
      job,
    });
  } catch (error) {
    console.error("❌ assignDeputyOpportunity error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to assign deputy opportunity",
    });
  }
};

export const closeDeputyOpportunity = async (req, res) => {
  try {
    const user = req.user;
    const jobId = req.params.id;

    const job = await DeputyOpportunity.findById(jobId);
    if (!job) {
      return res.status(404).json({
        success: false,
        message: "Job not found",
      });
    }

    if (!isAdminUser(user) && !isCreator(job, user)) {
      return res.status(403).json({
        success: false,
        message: "Not authorised to close this job",
      });
    }

    job.status = "closed";
    job.closedAt = new Date();
    await job.save();

    await DeputyOpportunityApplication.updateMany(
      { deputyOpportunityId: jobId, status: "applied" },
      { $set: { status: "closed" } }
    );

    return res.json({
      success: true,
      message: "Deputy opportunity closed",
      job,
    });
  } catch (error) {
    console.error("❌ closeDeputyOpportunity error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to close deputy opportunity",
    });
  }
};