// controllers/commentLikeController.js
import mongoose from "mongoose";
import Comment from "../models/Comment.js";
import CommentLike from "../models/CommentLike.js";
import { addLike, removeLike } from "../utils/likeToggle.js";

// POST /api/comments/:commentId/like
export const likeComment = async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.commentId)) {
    return res.status(400).json({ message: "Invalid comment ID" });
  }

  const comment = await Comment.findById(req.params.commentId);
  if (!comment) {
    return res.status(404).json({ message: "Comment not found" });
  }

  const result = await addLike({
    LikeModel: CommentLike,
    likeQuery: { user: req.user._id, comment: comment._id },
    CountModel: Comment,
    countId: comment._id,
  });

  res.json(result);
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

  const result = await removeLike({
    LikeModel: CommentLike,
    likeQuery: { user: req.user._id, comment: comment._id },
    CountModel: Comment,
    countId: comment._id,
  });

  res.json(result);
};
