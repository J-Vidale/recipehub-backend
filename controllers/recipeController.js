// controllers/recipeController.js
import Recipe from "../models/Recipe.js";
import User from "../models/User.js";
import mongoose from "mongoose";

const validateIngredients = (ingredients) => {
  if (!Array.isArray(ingredients)) {
    return { error: "Ingredients must be an array" };
  }
  for (const item of ingredients) {
    if (
      !item ||
      typeof item.name !== "string" ||
      !item.name.trim() ||
      typeof item.amount !== "string" ||
      !item.amount.trim()
    ) {
      return { error: "Each ingredient needs a name and an amount" };
    }
  }
  return {
    cleaned: ingredients.map((item) => ({
      name: item.name.trim(),
      amount: item.amount.trim(),
    })),
  };
};

// POST /api/recipes
export const createRecipe = async (req, res) => {
  const { title, instructions, category, ingredients } = req.body;

  if (typeof title !== "string" || !title.trim()) {
    return res.status(400).json({ message: "Title is required" });
  }

  let cleanIngredients = [];
  if (ingredients !== undefined) {
    const { error, cleaned } = validateIngredients(ingredients);
    if (error) {
      return res.status(400).json({ message: error });
    }
    cleanIngredients = cleaned;
  }

  const recipe = await Recipe.create({
    title: title.trim(),
    instructions,
    category,
    ingredients: cleanIngredients,
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
    const recipe = await Recipe.findById(req.params.id);
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

  if (req.body.ingredients !== undefined) {
    const { error, cleaned } = validateIngredients(req.body.ingredients);
    if (error) {
      return res.status(400).json({ message: error });
    }
    recipe.ingredients = cleaned;
  }

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
  if (!mongoose.Types.ObjectId.isValid(userId)) {
    return res.status(400).json({ message: "Invalid user ID" });
  }
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
    await User.updateOne(
      { _id: req.user._id },
      { $addToSet: { savedRecipes: req.params.recipeId } }
    );
    res.json({ message: "Recipe saved" });
  } catch (err) {
    res.status(500).json({ message: "Failed to save recipe" });
  }
};

// Unsave a recipe
export const unsaveRecipe = async (req, res) => {
  try {
    await User.updateOne(
      { _id: req.user._id },
      { $pull: { savedRecipes: req.params.recipeId } }
    );
    res.json({ message: "Recipe unsaved" });
  } catch (err) {
    res.status(500).json({ message: "Failed to unsave recipe" });
  }
};
