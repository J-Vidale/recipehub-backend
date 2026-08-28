// models/Conversation.js
import mongoose from "mongoose";

const conversationSchema = new mongoose.Schema(
  {
    participants: [
      { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    ],
    // Canonical "<lowerId>_<higherId>" key so a 1:1 conversation between
    // two users can never be created twice, regardless of who initiates.
    // A unique index directly on `participants` would NOT achieve this -
    // MongoDB indexes an array field as a multikey index, enforcing
    // uniqueness per element, not per array value, which would wrongly
    // block a user from ever being in more than one conversation at all.
    pairKey: { type: String, required: true, unique: true },
    lastMessageText: { type: String, default: "" },
    lastMessageAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

conversationSchema.index({ participants: 1, lastMessageAt: -1 });

export const buildPairKey = (userIdA, userIdB) => {
  const [a, b] = [userIdA.toString(), userIdB.toString()].sort();
  return `${a}_${b}`;
};

export default mongoose.model("Conversation", conversationSchema);
