// utils/notify.js
import Notification from "../models/Notification.js";

// Best-effort: a notification failing to write should never break the
// primary action (liking, following, commenting) that triggered it.
export const createNotification = async ({ recipient, actor, type, recipe = null, comment = null }) => {
  if (recipient.toString() === actor.toString()) {
    return; // Never notify a user about their own action.
  }
  try {
    await Notification.create({ recipient, actor, type, recipe, comment });
  } catch (err) {
    console.error("Failed to create notification:", err.message);
  }
};
