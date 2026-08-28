// controllers/commentController.js
import mongoose from "mongoose";
import Recipe from "../models/Recipe.js";
import Comment from "../models/Comment.js";
import CommentLike from "../models/CommentLike.js";
import Notification from "../models/Notification.js";
import { createNotification } from "../utils/notify.js";
import { isBlockedEitherWay } from "../utils/isBlocked.js";

const MAX_TEXT_LENGTH = 1000;
const MAX_COMMENTS_LIMIT = 100;
const DEFAULT_COMMENTS_LIMIT = 50;

// POST /api/recipes/:id/comments
export const addComment = async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(400).json({ message: "Invalid recipe ID" });
  }

  const recipe = await Recipe.findById(req.params.id).lean();
  if (!recipe) {
    return res.status(404).json({ message: "Recipe not found" });
  }

  if (await isBlockedEitherWay(req.user._id, recipe.user)) {
    return res.status(403).json({ message: "You cannot comment on this recipe" });
  }

  const { text, parentComment } = req.body;
  if (typeof text !== "string" || !text.trim()) {
    return res.status(400).json({ message: "Comment text is required" });
  }
  if (text.length > MAX_TEXT_LENGTH) {
    return res
      .status(400)
      .json({ message: `Comment cannot exceed ${MAX_TEXT_LENGTH} characters` });
  }

  let parentId = null;
  let parentAuthor = null;
  if (parentComment) {
    if (!mongoose.Types.ObjectId.isValid(parentComment)) {
      return res.status(400).json({ message: "Invalid parent comment ID" });
    }
    const parent = await Comment.findById(parentComment).lean();
    if (!parent) {
      return res.status(404).json({ message: "Parent comment not found" });
    }
    if (parent.recipe.toString() !== recipe._id.toString()) {
      return res
        .status(400)
        .json({ message: "Parent comment belongs to a different recipe" });
    }
    if (parent.parentComment) {
      return res.status(400).json({
        message: "Cannot reply to a reply; reply to the top-level comment instead",
      });
    }
    parentId = parent._id;
    parentAuthor = parent.user;
  }

  const comment = await Comment.create({
    recipe: recipe._id,
    user: req.user._id,
    parentComment: parentId,
    text: text.trim(),
  });

  await Recipe.updateOne({ _id: recipe._id }, { $inc: { commentCount: 1 } });

  if (parentAuthor) {
    createNotification({
      recipient: parentAuthor,
      actor: req.user._id,
      type: "reply",
      recipe: recipe._id,
      comment: comment._id,
    });
  } else {
    createNotification({
      recipient: recipe.user,
      actor: req.user._id,
      type: "comment",
      recipe: recipe._id,
      comment: comment._id,
    });
  }

  const populated = await comment.populate("user", "username avatarUrl");
  res.status(201).json(populated);
};

// POST /api/recipes/:id/comments/:commentId/pin
export const pinComment = async (req, res) => {
  if (
    !mongoose.Types.ObjectId.isValid(req.params.id) ||
    !mongoose.Types.ObjectId.isValid(req.params.commentId)
  ) {
    return res.status(400).json({ message: "Invalid ID" });
  }

  const recipe = await Recipe.findById(req.params.id);
  if (!recipe) {
    return res.status(404).json({ message: "Recipe not found" });
  }

  if (recipe.user.toString() !== req.user._id.toString()) {
    return res.status(403).json({ message: "Not authorized" });
  }

  const comment = await Comment.findById(req.params.commentId).lean();
  if (!comment || comment.recipe.toString() !== recipe._id.toString()) {
    return res.status(404).json({ message: "Comment not found" });
  }

  if (comment.parentComment) {
    return res.status(400).json({ message: "Cannot pin a reply" });
  }

  recipe.pinnedComment = comment._id;
  await recipe.save();

  res.json({ pinnedComment: recipe.pinnedComment });
};

// DELETE /api/recipes/:id/pin
export const unpinComment = async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(400).json({ message: "Invalid recipe ID" });
  }

  const recipe = await Recipe.findById(req.params.id);
  if (!recipe) {
    return res.status(404).json({ message: "Recipe not found" });
  }

  if (recipe.user.toString() !== req.user._id.toString()) {
    return res.status(403).json({ message: "Not authorized" });
  }

  recipe.pinnedComment = null;
  await recipe.save();

  res.json({ pinnedComment: null });
};

// GET /api/recipes/:id/comments
export const getComments = async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(400).json({ message: "Invalid recipe ID" });
  }

  const recipe = await Recipe.findById(req.params.id).lean();
  if (!recipe) {
    return res.status(404).json({ message: "Recipe not found" });
  }

  let limit = parseInt(req.query.limit, 10);
  if (!Number.isInteger(limit) || limit < 1) limit = DEFAULT_COMMENTS_LIMIT;
  limit = Math.min(limit, MAX_COMMENTS_LIMIT);

  const comments = await Comment.find({ recipe: recipe._id })
    .sort({ createdAt: 1 })
    .limit(limit)
    .populate("user", "username avatarUrl")
    .lean();

  if (recipe.pinnedComment) {
    const pinnedId = recipe.pinnedComment.toString();
    comments.sort((a, b) => {
      const aPinned = a._id.toString() === pinnedId ? 0 : 1;
      const bPinned = b._id.toString() === pinnedId ? 0 : 1;
      return aPinned - bPinned;
    });
  }

  res.json(comments);
};

// DELETE /api/recipes/:id/comments/:commentId
export const deleteComment = async (req, res) => {
  if (
    !mongoose.Types.ObjectId.isValid(req.params.id) ||
    !mongoose.Types.ObjectId.isValid(req.params.commentId)
  ) {
    return res.status(400).json({ message: "Invalid ID" });
  }

  const recipe = await Recipe.findById(req.params.id).lean();
  if (!recipe) {
    return res.status(404).json({ message: "Recipe not found" });
  }

  const comment = await Comment.findById(req.params.commentId).lean();
  if (!comment || comment.recipe.toString() !== recipe._id.toString()) {
    return res.status(404).json({ message: "Comment not found" });
  }

  const isAuthor = comment.user.toString() === req.user._id.toString();
  const isRecipeOwner = recipe.user.toString() === req.user._id.toString();
  if (!isAuthor && !isRecipeOwner) {
    return res.status(403).json({ message: "Not authorized" });
  }

  const replies = await Comment.find({ parentComment: comment._id }).lean();
  const commentIds = [comment._id, ...replies.map((r) => r._id)];
  const deletedCount = commentIds.length;

  await CommentLike.deleteMany({ comment: { $in: commentIds } });
  await Notification.deleteMany({ comment: { $in: commentIds } });
  await Comment.deleteMany({ _id: { $in: commentIds } });

  await Recipe.updateOne(
    { _id: recipe._id },
    { $inc: { commentCount: -deletedCount } }
  );

  if (recipe.pinnedComment && recipe.pinnedComment.toString() === comment._id.toString()) {
    await Recipe.updateOne({ _id: recipe._id }, { $set: { pinnedComment: null } });
  }

  res.json({ message: "Comment deleted" });
};
