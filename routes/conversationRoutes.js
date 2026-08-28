import express from "express";
import {
  startConversation,
  getConversations,
  getMessages,
  sendMessage,
  markConversationRead,
  getUnreadConversationCount,
} from "../controllers/messageController.js";
import { protect } from "../middleware/authMiddleware.js";

const router = express.Router();

router.get("/unread-count", protect, getUnreadConversationCount);
router.post("/", protect, startConversation);
router.get("/", protect, getConversations);
router.get("/:id/messages", protect, getMessages);
router.post("/:id/messages", protect, sendMessage);
router.post("/:id/read", protect, markConversationRead);

export default router;
