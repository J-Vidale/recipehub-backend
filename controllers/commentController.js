// controllers/commentController.js
import mongoose from "mongoose";
import Recipe from "../models/Recipe.js";
import Comment from "../models/Comment.js";

const MAX_TEXT_LENGTH = 1000;

// POST /api/recipes/:id/comments
export const addComment = async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(400).json({ message: "Invalid recipe ID" });
  }

  const recipe = await Recipe.findById(req.params.id);
  if (!recipe) {
    return res.status(404).json({ message: "Recipe not found" });
  }

  const { text, parentComment } = req.body;
  if (!text || !text.trim()) {
    return res.status(400).json({ message: "Comment text is required" });
  }
  if (text.length > MAX_TEXT_LENGTH) {
    return res
      .status(400)
      .json({ message: `Comment cannot exceed ${MAX_TEXT_LENGTH} characters` });
  }

  let parentId = null;
  if (parentComment) {
    if (!mongoose.Types.ObjectId.isValid(parentComment)) {
      return res.status(400).json({ message: "Invalid parent comment ID" });
    }
    const parent = await Comment.findById(parentComment);
    if (!parent || parent.recipe.toString() !== recipe._id.toString()) {
      return res.status(404).json({ message: "Parent comment not found" });
    }
    if (parent.parentComment) {
      return res.status(400).json({
        message: "Cannot reply to a reply; reply to the top-level comment instead",
      });
    }
    parentId = parent._id;
  }

  const comment = await Comment.create({
    recipe: recipe._id,
    user: req.user._id,
    parentComment: parentId,
    text: text.trim(),
  });

  recipe.commentCount += 1;
  await recipe.save();

  const populated = await comment.populate("user", "username");
  res.status(201).json(populated);
};

// GET /api/recipes/:id/comments
export const getComments = async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(400).json({ message: "Invalid recipe ID" });
  }

  const recipe = await Recipe.findById(req.params.id);
  if (!recipe) {
    return res.status(404).json({ message: "Recipe not found" });
  }

  const comments = await Comment.find({ recipe: recipe._id })
    .sort({ createdAt: 1 })
    .populate("user", "username");

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

  const recipe = await Recipe.findById(req.params.id);
  if (!recipe) {
    return res.status(404).json({ message: "Recipe not found" });
  }

  const comment = await Comment.findById(req.params.commentId);
  if (!comment || comment.recipe.toString() !== recipe._id.toString()) {
    return res.status(404).json({ message: "Comment not found" });
  }

  const isAuthor = comment.user.toString() === req.user._id.toString();
  const isRecipeOwner = recipe.user.toString() === req.user._id.toString();
  if (!isAuthor && !isRecipeOwner) {
    return res.status(403).json({ message: "Not authorized" });
  }

  const replies = await Comment.find({ parentComment: comment._id });
  const deletedCount = 1 + replies.length;

  await Comment.deleteMany({
    _id: { $in: [comment._id, ...replies.map((r) => r._id)] },
  });

  recipe.commentCount = Math.max(0, recipe.commentCount - deletedCount);
  await recipe.save();

  res.json({ message: "Comment deleted" });
};
