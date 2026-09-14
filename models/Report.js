// models/Report.js
import mongoose from "mongoose";

const reportSchema = new mongoose.Schema(
  {
    reporter: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    targetType: {
      type: String,
      enum: ["recipe", "user", "comment"],
      required: true,
    },
    targetId: { type: mongoose.Schema.Types.ObjectId, required: true },
    reason: { type: String, required: true, trim: true, maxlength: 500 },
    status: { type: String, enum: ["open", "reviewed"], default: "open" },
  },
  { timestamps: true }
);

reportSchema.index({ targetType: 1, targetId: 1 });
// Backs the duplicate check in createReport, which runs on every report
// filed and would otherwise scan the whole collection.
reportSchema.index({ reporter: 1, targetType: 1, targetId: 1, status: 1 });
reportSchema.index({ status: 1, _id: -1 });

export default mongoose.model("Report", reportSchema);
