// controllers/recipeController.js
import Recipe from "../models/Recipe.js";
import Ingredient from "../models/Ingredient.js";
import User from "../models/User.js";
import Like from "../models/Like.js";
import Comment from "../models/Comment.js";
import CommentLike from "../models/CommentLike.js";
import mongoose from "mongoose";

// POST /api/recipes
export const createRecipe = async (req, res) => {
  const { title, instructions, category } = req.body;

  const recipe = await Recipe.create({
    title,
    instructions,
    category,
    user: req.user._id,
  });

  res.status(201).json(recipe);
};

// GET /api/recipes
export const getAllRecipes = async (req, res) => {
  const recipes = await Recipe.find().populate("user", "name");
  res.json(recipes);
};

// GET /api/recipes/mine
export const getMyRecipes = async (req, res) => {
  const recipes = await Recipe.find({ user: req.user._id });
  res.json(recipes);
};

// GET /api/recipes/:id
export const getSingleRecipe = async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(400).json({ message: "Invalid recipe ID" });
  }
  try {
    const recipe = await Recipe.findById(req.params.id).populate("ingredients");
    if (!recipe) {
      return res.status(404).json({ message: "Recipe not found" });
    }
    res.json(recipe);
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch recipe" });
  }
};

// PUT /api/recipes/:id
export const updateRecipe = async (req, res) => {
  const recipe = await Recipe.findById(req.params.id);

  if (!recipe) {
    return res.status(404).json({ message: "Recipe not found" });
  }

  if (recipe.user.toString() !== req.user._id.toString()) {
    return res.status(403).json({ message: "Not authorized" });
  }

  recipe.title = req.body.title || recipe.title;
  recipe.instructions = req.body.instructions || recipe.instructions;
  recipe.category = req.body.category || recipe.category;

  const updated = await recipe.save();
  res.json(updated);
};

// DELETE /api/recipes/:id
export const deleteRecipe = async (req, res) => {
  try {
    const recipe = await Recipe.findById(req.params.id);

    if (!recipe) {
      return res.status(404).json({ message: "Recipe not found" });
    }

    if (recipe.user.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: "Not authorized" });
    }

    const commentIds = await Comment.find({ recipe: recipe._id }).distinct("_id");
    await CommentLike.deleteMany({ comment: { $in: commentIds } });
    await Like.deleteMany({ recipe: recipe._id });
    await Comment.deleteMany({ recipe: recipe._id });
    await Ingredient.deleteMany({ recipe: recipe._id });
    await Recipe.deleteOne({ _id: recipe._id });

    res.json({ message: "Recipe deleted" });
  } catch (err) {
    res.status(500).json({
      message: "Failed to delete recipe",
      error: process.env.NODE_ENV === "development" ? err.message : undefined,
    });
  }
};

// GET /api/recipes/user/:userId
export const getRecipesByUser = async (req, res) => {
  const { userId } = req.params;
  const recipes = await Recipe.find({ user: userId });
  res.json(recipes);
};

// GET /api/recipes/saved
export const getSavedRecipes = async (req, res) => {
  try {
    // This assumes you have a "savedRecipes" field on the User model that is an array of Recipe IDs
    const user = await User.findById(req.user._id).populate("savedRecipes");
    res.json(user.savedRecipes || []);
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch saved recipes" });
  }
};

// Save a recipe
export const saveRecipe = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user.savedRecipes.includes(req.params.recipeId)) {
      user.savedRecipes.push(req.params.recipeId);
      await user.save();
    }
    res.json({ message: "Recipe saved" });
  } catch (err) {
    res.status(500).json({ message: "Failed to save recipe" });
  }
};

// Unsave a recipe
export const unsaveRecipe = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    user.savedRecipes = user.savedRecipes.filter(
      (id) => id.toString() !== req.params.recipeId
    );
    await user.save();
    res.json({ message: "Recipe unsaved" });
  } catch (err) {
    res.status(500).json({ message: "Failed to unsave recipe" });
  }
};
