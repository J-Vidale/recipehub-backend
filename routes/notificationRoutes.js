import express from "express";
import {
  getNotifications,
  getUnreadCount,
  markAsRead,
  markAllAsRead,
} from "../controllers/notificationController.js";
import { protect } from "../middleware/authMiddleware.js";

const router = express.Router();

router.get("/unread-count", protect, getUnreadCount);
router.post("/read-all", protect, markAllAsRead);
router.get("/", protect, getNotifications);
router.post("/:id/read", protect, markAsRead);

export default router;
