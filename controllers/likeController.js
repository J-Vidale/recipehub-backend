// controllers/likeController.js
import mongoose from "mongoose";
import Recipe from "../models/Recipe.js";
import Like from "../models/Like.js";
import { addLike, removeLike } from "../utils/likeToggle.js";
import { createNotification } from "../utils/notify.js";
import { isBlockedEitherWay } from "../utils/isBlocked.js";

// POST /api/recipes/:id/like
export const likeRecipe = async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(400).json({ message: "Invalid recipe ID" });
  }

  const recipe = await Recipe.findById(req.params.id);
  if (!recipe) {
    return res.status(404).json({ message: "Recipe not found" });
  }

  // Blocking already stops messaging, commenting and following. This was
  // left open, and it notifies the recipe's owner - so a blocked person
  // could put their name in someone's notifications as often as they
  // liked, which is the thing blocking is for.
  if (await isBlockedEitherWay(req.user._id, recipe.user)) {
    return res.status(403).json({ message: "You cannot like this recipe" });
  }

  const { created, ...result } = await addLike({
    LikeModel: Like,
    likeQuery: { user: req.user._id, recipe: recipe._id },
    CountModel: Recipe,
    countId: recipe._id,
  });

  if (created) {
    createNotification({
      recipient: recipe.user,
      actor: req.user._id,
      type: "like",
      recipe: recipe._id,
    });
  }

  res.json(result);
};

// DELETE /api/recipes/:id/like
export const unlikeRecipe = async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(400).json({ message: "Invalid recipe ID" });
  }

  const recipe = await Recipe.findById(req.params.id);
  if (!recipe) {
    return res.status(404).json({ message: "Recipe not found" });
  }

  const result = await removeLike({
    LikeModel: Like,
    likeQuery: { user: req.user._id, recipe: recipe._id },
    CountModel: Recipe,
    countId: recipe._id,
  });

  res.json(result);
};
