import express from "express";
import { search } from "../controllers/searchController.js";
import { searchLimiter } from "../middleware/rateLimiters.js";

const router = express.Router();

router.get("/", searchLimiter, search);

export default router;
