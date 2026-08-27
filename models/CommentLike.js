// models/CommentLike.js
import mongoose from "mongoose";

const commentLikeSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    comment: { type: mongoose.Schema.Types.ObjectId, ref: "Comment", required: true },
  },
  { timestamps: true }
);

commentLikeSchema.index({ user: 1, comment: 1 }, { unique: true });

export default mongoose.model("CommentLike", commentLikeSchema);
