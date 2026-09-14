import express from "express";
import { createReport, listReports, updateReportStatus } from "../controllers/reportController.js";
import { protect } from "../middleware/authMiddleware.js";
import { requireAdmin } from "../middleware/adminMiddleware.js";

const router = express.Router();

router.post("/", protect, createReport);

// Moderation. requireAdmin answers 404 rather than 403, so these read as
// absent to anyone who is not a moderator.
router.get("/", protect, requireAdmin, listReports);
router.patch("/:id", protect, requireAdmin, updateReportStatus);

export default router;
