# Recipe Media Upload Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a recipe owner attach photos (carousel, up to 5) or a single short video to their recipe, stored in Cloudinary, with cleanup on deletion.

**Architecture:** Backend-proxied upload — frontend sends multipart file to a new sub-resource endpoint under `/api/recipes/:id/media`; `multer` (memory storage) parses it, the buffer is streamed to Cloudinary via `streamifier`, and the resulting URL/public ID is stored on the `Recipe` document. Follows the existing sub-resource pattern used for ingredients.

**Tech Stack:** Node.js, Express 5, Mongoose, Cloudinary Node SDK, multer, streamifier.

## Global Constraints

- Backend-proxied upload only this pass — no direct-to-Cloudinary signed uploads (spec §Approach).
- A recipe's `media` array holds either 1–5 items of `type: "image"`, or exactly 1 item of `type: "video"` — never mixed, never over the caps (spec §Data model changes).
- Allowed image MIME types: `image/jpeg`, `image/png`, `image/webp`, max 8MB each. Allowed video MIME types: `video/mp4`, `video/quicktime`, `video/webm`, max 50MB (spec §Validation rules).
- Uploads must use `multer` memory storage (buffer) — never write to local disk, since Render's filesystem is ephemeral (spec §Goals, §Validation rules).
- No automated test framework exists in this repo (no Jest/Mocha). Every task below is verified manually with exact commands and expected output, per spec §Testing.
- New env vars: `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` (spec §New configuration).

---

### Task 1: Cloudinary dependencies and config

**Files:**
- Modify: `package.json` (add `cloudinary`, `multer`, `streamifier`)
- Create: `config/cloudinary.js`
- Modify: `README.md:34-42` (env vars section)

**Interfaces:**
- Produces: `config/cloudinary.js` exports a default-configured Cloudinary `v2` instance (`import cloudinary from "../config/cloudinary.js"`), used by Task 4.

- [ ] **Step 1: Install dependencies**

Run: `cd /home/user/recipehub-backend && npm install cloudinary multer streamifier`
Expected: `package.json` and `package-lock.json` updated, no errors.

- [ ] **Step 2: Create the Cloudinary config file**

Create `config/cloudinary.js`:

```js
// config/cloudinary.js
import { v2 as cloudinary } from "cloudinary";

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

export default cloudinary;
```

- [ ] **Step 3: Add the new env vars to your local `.env`**

Add these three lines to `.env` (create the file from the README instructions if it doesn't exist yet; sign up for a free account at cloudinary.com to get real values):

```
CLOUDINARY_CLOUD_NAME=your_cloud_name
CLOUDINARY_API_KEY=your_api_key
CLOUDINARY_API_SECRET=your_api_secret
```

- [ ] **Step 4: Verify the config module loads without throwing**

Run:
```bash
node -e "import('./config/cloudinary.js').then(() => console.log('OK')).catch(e => { console.error(e); process.exit(1); })"
```
Expected output: `OK`

- [ ] **Step 5: Document the env vars in README**

In `README.md`, in the "Environment Variables" section (currently lines 34-42), add the three Cloudinary vars to the example block so it reads:

```
MONGO_URI=your_mongodb_connection_string
JWT_SECRET=your_jwt_secret
PORT=5000
CLOUDINARY_CLOUD_NAME=your_cloud_name
CLOUDINARY_API_KEY=your_api_key
CLOUDINARY_API_SECRET=your_api_secret
```

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json config/cloudinary.js README.md
git commit -m "Add Cloudinary config and dependencies"
```

---

### Task 2: Recipe model media field

**Files:**
- Modify: `models/Recipe.js:9-29`

**Interfaces:**
- Produces: `Recipe.media` — a Mongoose DocumentArray, each item shaped `{ _id, type: "image"|"video", url, publicId, order }`. Consumed by Tasks 4 and 5.

- [ ] **Step 1: Add the `media` field to the recipe schema**

In `models/Recipe.js`, add a `media` array to the `recipeSchema` fields (alongside `ingredients`):

```js
    media: [
      {
        type: {
          type: String,
          enum: ["image", "video"],
          required: true,
        },
        url: { type: String, required: true },
        publicId: { type: String, required: true },
        order: { type: Number, required: true },
      },
    ],
```

Full updated schema body:

```js
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
    media: [
      {
        type: {
          type: String,
          enum: ["image", "video"],
          required: true,
        },
        url: { type: String, required: true },
        publicId: { type: String, required: true },
        order: { type: Number, required: true },
      },
    ],
  },
  { timestamps: true }
);
```

- [ ] **Step 2: Verify the schema accepts valid media and rejects invalid media**

Run:
```bash
node -e "
import('./models/Recipe.js').then(({ default: Recipe }) => {
  const valid = new Recipe({
    user: new (require('mongoose').Types.ObjectId)(),
    title: 'Test',
    media: [{ type: 'image', url: 'https://x.test/a.jpg', publicId: 'abc', order: 0 }],
  });
  const validErr = valid.validateSync();
  console.log('valid doc errors (expect null):', validErr);

  const invalid = new Recipe({
    user: new (require('mongoose').Types.ObjectId)(),
    title: 'Test',
    media: [{ type: 'audio', url: 'https://x.test/a.mp3', publicId: 'abc', order: 0 }],
  });
  const invalidErr = invalid.validateSync();
  console.log('invalid doc errors (expect an enum validation error):', invalidErr?.errors ? Object.keys(invalidErr.errors) : invalidErr);
});
"
```
Expected: first log shows `null`/`undefined`; second log shows an array containing something like `media.0.type`.

- [ ] **Step 3: Commit**

```bash
git add models/Recipe.js
git commit -m "Add media field to Recipe model"
```

---

### Task 3: Upload middleware

**Files:**
- Create: `middleware/uploadMiddleware.js`

**Interfaces:**
- Produces: `uploadSingleMedia` (Express middleware, expects a `multipart/form-data` request with a single file under field name `file`; on success sets `req.file`, on failure responds `400` directly and does not call the next handler). `ALLOWED_MIME_TYPES` (object mapping MIME type string → `"image"`|`"video"`), `MAX_IMAGE_BYTES`, `MAX_VIDEO_BYTES` (numbers). All consumed by Task 4.

- [ ] **Step 1: Create the middleware file**

Create `middleware/uploadMiddleware.js`:

```js
// middleware/uploadMiddleware.js
import multer from "multer";

export const ALLOWED_MIME_TYPES = {
  "image/jpeg": "image",
  "image/png": "image",
  "image/webp": "image",
  "video/mp4": "video",
  "video/quicktime": "video",
  "video/webm": "video",
};

export const MAX_IMAGE_BYTES = 8 * 1024 * 1024; // 8MB
export const MAX_VIDEO_BYTES = 50 * 1024 * 1024; // 50MB

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_VIDEO_BYTES }, // hard ceiling; per-type limit enforced in the controller
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_MIME_TYPES[file.mimetype]) {
      return cb(new Error("Unsupported file type"));
    }
    cb(null, true);
  },
}).single("file");

// Wraps multer so its errors (file too large, wrong type) become a 400
// instead of falling through to the generic 500 error handler.
export const uploadSingleMedia = (req, res, next) => {
  upload(req, res, (err) => {
    if (err) {
      return res.status(400).json({ message: err.message });
    }
    next();
  });
};
```

- [ ] **Step 2: Verify the exports load and the size constants are correct**

Run:
```bash
node -e "
import('./middleware/uploadMiddleware.js').then((m) => {
  console.log('uploadSingleMedia is function:', typeof m.uploadSingleMedia === 'function');
  console.log('MAX_IMAGE_BYTES:', m.MAX_IMAGE_BYTES, '(expect 8388608)');
  console.log('MAX_VIDEO_BYTES:', m.MAX_VIDEO_BYTES, '(expect 52428800)');
  console.log('image/jpeg ->', m.ALLOWED_MIME_TYPES['image/jpeg'], '(expect image)');
  console.log('video/mp4 ->', m.ALLOWED_MIME_TYPES['video/mp4'], '(expect video)');
});
"
```
Expected: all five lines print the expected values shown in parentheses.

- [ ] **Step 3: Commit**

```bash
git add middleware/uploadMiddleware.js
git commit -m "Add multer upload middleware for recipe media"
```

---

### Task 4: Media controller and routes

**Files:**
- Create: `controllers/mediaController.js`
- Modify: `routes/recipeRoutes.js`

**Interfaces:**
- Consumes: `cloudinary` default export from `config/cloudinary.js` (Task 1), `Recipe.media` shape from `models/Recipe.js` (Task 2), `uploadSingleMedia`/`ALLOWED_MIME_TYPES`/`MAX_IMAGE_BYTES`/`MAX_VIDEO_BYTES` from `middleware/uploadMiddleware.js` (Task 3), `protect` from `middleware/authMiddleware.js`.
- Produces: `addRecipeMedia`, `deleteRecipeMedia` controller functions; routes `POST /api/recipes/:id/media` and `DELETE /api/recipes/:id/media/:mediaId`.

- [ ] **Step 1: Create the media controller**

Create `controllers/mediaController.js`:

```js
// controllers/mediaController.js
import mongoose from "mongoose";
import streamifier from "streamifier";
import Recipe from "../models/Recipe.js";
import cloudinary from "../config/cloudinary.js";
import {
  ALLOWED_MIME_TYPES,
  MAX_IMAGE_BYTES,
  MAX_VIDEO_BYTES,
} from "../middleware/uploadMiddleware.js";

const MAX_PHOTOS = 5;

const uploadBufferToCloudinary = (buffer, resourceType) => {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      { resource_type: resourceType, folder: "recipehub" },
      (error, result) => {
        if (error) return reject(error);
        resolve(result);
      }
    );
    streamifier.createReadStream(buffer).pipe(uploadStream);
  });
};

// POST /api/recipes/:id/media
export const addRecipeMedia = async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(400).json({ message: "Invalid recipe ID" });
  }

  const recipe = await Recipe.findById(req.params.id);
  if (!recipe) {
    return res.status(404).json({ message: "Recipe not found" });
  }
  if (recipe.user.toString() !== req.user._id.toString()) {
    return res.status(403).json({ message: "Not authorized" });
  }

  if (!req.file) {
    return res.status(400).json({ message: "No file uploaded" });
  }

  const mediaType = ALLOWED_MIME_TYPES[req.file.mimetype];
  if (!mediaType) {
    return res.status(400).json({ message: "Unsupported file type" });
  }
  if (mediaType === "image" && req.file.size > MAX_IMAGE_BYTES) {
    return res.status(400).json({ message: "Image exceeds 8MB limit" });
  }
  if (mediaType === "video" && req.file.size > MAX_VIDEO_BYTES) {
    return res.status(400).json({ message: "Video exceeds 50MB limit" });
  }

  const hasVideo = recipe.media.some((m) => m.type === "video");
  const photoCount = recipe.media.filter((m) => m.type === "image").length;

  if (mediaType === "video" && recipe.media.length > 0) {
    return res
      .status(400)
      .json({ message: "Cannot add a video to a recipe that already has media" });
  }
  if (mediaType === "image" && hasVideo) {
    return res
      .status(400)
      .json({ message: "Cannot add a photo to a recipe that already has a video" });
  }
  if (mediaType === "image" && photoCount >= MAX_PHOTOS) {
    return res
      .status(400)
      .json({ message: `Recipes can have at most ${MAX_PHOTOS} photos` });
  }

  try {
    const result = await uploadBufferToCloudinary(
      req.file.buffer,
      mediaType === "video" ? "video" : "image"
    );

    recipe.media.push({
      type: mediaType,
      url: result.secure_url,
      publicId: result.public_id,
      order: recipe.media.length,
    });

    const updated = await recipe.save();
    res.status(201).json(updated);
  } catch (err) {
    res.status(502).json({
      message: "Media upload failed",
      error: process.env.NODE_ENV === "development" ? err.message : undefined,
    });
  }
};

// DELETE /api/recipes/:id/media/:mediaId
export const deleteRecipeMedia = async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(400).json({ message: "Invalid recipe ID" });
  }

  const recipe = await Recipe.findById(req.params.id);
  if (!recipe) {
    return res.status(404).json({ message: "Recipe not found" });
  }
  if (recipe.user.toString() !== req.user._id.toString()) {
    return res.status(403).json({ message: "Not authorized" });
  }

  const mediaItem = recipe.media.id(req.params.mediaId);
  if (!mediaItem) {
    return res.status(404).json({ message: "Media not found" });
  }

  try {
    await cloudinary.uploader.destroy(mediaItem.publicId, {
      resource_type: mediaItem.type === "video" ? "video" : "image",
    });
  } catch (err) {
    return res.status(502).json({
      message: "Failed to delete media from Cloudinary",
      error: process.env.NODE_ENV === "development" ? err.message : undefined,
    });
  }

  mediaItem.deleteOne();
  await recipe.save();
  res.json(recipe);
};
```

- [ ] **Step 2: Wire the routes**

In `routes/recipeRoutes.js`, add the import and the two new routes:

```js
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
import { addRecipeMedia, deleteRecipeMedia } from "../controllers/mediaController.js";
import { uploadSingleMedia } from "../middleware/uploadMiddleware.js";
import { protect } from "../middleware/authMiddleware.js";
```

And after the existing `router.route("/:id")...` block, add:

```js
router.post("/:id/media", protect, uploadSingleMedia, addRecipeMedia);
router.delete("/:id/media/:mediaId", protect, deleteRecipeMedia);
```

- [ ] **Step 3: Verify by running the server and exercising both endpoints**

Run: `npm run dev` (leave running in one terminal), then in another terminal:

```bash
# 1. Register/login to get a token (skip if you already have one)
TOKEN=$(curl -s -X POST http://localhost:5000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"username":"mediatester","email":"mediatester@example.com","password":"password123"}' \
  | node -e "process.stdin.on('data', d => console.log(JSON.parse(d).token))")

# 2. Create a recipe
RECIPE_ID=$(curl -s -X POST http://localhost:5000/api/recipes \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"title":"Media Test Recipe"}' \
  | node -e "process.stdin.on('data', d => console.log(JSON.parse(d)._id))")

# 3. Upload a photo (use any small .jpg on disk, e.g. ~/Pictures/test.jpg)
curl -s -X POST http://localhost:5000/api/recipes/$RECIPE_ID/media \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@/path/to/test.jpg"
```

Expected: step 3 returns `201` with JSON containing a `media` array with one item, `type: "image"`, and a `url` pointing at `res.cloudinary.com`. Confirm the asset also appears in your Cloudinary Media Library dashboard.

Then verify the mutual-exclusivity rule:
```bash
curl -s -X POST http://localhost:5000/api/recipes/$RECIPE_ID/media \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@/path/to/test.mp4"
```
Expected: `400` with message `"Cannot add a video to a recipe that already has media"`.

Then verify delete:
```bash
# take the media _id from the earlier 201 response's media[0]._id
curl -s -X DELETE http://localhost:5000/api/recipes/$RECIPE_ID/media/<MEDIA_ID> \
  -H "Authorization: Bearer $TOKEN"
```
Expected: `200` with the recipe's `media` array now empty, and the asset gone from the Cloudinary Media Library.

- [ ] **Step 4: Commit**

```bash
git add controllers/mediaController.js routes/recipeRoutes.js
git commit -m "Add recipe media upload and delete endpoints"
```

---

### Task 5: Cascade-delete media on recipe deletion

**Files:**
- Modify: `controllers/recipeController.js:70-89` (`deleteRecipe`)

**Interfaces:**
- Consumes: `cloudinary` from `config/cloudinary.js` (Task 1), `recipe.media` shape from `models/Recipe.js` (Task 2).

- [ ] **Step 1: Update `deleteRecipe` to clean up Cloudinary assets**

In `controllers/recipeController.js`, add the import at the top:

```js
import cloudinary from "../config/cloudinary.js";
```

Replace the `deleteRecipe` function body with:

```js
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

    await Promise.all(
      recipe.media.map((item) =>
        cloudinary.uploader.destroy(item.publicId, {
          resource_type: item.type === "video" ? "video" : "image",
        })
      )
    );

    await Ingredient.deleteMany({ recipe: recipe._id });
    await Recipe.deleteOne({ _id: recipe._id });

    res.json({ message: "Recipe deleted" });
  } catch (err) {
    res.status(500).json({ message: "Failed to delete recipe", error: err.message });
  }
};
```

- [ ] **Step 2: Verify manually**

With the server running, repeat steps 1-2 from Task 4's verification to create a recipe and upload one photo to it, note the `RECIPE_ID`, then:

```bash
curl -s -X DELETE http://localhost:5000/api/recipes/$RECIPE_ID \
  -H "Authorization: Bearer $TOKEN"
```

Expected: `200` with `{"message":"Recipe deleted"}`, and the photo you uploaded is gone from the Cloudinary Media Library (refresh the dashboard to confirm).

- [ ] **Step 3: Commit**

```bash
git add controllers/recipeController.js
git commit -m "Delete Cloudinary media when a recipe is deleted"
```

---

## Done

At this point: recipes support up to 5 photos or 1 video, stored in Cloudinary; deleting a recipe or an individual media item cleans up the corresponding Cloudinary asset; all new env vars are documented in the README.
