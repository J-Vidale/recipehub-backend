// controllers/messageController.js
import mongoose from "mongoose";
import Conversation, { buildPairKey } from "../models/Conversation.js";
import Message from "../models/Message.js";
import { isBlockedEitherWay } from "../utils/isBlocked.js";
import { emitToUser } from "../config/socket.js";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

const otherParticipant = (conversation, selfId) =>
  conversation.participants.find((p) => p.toString() !== selfId.toString());

// POST /api/conversations  body: { userId }
export const startConversation = async (req, res) => {
  const { userId } = req.body;
  if (!mongoose.Types.ObjectId.isValid(userId)) {
    return res.status(400).json({ message: "Invalid user ID" });
  }
  if (userId === req.user._id.toString()) {
    return res.status(400).json({ message: "You cannot message yourself" });
  }

  if (await isBlockedEitherWay(req.user._id, userId)) {
    return res.status(403).json({ message: "You cannot message this user" });
  }

  const pairKey = buildPairKey(req.user._id, userId);

  try {
    const conversation = await Conversation.create({
      participants: [req.user._id, userId],
      pairKey,
    });
    return res.status(201).json(conversation);
  } catch (err) {
    if (err.code !== 11000) {
      throw err;
    }
    // Conversation already exists - idempotent, return the existing one.
    const existing = await Conversation.findOne({ pairKey }).lean();
    return res.json(existing);
  }
};

// GET /api/conversations?page=&limit=
export const getConversations = async (req, res) => {
  let page = parseInt(req.query.page, 10);
  if (!Number.isInteger(page) || page < 1) page = 1;
  let limit = parseInt(req.query.limit, 10);
  if (!Number.isInteger(limit) || limit < 1) limit = DEFAULT_LIMIT;
  limit = Math.min(limit, MAX_LIMIT);

  const conversations = await Conversation.find({ participants: req.user._id })
    .sort({ lastMessageAt: -1 })
    .skip((page - 1) * limit)
    .limit(limit + 1)
    .populate("participants", "username avatarUrl")
    .lean();

  const hasMore = conversations.length > limit;
  const pageItems = hasMore ? conversations.slice(0, limit) : conversations;

  const shaped = pageItems.map((c) => ({
    _id: c._id,
    otherUser: c.participants.find((p) => p._id.toString() !== req.user._id.toString()),
    lastMessageText: c.lastMessageText,
    lastMessageAt: c.lastMessageAt,
  }));

  res.json({ conversations: shaped, page, hasMore });
};

// GET /api/conversations/:id/messages?cursor=&limit=
export const getMessages = async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(400).json({ message: "Invalid conversation ID" });
  }

  const conversation = await Conversation.findById(req.params.id).lean();
  if (!conversation) {
    return res.status(404).json({ message: "Conversation not found" });
  }
  if (!conversation.participants.some((p) => p.toString() === req.user._id.toString())) {
    return res.status(403).json({ message: "Not authorized" });
  }

  const cursor = req.query.cursor;
  if (cursor !== undefined && !mongoose.Types.ObjectId.isValid(cursor)) {
    return res.status(400).json({ message: "Invalid cursor" });
  }

  let limit = parseInt(req.query.limit, 10);
  if (!Number.isInteger(limit) || limit < 1) limit = DEFAULT_LIMIT;
  limit = Math.min(limit, MAX_LIMIT);

  const query = { conversation: conversation._id };
  if (cursor) {
    query._id = { $lt: cursor };
  }

  const messages = await Message.find(query)
    .sort({ _id: -1 })
    .limit(limit + 1)
    .lean();

  const hasMore = messages.length > limit;
  const page = hasMore ? messages.slice(0, limit) : messages;
  const nextCursor = hasMore ? page[page.length - 1]._id : null;

  res.json({ messages: page, nextCursor });
};

// POST /api/conversations/:id/messages  body: { text }
export const sendMessage = async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(400).json({ message: "Invalid conversation ID" });
  }

  const conversation = await Conversation.findById(req.params.id);
  if (!conversation) {
    return res.status(404).json({ message: "Conversation not found" });
  }
  if (!conversation.participants.some((p) => p.toString() === req.user._id.toString())) {
    return res.status(403).json({ message: "Not authorized" });
  }

  const recipientId = otherParticipant(conversation, req.user._id);
  if (await isBlockedEitherWay(req.user._id, recipientId)) {
    return res.status(403).json({ message: "You cannot message this user" });
  }

  const { text } = req.body;
  if (typeof text !== "string" || !text.trim()) {
    return res.status(400).json({ message: "Message text is required" });
  }
  if (text.length > 2000) {
    return res.status(400).json({ message: "Message cannot exceed 2000 characters" });
  }

  const message = await Message.create({
    conversation: conversation._id,
    sender: req.user._id,
    text: text.trim(),
  });

  conversation.lastMessageText = message.text;
  conversation.lastMessageAt = message.createdAt;
  await conversation.save();

  emitToUser(recipientId.toString(), "message:new", {
    conversationId: conversation._id,
    message,
  });

  res.status(201).json(message);
};

// POST /api/conversations/:id/read
export const markConversationRead = async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(400).json({ message: "Invalid conversation ID" });
  }

  const conversation = await Conversation.findById(req.params.id).lean();
  if (!conversation) {
    return res.status(404).json({ message: "Conversation not found" });
  }
  if (!conversation.participants.some((p) => p.toString() === req.user._id.toString())) {
    return res.status(403).json({ message: "Not authorized" });
  }

  await Message.updateMany(
    { conversation: conversation._id, sender: { $ne: req.user._id }, read: false },
    { $set: { read: true } }
  );

  res.json({ message: "Conversation marked as read" });
};

// GET /api/conversations/unread-count
export const getUnreadConversationCount = async (req, res) => {
  const conversations = await Conversation.find({ participants: req.user._id })
    .select("_id")
    .lean();
  const conversationIds = conversations.map((c) => c._id);

  const count = await Message.distinct("conversation", {
    conversation: { $in: conversationIds },
    sender: { $ne: req.user._id },
    read: false,
  });

  res.json({ count: count.length });
};
