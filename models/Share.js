// models/Share.js
import mongoose from "mongoose";

const shareSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    recipe: { type: mongoose.Schema.Types.ObjectId, ref: "Recipe", required: true },
  },
  { timestamps: true }
);

shareSchema.index({ user: 1, recipe: 1 }, { unique: true });

export default mongoose.model("Share", shareSchema);
