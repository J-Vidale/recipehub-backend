// controllers/messageController.js
import mongoose from "mongoose";
import Conversation, { buildPairKey } from "../models/Conversation.js";
import Message from "../models/Message.js";
import { isBlockedEitherWay } from "../utils/isBlocked.js";
import { emitToUser } from "../config/socket.js";
import { parsePageQuery } from "../utils/pagination.js";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

// The conversation list shows one line per row, and a message can be 2000
// characters. Storing the whole body as the preview put up to 50 of them in
// a single list response - tens of kilobytes to render a few words each.
export const MAX_PREVIEW_LENGTH = 140;

export const previewOf = (text) =>
  text.length > MAX_PREVIEW_LENGTH ? `${text.slice(0, MAX_PREVIEW_LENGTH - 1).trimEnd()}\u2026` : text;

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
  // Conversations order by lastMessageAt, not _id, and that value changes
  // whenever a message arrives - so a cursor over it would skip or repeat
  // rows as the list reorders underneath the reader. This one keeps skip
  // deliberately; the page count here is bounded by how many people you
  // have talked to, so the cost stays small.
  const { page, limit, skip } = parsePageQuery(req.query, DEFAULT_LIMIT, MAX_LIMIT);

  const conversations = await Conversation.find({ participants: req.user._id })
    .sort({ lastMessageAt: -1 })
    .skip(skip)
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

  // Conditional, not a read-modify-write. Two messages arriving close
  // together both loaded this conversation, both set the preview, and
  // whichever saved last won - which could be the older of the two. The
  // list is sorted by lastMessageAt and shows lastMessageText, so that put
  // a stale preview at the wrong place in the list. This only ever moves
  // the preview forward.
  await Conversation.updateOne(
    // $lte, not $lt: a new conversation's lastMessageAt defaults to its
    // creation time, so a first message sent in the same millisecond would
    // be turned away and the conversation would sit in the list with no
    // preview at all. Between two messages an exact tie to the millisecond
    // is a genuine tie, and either of them is fairly called the latest.
    { _id: conversation._id, lastMessageAt: { $lte: message.createdAt } },
    {
      $set: {
        lastMessageText: previewOf(message.text),
        lastMessageAt: message.createdAt,
      },
    }
  );

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
