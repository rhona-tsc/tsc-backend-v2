import mongoose from "mongoose";
import deputyJobModel from "../models/deputyJobModel.js";

export const getActiveApplicantPriorities = async (musicianIds = []) => {
  const ids = musicianIds
    .map((value) => String(value || "").trim())
    .filter((value) => mongoose.Types.ObjectId.isValid(value))
    .map((value) => new mongoose.Types.ObjectId(value));
  if (!ids.length) return new Map();

  const rows = await deputyJobModel.aggregate([
    {
      $match: {
        status: "open",
        applications: {
          $elemMatch: {
            musicianId: { $in: ids },
            status: { $in: ["applied", "presented"] },
          },
        },
      },
    },
    { $unwind: "$applications" },
    {
      $match: {
        "applications.musicianId": { $in: ids },
        "applications.status": { $in: ["applied", "presented"] },
      },
    },
    {
      $group: {
        _id: "$applications.musicianId",
        priority: {
          $max: {
            $cond: [{ $eq: ["$applications.status", "presented"] }, 2, 1],
          },
        },
        activeApplicationCount: { $sum: 1 },
      },
    },
  ]);

  return new Map(
    rows.map((row) => [
      String(row._id),
      {
        clientPriority: Number(row.priority || 0),
        clientPriorityStatus: Number(row.priority) === 2 ? "presented" : "applied",
        activeApplicationCount: Number(row.activeApplicationCount || 0),
      },
    ]),
  );
};

export const withApplicantPriority = (record, priorityMap, musicianId) => ({
  ...record,
  ...(priorityMap.get(String(musicianId || "")) || {
    clientPriority: 0,
    clientPriorityStatus: "",
    activeApplicationCount: 0,
  }),
});
