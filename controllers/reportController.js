// controllers/reportController.js
import mongoose from "mongoose";
import Report from "../models/Report.js";
import Recipe from "../models/Recipe.js";
import Comment from "../models/Comment.js";
import User from "../models/User.js";
import { parseListQuery, withCursor, buildPage } from "../utils/pagination.js";

const VALID_TARGET_TYPES = ["recipe", "user", "comment"];
const MAX_REASON_LENGTH = 500;

// POST /api/reports
export const createReport = async (req, res) => {
  const { targetType, targetId, reason } = req.body;

  if (!VALID_TARGET_TYPES.includes(targetType)) {
    return res.status(400).json({ message: "Invalid target type" });
  }
  if (!mongoose.Types.ObjectId.isValid(targetId)) {
    return res.status(400).json({ message: "Invalid target ID" });
  }
  if (typeof reason !== "string" || !reason.trim()) {
    return res.status(400).json({ message: "A reason is required" });
  }
  if (reason.length > MAX_REASON_LENGTH) {
    return res
      .status(400)
      .json({ message: `Reason cannot exceed ${MAX_REASON_LENGTH} characters` });
  }

  const report = await Report.create({
    reporter: req.user._id,
    targetType,
    targetId,
    reason: reason.trim(),
  });

  res.status(201).json({ message: "Report submitted", reportId: report._id });
};

const VALID_STATUSES = ["open", "reviewed"];

/**
 * Loads what each report is about, in one query per kind rather than one
 * per report. A moderator cannot act on "a report about 64f1c0de..." - the
 * whole job is looking at the thing being complained about.
 *
 * A target that no longer exists comes back as null. Deleting a recipe,
 * comment or account now clears the reports about it, so this should be
 * rare - but a report filed in the window between is possible, and a
 * moderation queue that throws on one is worse than one that shows it as
 * already gone.
 */
const resolveTargets = async (reports) => {
  const idsOf = (type) =>
    reports.filter((report) => report.targetType === type).map((report) => report.targetId);

  const [recipes, comments, users] = await Promise.all([
    Recipe.find({ _id: { $in: idsOf("recipe") } }).select("title user").lean(),
    Comment.find({ _id: { $in: idsOf("comment") } }).select("text recipe user").lean(),
    User.find({ _id: { $in: idsOf("user") } }).select("username").lean(),
  ]);

  const byId = new Map();
  for (const doc of [...recipes, ...comments, ...users]) byId.set(String(doc._id), doc);
  return byId;
};

// GET /api/reports?status=&limit=&cursor=   (moderators only)
export const listReports = async (req, res) => {
  const { status } = req.query;
  if (status !== undefined && !VALID_STATUSES.includes(status)) {
    return res.status(400).json({ message: "Invalid status" });
  }

  const { limit, cursor } = parseListQuery(req.query);
  const filter = withCursor(status ? { status } : {}, cursor);

  const reports = await Report.find(filter)
    .sort({ _id: -1 })
    .limit(limit + 1)
    .populate("reporter", "username")
    .lean();

  const page = buildPage(reports, limit);
  const targets = await resolveTargets(page.items);

  res.json({
    reports: page.items.map((report) => ({
      ...report,
      // Named `target`, not merged into the report, so a moderator can
      // tell the difference between "the reported text" and "the reason
      // given for reporting it".
      target: targets.get(String(report.targetId)) ?? null,
    })),
    hasMore: page.hasMore,
    nextCursor: page.nextCursor,
  });
};

// PATCH /api/reports/:id   body: { status }   (moderators only)
export const updateReportStatus = async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(400).json({ message: "Invalid report ID" });
  }

  const { status } = req.body ?? {};
  if (!VALID_STATUSES.includes(status)) {
    return res.status(400).json({ message: "Invalid status" });
  }

  const report = await Report.findByIdAndUpdate(
    req.params.id,
    { $set: { status } },
    { new: true }
  )
    .populate("reporter", "username")
    .lean();

  if (!report) {
    return res.status(404).json({ message: "Report not found" });
  }

  res.json(report);
};
