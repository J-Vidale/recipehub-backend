// controllers/likeController.js
import mongoose from "mongoose";
import Recipe from "../models/Recipe.js";
import Like from "../models/Like.js";

// POST /api/recipes/:id/like
export const likeRecipe = async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(400).json({ message: "Invalid recipe ID" });
  }

  const recipe = await Recipe.findById(req.params.id);
  if (!recipe) {
    return res.status(404).json({ message: "Recipe not found" });
  }

  try {
    await Like.create({ user: req.user._id, recipe: recipe._id });
    recipe.likeCount += 1;
    await recipe.save();
  } catch (err) {
    if (err.code !== 11000) {
      throw err;
    }
    // Already liked - idempotent; recipe.likeCount already reflects it.
  }

  res.json({ likeCount: recipe.likeCount, likedByMe: true });
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

  const deleted = await Like.findOneAndDelete({ user: req.user._id, recipe: recipe._id });
  if (deleted) {
    recipe.likeCount = Math.max(0, recipe.likeCount - 1);
    await recipe.save();
  }

  res.json({ likeCount: recipe.likeCount, likedByMe: false });
};
