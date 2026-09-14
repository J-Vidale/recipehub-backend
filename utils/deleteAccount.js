// utils/deleteAccount.js
import Recipe from "../models/Recipe.js";
import Comment from "../models/Comment.js";
import CommentLike from "../models/CommentLike.js";
import Like from "../models/Like.js";
import Share from "../models/Share.js";
import Follow from "../models/Follow.js";
import Block from "../models/Block.js";
import Conversation from "../models/Conversation.js";
import Message from "../models/Message.js";
import Notification from "../models/Notification.js";
import Report from "../models/Report.js";
import User from "../models/User.js";
import { purgeRecipes } from "./purgeRecipes.js";
import { destroyQuietly } from "./media.js";
import { disconnectUser } from "../config/socket.js";

// bulkWrite rejects an empty list, and every one of these is empty for
// somebody - a new account has no likes, most have no blocks.
const applyAll = async (Model, operations) => {
  if (operations.length) await Model.bulkWrite(operations);
};

// The counters are denormalised, so removing a row means putting the
// number it contributed back. $gte / $gt guards for the same reason the
// rest of the app uses them: a count that has already drifted should stay
// where it is rather than go negative.
const decrementBy = (id, field, amount) => ({
  updateOne: {
    filter: { _id: id, [field]: { $gte: amount } },
    update: { $inc: { [field]: -amount } },
  },
});

/**
 * Their comments on other people's recipes, and the replies underneath
 * them.
 *
 * Replies go too, matching what deleting a single comment already does:
 * a reply whose parent is gone has nothing to be a reply to, and renders
 * as a fragment of a conversation nobody can read.
 */
const removeTheirComments = async (userId) => {
  const own = await Comment.find({ user: userId }).select("_id recipe").lean();
  if (!own.length) return;

  const ownIds = own.map((c) => c._id);
  const replies = await Comment.find({ parentComment: { $in: ownIds } })
    .select("_id recipe")
    .lean();

  const all = [...own, ...replies];
  const allIds = all.map((c) => c._id);

  await Comment.deleteMany({ _id: { $in: allIds } });
  await CommentLike.deleteMany({ comment: { $in: allIds } });
  await Notification.deleteMany({ comment: { $in: allIds } });
  await Report.deleteMany({ targetType: "comment", targetId: { $in: allIds } });

  // One write per recipe rather than one per comment.
  const perRecipe = new Map();
  for (const comment of all) {
    const key = comment.recipe.toString();
    perRecipe.set(key, (perRecipe.get(key) ?? 0) + 1);
  }
  await applyAll(
    Recipe,
    [...perRecipe].map(([recipeId, count]) => decrementBy(recipeId, "commentCount", count))
  );

  // A recipe owner may have pinned one of their comments.
  await Recipe.updateMany({ pinnedComment: { $in: allIds } }, { $set: { pinnedComment: null } });
};

// A like is unique per (user, target), so each target loses exactly one.
const removeTheirLikes = async (userId) => {
  const likes = await Like.find({ user: userId }).select("recipe").lean();
  if (!likes.length) return;
  await Like.deleteMany({ user: userId });
  await applyAll(Recipe, likes.map((like) => decrementBy(like.recipe, "likeCount", 1)));
};

const removeTheirCommentLikes = async (userId) => {
  const likes = await CommentLike.find({ user: userId }).select("comment").lean();
  if (!likes.length) return;
  await CommentLike.deleteMany({ user: userId });
  await applyAll(Comment, likes.map((like) => decrementBy(like.comment, "likeCount", 1)));
};

const removeTheirShares = async (userId) => {
  const shares = await Share.find({ user: userId }).select("recipe").lean();
  if (!shares.length) return;
  await Share.deleteMany({ user: userId });
  await applyAll(Recipe, shares.map((share) => decrementBy(share.recipe, "shareCount", 1)));
};

// Both directions: the people they followed lose a follower, and the
// people who followed them lose a following.
const removeTheirFollows = async (userId) => {
  const [followed, followers] = await Promise.all([
    Follow.find({ follower: userId }).select("following").lean(),
    Follow.find({ following: userId }).select("follower").lean(),
  ]);
  if (!followed.length && !followers.length) return;

  await Follow.deleteMany({ $or: [{ follower: userId }, { following: userId }] });
  await applyAll(User, [
    ...followed.map((f) => decrementBy(f.following, "followerCount", 1)),
    ...followers.map((f) => decrementBy(f.follower, "followingCount", 1)),
  ]);
};

/**
 * Delete an account and everything belonging to it.
 *
 * "Everything" is the literal promise: recipes, comments, likes, shares,
 * saves, follows, blocks, conversations, messages, notifications and
 * reports, plus every image in Cloudinary. Nothing is kept under a
 * placeholder name. That is the cost of the plain reading of "delete my
 * account", and it is the reading this app offers.
 *
 * @param {import("mongoose").Types.ObjectId|string} userId
 * @returns {Promise<boolean>} false if there was no such account.
 */
export const deleteAccount = async (userId) => {
  const user = await User.findById(userId).select("avatarPublicId savedRecipes").lean();
  if (!user) return false;

  const recipes = await Recipe.find({ user: userId }).select("_id media").lean();
  const recipeIds = recipes.map((recipe) => recipe._id);
  const saved = user.savedRecipes ?? [];

  // The account row goes first. protect() looks the user up on every
  // request, so the moment it is gone their token buys nothing - which
  // means no new recipe, comment or like can arrive behind the cascade
  // and outlive it. Same reasoning as removing a recipe before its likes,
  // applied to the whole account at once.
  await User.deleteOne({ _id: userId });

  // And their live connection, which the handshake is the only place that
  // ever checks. It would otherwise stay open on a deleted account until
  // the process restarts or the tab closes.
  disconnectUser(String(userId));

  // Their own recipes, and everything anyone else left on them.
  await purgeRecipes(recipeIds);

  // What they left on other people's recipes. Anything they left on their
  // own went with the recipes above, so these are all other people's and
  // every counter here belongs to someone who is still here.
  await removeTheirComments(userId);
  await removeTheirLikes(userId);
  await removeTheirCommentLikes(userId);
  await removeTheirShares(userId);

  // Their saves are rows in their own document, which is already gone -
  // but the recipes they saved still count them.
  await applyAll(Recipe, saved.map((recipeId) => decrementBy(recipeId, "saveCount", 1)));

  await removeTheirFollows(userId);
  await Block.deleteMany({ $or: [{ blocker: userId }, { blocked: userId }] });

  // A 1:1 conversation with nobody on one side is not a conversation.
  const conversationIds = await Conversation.find({ participants: userId }).distinct("_id");
  if (conversationIds.length) {
    await Conversation.deleteMany({ _id: { $in: conversationIds } });
    await Message.deleteMany({ conversation: { $in: conversationIds } });
  }

  // Notifications either way: the ones they received, and the ones their
  // actions caused for somebody else.
  await Notification.deleteMany({ $or: [{ recipient: userId }, { actor: userId }] });

  // Reports they filed, and reports filed about them.
  await Report.deleteMany({
    $or: [{ reporter: userId }, { targetType: "user", targetId: userId }],
  });

  // Cloudinary last, and never able to fail the deletion: the database is
  // already the truth, and an asset left behind costs storage, not
  // correctness.
  await Promise.all([
    ...recipes.flatMap((recipe) =>
      (recipe.media ?? []).map((item) =>
        destroyQuietly(item.publicId, item.type === "video" ? "video" : "image")
      )
    ),
    destroyQuietly(user.avatarPublicId),
  ]);

  return true;
};
