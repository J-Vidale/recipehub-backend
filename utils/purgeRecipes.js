// utils/purgeRecipes.js
import Recipe from "../models/Recipe.js";
import Comment from "../models/Comment.js";
import CommentLike from "../models/CommentLike.js";
import Like from "../models/Like.js";
import Share from "../models/Share.js";
import Notification from "../models/Notification.js";
import User from "../models/User.js";
import Report from "../models/Report.js";

/**
 * Remove recipes and everything that hangs off them.
 *
 * Shared by deleting one recipe and by deleting an account, so the two
 * cannot drift apart - a cascade that is written twice is a cascade where
 * one copy eventually forgets a collection.
 *
 * The recipe rows go first on purpose. Every write path - liking,
 * saving, commenting, sharing - starts by looking the recipe up and
 * answers 404 when it is gone, so removing the rows before their
 * dependents closes the window where one of those could land after its
 * own cleanup step had passed and outlive it as an orphan.
 *
 * Cloudinary assets are the caller's job: they are best-effort, they are
 * slow, and they should not sit between the database writes.
 *
 * @param {import("mongoose").Types.ObjectId[]} recipeIds
 */
export const purgeRecipes = async (recipeIds) => {
  if (!recipeIds.length) return;

  // Read before the rows go: the comment ids are needed to find the likes
  // on them, and nothing here depends on the recipes still existing.
  const commentIds = await Comment.find({ recipe: { $in: recipeIds } }).distinct("_id");

  await Recipe.deleteMany({ _id: { $in: recipeIds } });

  await CommentLike.deleteMany({ comment: { $in: commentIds } });
  await Like.deleteMany({ recipe: { $in: recipeIds } });
  await Share.deleteMany({ recipe: { $in: recipeIds } });
  await Comment.deleteMany({ recipe: { $in: recipeIds } });
  await Notification.deleteMany({ recipe: { $in: recipeIds } });
  await User.updateMany(
    { savedRecipes: { $in: recipeIds } },
    { $pull: { savedRecipes: { $in: recipeIds } } }
  );

  // Reports name their target by id and nothing else, so a report about a
  // recipe or a comment that no longer exists cannot be read or acted on -
  // it is a row pointing at nothing. Cleared with the thing it was about.
  await Report.deleteMany({
    $or: [
      { targetType: "recipe", targetId: { $in: recipeIds } },
      { targetType: "comment", targetId: { $in: commentIds } },
    ],
  });
};
