import express from "express";
import {
  createRecipe,
  getAllRecipes,
  getMyRecipes,
  getSingleRecipe,
  updateRecipe,
  deleteRecipe,
  getRecipesByUser,
  getSavedRecipes,
  saveRecipe,
  unsaveRecipe,
} from "../controllers/recipeController.js";
import { addRecipeMedia, deleteRecipeMedia, loadOwnedRecipe } from "../controllers/mediaController.js";
import { uploadSingleMedia } from "../middleware/uploadMiddleware.js";
import { protect } from "../middleware/authMiddleware.js";

const router = express.Router();

router.get("/saved", protect, getSavedRecipes);
router.get("/user/:userId", getRecipesByUser);

router
  .route("/")
  .get(getAllRecipes)
  .post(protect, createRecipe);

router.route("/mine").get(protect, getMyRecipes);

router
  .route("/:id")
  .get(protect, getSingleRecipe)
  .put(protect, updateRecipe)
  .delete(protect, deleteRecipe);

router.post("/:id/media", protect, loadOwnedRecipe, uploadSingleMedia, addRecipeMedia);
router.delete("/:id/media/:mediaId", protect, loadOwnedRecipe, deleteRecipeMedia);

router.post("/save/:recipeId", protect, saveRecipe);
router.delete("/unsave/:recipeId", protect, unsaveRecipe);

export default router;
