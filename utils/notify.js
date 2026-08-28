// utils/notify.js
import Notification from "../models/Notification.js";
import { emitToUser } from "../config/socket.js";

// Best-effort: a notification failing to write should never break the
// primary action (liking, following, commenting) that triggered it.
export const createNotification = async ({ recipient, actor, type, recipe = null, comment = null }) => {
  if (recipient.toString() === actor.toString()) {
    return; // Never notify a user about their own action.
  }
  try {
    const notification = await Notification.create({ recipient, actor, type, recipe, comment });
    const populated = await Notification.findById(notification._id)
      .populate("actor", "username")
      .populate("recipe", "title")
      .lean();
    emitToUser(recipient.toString(), "notification:new", populated);
  } catch (err) {
    console.error("Failed to create notification:", err.message);
  }
};
