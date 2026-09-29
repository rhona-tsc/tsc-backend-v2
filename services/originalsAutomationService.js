import originalEventModel from "../models/originalEventModel.js";
import originalNotificationModel from "../models/originalNotificationModel.js";
import originalProjectModel from "../models/originalProjectModel.js";
import originalReservationModel from "../models/originalReservationModel.js";
import originalRoundModel from "../models/originalRoundModel.js";
import originalSubmissionModel from "../models/originalSubmissionModel.js";
import { getDueReservationReminder } from "./originalsPolicyService.js";

const queueNotification = async ({ projectId, musicianId, eventKey, template, payload }) => {
  try {
    await originalNotificationModel.create({
      projectId,
      recipientMusicianId: musicianId,
      eventKey,
      template,
      payload,
      channels: ["email", "whatsapp"],
    });
    return true;
  } catch (error) {
    if (error?.code === 11000) return false;
    throw error;
  }
};

export const runOriginalsAutomation = async ({ now = new Date() } = {}) => {
  const result = { remindersQueued: 0, reservationsExpired: 0, roundsClosed: 0 };
  const reservations = await originalReservationModel.find({ state: "active" });

  for (const reservation of reservations) {
    if (reservation.expiresAt <= now) {
      reservation.state = "expired";
      await reservation.save();
      await originalEventModel.create({
        projectId: reservation.projectId,
        roundId: reservation.roundId,
        type: "reservation_expired",
        metadata: { reservationId: String(reservation._id), extensionUnanswered: reservation.extensionRequest?.status === "pending" },
      });
      if (await queueNotification({
        projectId: reservation.projectId,
        musicianId: reservation.musicianId,
        eventKey: `reservation:${reservation._id}:expired`,
        template: "originals_reservation_expired",
        payload: { reservationId: String(reservation._id), roleName: reservation.roleName },
      })) result.remindersQueued += 1;
      result.reservationsExpired += 1;
      continue;
    }

    const reminder = getDueReservationReminder(reservation, now);
    if (!reminder) continue;
    reservation.remindersSent[reminder] = true;
    await reservation.save();
    const hours = reminder === "oneHour" ? 1 : reminder === "sixHour" ? 6 : 12;
    if (await queueNotification({
      projectId: reservation.projectId,
      musicianId: reservation.musicianId,
      eventKey: `reservation:${reservation._id}:reminder:${hours}`,
      template: "originals_reservation_reminder",
      payload: { reservationId: String(reservation._id), roleName: reservation.roleName, hours },
    })) result.remindersQueued += 1;
  }

  const openRounds = await originalRoundModel.find({ state: { $in: ["open", "reopened"] } });
  for (const round of openRounds) {
    const submissions = await originalSubmissionModel.countDocuments({ roundId: round._id, state: { $in: ["submitted", "accepted"] } });
    if (round.closesAt > now && submissions < round.slotLimit) continue;
    round.state = "review";
    round.closedAt = now;
    round.closeReason = submissions >= round.slotLimit ? "submission_limit_reached" : "seven_day_window_ended";
    await round.save();
    const project = await originalProjectModel.findById(round.projectId);
    if (project) {
      project.state = "owner_review";
      await project.save();
      if (await queueNotification({
        projectId: project._id,
        musicianId: project.ownerId,
        eventKey: `round:${round._id}:review`,
        template: "originals_round_ready_for_review",
        payload: { roundId: String(round._id), projectTitle: project.title, submissionCount: submissions },
      })) result.remindersQueued += 1;
    }
    await originalEventModel.create({ projectId: round.projectId, roundId: round._id, type: "round_closed_for_review", metadata: { reason: round.closeReason, submissionCount: submissions } });
    result.roundsClosed += 1;
  }

  return result;
};
