// utils/isBlocked.js
import Block from "../models/Block.js";

// True if either user has blocked the other - the interaction should be
// rejected regardless of which direction the block runs.
export const isBlockedEitherWay = async (userIdA, userIdB) => {
  const block = await Block.findOne({
    $or: [
      { blocker: userIdA, blocked: userIdB },
      { blocker: userIdB, blocked: userIdA },
    ],
  })
    .select("_id")
    .lean();
  return Boolean(block);
};
