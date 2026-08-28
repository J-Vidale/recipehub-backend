// controllers/notificationController.js
import mongoose from "mongoose";
import Notification from "../models/Notification.js";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

// GET /api/notifications
export const getNotifications = async (req, res) => {
  let limit = parseInt(req.query.limit, 10);
  if (!Number.isInteger(limit) || limit < 1) limit = DEFAULT_LIMIT;
  limit = Math.min(limit, MAX_LIMIT);

  const cursor = req.query.cursor;
  if (cursor !== undefined && !mongoose.Types.ObjectId.isValid(cursor)) {
    return res.status(400).json({ message: "Invalid cursor" });
  }

  const query = { recipient: req.user._id };
  if (cursor) {
    query._id = { $lt: cursor };
  }

  const notifications = await Notification.find(query)
    .sort({ _id: -1 })
    .limit(limit + 1)
    .populate("actor", "username avatarUrl")
    .populate("recipe", "title")
    .lean();

  const hasMore = notifications.length > limit;
  const page = hasMore ? notifications.slice(0, limit) : notifications;
  const nextCursor = hasMore ? page[page.length - 1]._id : null;

  res.json({ notifications: page, nextCursor });
};

// GET /api/notifications/unread-count
export const getUnreadCount = async (req, res) => {
  const count = await Notification.countDocuments({ recipient: req.user._id, read: false });
  res.json({ count });
};

// POST /api/notifications/:id/read
export const markAsRead = async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(400).json({ message: "Invalid notification ID" });
  }

  const notification = await Notification.findOneAndUpdate(
    { _id: req.params.id, recipient: req.user._id },
    { $set: { read: true } },
    { new: true }
  ).lean();

  if (!notification) {
    return res.status(404).json({ message: "Notification not found" });
  }

  res.json(notification);
};

// POST /api/notifications/read-all
export const markAllAsRead = async (req, res) => {
  await Notification.updateMany(
    { recipient: req.user._id, read: false },
    { $set: { read: true } }
  );
  res.json({ message: "All notifications marked as read" });
};
