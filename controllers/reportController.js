// controllers/reportController.js
import mongoose from "mongoose";
import Report from "../models/Report.js";

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
