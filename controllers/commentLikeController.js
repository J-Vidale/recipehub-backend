// controllers/commentLikeController.js
import mongoose from "mongoose";
import Comment from "../models/Comment.js";
import CommentLike from "../models/CommentLike.js";

// POST /api/comments/:commentId/like
export const likeComment = async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.commentId)) {
    return res.status(400).json({ message: "Invalid comment ID" });
  }

  const comment = await Comment.findById(req.params.commentId);
  if (!comment) {
    return res.status(404).json({ message: "Comment not found" });
  }

  try {
    await CommentLike.create({ user: req.user._id, comment: comment._id });
    comment.likeCount += 1;
    await comment.save();
  } catch (err) {
    if (err.code !== 11000) {
      throw err;
    }
    // Already liked - idempotent; comment.likeCount already reflects it.
  }

  res.json({ likeCount: comment.likeCount, likedByMe: true });
};

// DELETE /api/comments/:commentId/like
export const unlikeComment = async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.commentId)) {
    return res.status(400).json({ message: "Invalid comment ID" });
  }

  const comment = await Comment.findById(req.params.commentId);
  if (!comment) {
    return res.status(404).json({ message: "Comment not found" });
  }

  const deleted = await CommentLike.findOneAndDelete({ user: req.user._id, comment: comment._id });
  if (deleted) {
    comment.likeCount = Math.max(0, comment.likeCount - 1);
    await comment.save();
  }

  res.json({ likeCount: comment.likeCount, likedByMe: false });
};
