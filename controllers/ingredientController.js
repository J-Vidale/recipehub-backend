// controllers/ingredientController.js
import mongoose from "mongoose";
import Ingredient from "../models/Ingredient.js";
import Recipe from "../models/Recipe.js";

// POST /api/ingredients/:recipeId
export const addIngredient = async (req, res) => {
  const { name, quantity } = req.body;
  const { recipeId } = req.params;

  if (!mongoose.Types.ObjectId.isValid(recipeId)) {
    return res.status(400).json({ message: "Invalid recipe ID" });
  }

  const recipe = await Recipe.findById(recipeId);
  if (!recipe) {
    return res.status(404).json({ message: "Recipe not found" });
  }
  if (recipe.user.toString() !== req.user._id.toString()) {
    return res.status(403).json({ message: "Not authorized" });
  }

  const ingredient = await Ingredient.create({
    name,
    quantity,
    recipe: recipeId,
  });

  res.status(201).json(ingredient);
};

// PUT /api/ingredients/:id
export const updateIngredient = async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(400).json({ message: "Invalid ingredient ID" });
  }

  const ingredient = await Ingredient.findById(req.params.id).populate("recipe", "user");

  if (!ingredient) {
    return res.status(404).json({ message: "Ingredient not found" });
  }
  if (!ingredient.recipe || ingredient.recipe.user.toString() !== req.user._id.toString()) {
    return res.status(403).json({ message: "Not authorized" });
  }

  ingredient.name = req.body.name || ingredient.name;
  ingredient.quantity = req.body.quantity || ingredient.quantity;

  const updated = await ingredient.save();
  res.json(updated);
};

// DELETE /api/ingredients/:id
export const deleteIngredient = async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(400).json({ message: "Invalid ingredient ID" });
  }

  const ingredient = await Ingredient.findById(req.params.id).populate("recipe", "user");

  if (!ingredient) {
    return res.status(404).json({ message: "Ingredient not found" });
  }
  if (!ingredient.recipe || ingredient.recipe.user.toString() !== req.user._id.toString()) {
    return res.status(403).json({ message: "Not authorized" });
  }

  await ingredient.deleteOne();
  res.json({ message: "Ingredient deleted" });
};
