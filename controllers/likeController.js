// controllers/likeController.js
import mongoose from "mongoose";
import Recipe from "../models/Recipe.js";
import Like from "../models/Like.js";
import { addLike, removeLike } from "../utils/likeToggle.js";

// POST /api/recipes/:id/like
export const likeRecipe = async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(400).json({ message: "Invalid recipe ID" });
  }

  const recipe = await Recipe.findById(req.params.id);
  if (!recipe) {
    return res.status(404).json({ message: "Recipe not found" });
  }

  const result = await addLike({
    LikeModel: Like,
    likeQuery: { user: req.user._id, recipe: recipe._id },
    CountModel: Recipe,
    countId: recipe._id,
  });

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
