import express from "express";
import { getPopularTags } from "../controllers/recipeController.js";

const router = express.Router();

router.get("/popular", getPopularTags);

export default router;
