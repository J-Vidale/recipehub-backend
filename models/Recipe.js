// models/Recipe.js
import mongoose from "mongoose";

const ingredientSchema = new mongoose.Schema({
  name: { type: String, required: true },
  amount: { type: String, required: true },
});

const recipeSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    title: {
      type: String,
      required: true,
    },
    category: {
      type: String,
    },
    instructions: {
      type: String,
    },
    ingredients: [ingredientSchema],
  },
  { timestamps: true }
);

export default mongoose.model("Recipe", recipeSchema);