# Recipe Engagement (Likes + Comments) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a logged-in user like/unlike a recipe and comment on it (with one level of replies), with `Recipe.likeCount`/`commentCount` kept in sync for a future feed to sort on.

**Architecture:** `Like` and `Comment` are new top-level Mongoose collections referencing `Recipe` by ID (same pattern as the existing `Ingredient` collection), not embedded arrays — this avoids unbounded document growth as engagement scales. Controllers follow the existing sub-resource route pattern already used for ingredients and the save/unsave pair.

**Tech Stack:** Node.js, Express 5, Mongoose.

## Global Constraints

- `Like` has a unique compound index on `(user, recipe)` — one like per user per recipe, enforced at the DB level (spec §Data model).
- A comment's `parentComment` may only point at a top-level comment (one whose own `parentComment` is `null`) — replying to a reply is rejected with `400` (spec §New endpoints).
- Comment `text` is required, trimmed, max 1000 characters (spec §Data model, §Error handling).
- Like/unlike are idempotent — liking an already-liked recipe or unliking a not-liked recipe is not an error (spec §Error handling).
- A comment can be deleted by its author OR the recipe's owner; deleting a top-level comment cascade-deletes its replies (spec §New endpoints).
- No pagination on `GET .../comments` this pass — return the full flat list (spec §Non-goals).
- No automated test framework exists in this repo. Every task below is verified manually with exact commands and expected output.

---

### Task 1: Like model and Recipe.likeCount

**Files:**
- Create: `models/Like.js`
- Modify: `models/Recipe.js`

**Interfaces:**
- Produces: `Like` model — documents shaped `{ _id, user, recipe, createdAt, updatedAt }`, unique on `(user, recipe)`. `Recipe.likeCount` (Number, default 0). Both consumed by Task 3 and Task 5.

- [ ] **Step 1: Create the Like model**

Create `models/Like.js`:

```js
// models/Like.js
import mongoose from "mongoose";

const likeSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    recipe: { type: mongoose.Schema.Types.ObjectId, ref: "Recipe", required: true },
  },
  { timestamps: true }
);

likeSchema.index({ user: 1, recipe: 1 }, { unique: true });

export default mongoose.model("Like", likeSchema);
```

- [ ] **Step 2: Add `likeCount` to the Recipe schema**

In `models/Recipe.js`, add `likeCount` alongside `ingredients`:

```js
    ingredients: [ingredientSchema],
    likeCount: { type: Number, default: 0 },
```

- [ ] **Step 3: Verify the Like model's index and validation**

Run:
```bash
node -e "
import('./models/Like.js').then(({ default: Like }) => {
  const mongoose = require('mongoose');
  console.log('indexes:', JSON.stringify(Like.schema.indexes()));
  const doc = new Like({ user: new mongoose.Types.ObjectId(), recipe: new mongoose.Types.ObjectId() });
  console.log('valid doc errors (expect undefined):', doc.validateSync());
  const missing = new Like({});
  console.log('missing fields errors (expect user, recipe):', missing.validateSync()?.errors ? Object.keys(missing.validateSync().errors) : null);
});
"
```
Expected: the `indexes` line shows an entry for `{"user":1,"recipe":1}` with `unique:true`; valid doc errors is `undefined`; missing fields lists `['user', 'recipe']`.

- [ ] **Step 4: Verify `likeCount` defaults to 0**

Run:
```bash
node -e "
import('./models/Recipe.js').then(({ default: Recipe }) => {
  const mongoose = require('mongoose');
  const r = new Recipe({ user: new mongoose.Types.ObjectId(), title: 'Test' });
  console.log('likeCount:', r.likeCount, '(expect 0)');
});
"
```
Expected: `likeCount: 0 (expect 0)`

- [ ] **Step 5: Commit**

```bash
git add models/Like.js models/Recipe.js
git commit -m "Add Like model and Recipe.likeCount"
```

---

### Task 2: Comment model and Recipe.commentCount

**Files:**
- Create: `models/Comment.js`
- Modify: `models/Recipe.js`

**Interfaces:**
- Produces: `Comment` model — documents shaped `{ _id, recipe, user, parentComment, text, createdAt, updatedAt }`. `Recipe.commentCount` (Number, default 0). Both consumed by Task 4 and Task 5.

- [ ] **Step 1: Create the Comment model**

Create `models/Comment.js`:

```js
// models/Comment.js
import mongoose from "mongoose";

const commentSchema = new mongoose.Schema(
  {
    recipe: { type: mongoose.Schema.Types.ObjectId, ref: "Recipe", required: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    parentComment: { type: mongoose.Schema.Types.ObjectId, ref: "Comment", default: null },
    text: { type: String, required: true, trim: true, maxlength: 1000 },
  },
  { timestamps: true }
);

export default mongoose.model("Comment", commentSchema);
```

- [ ] **Step 2: Add `commentCount` to the Recipe schema**

In `models/Recipe.js`, add it next to `likeCount`:

```js
    likeCount: { type: Number, default: 0 },
    commentCount: { type: Number, default: 0 },
```

- [ ] **Step 3: Verify Comment validation (required fields, max length)**

Run:
```bash
node -e "
import('./models/Comment.js').then(({ default: Comment }) => {
  const mongoose = require('mongoose');
  const valid = new Comment({ recipe: new mongoose.Types.ObjectId(), user: new mongoose.Types.ObjectId(), text: 'Great recipe!' });
  console.log('valid doc errors (expect undefined):', valid.validateSync());

  const tooLong = new Comment({ recipe: new mongoose.Types.ObjectId(), user: new mongoose.Types.ObjectId(), text: 'a'.repeat(1001) });
  console.log('too-long text errors (expect text):', tooLong.validateSync()?.errors ? Object.keys(tooLong.validateSync().errors) : null);

  const missing = new Comment({});
  console.log('missing fields errors (expect recipe, user, text):', missing.validateSync()?.errors ? Object.keys(missing.validateSync().errors) : null);
});
"
```
Expected: valid doc errors is `undefined`; too-long text lists `['text']`; missing fields lists `['recipe', 'user', 'text']`.

- [ ] **Step 4: Verify `commentCount` defaults to 0**

Run:
```bash
node -e "
import('./models/Recipe.js').then(({ default: Recipe }) => {
  const mongoose = require('mongoose');
  const r = new Recipe({ user: new mongoose.Types.ObjectId(), title: 'Test' });
  console.log('commentCount:', r.commentCount, '(expect 0)');
});
"
```
Expected: `commentCount: 0 (expect 0)`

- [ ] **Step 5: Commit**

```bash
git add models/Comment.js models/Recipe.js
git commit -m "Add Comment model and Recipe.commentCount"
```

---

### Task 3: Like/unlike controller and routes

**Files:**
- Create: `controllers/likeController.js`
- Modify: `routes/recipeRoutes.js`

**Interfaces:**
- Consumes: `Like` and `Recipe.likeCount` from Task 1, `protect` from `middleware/authMiddleware.js`.
- Produces: `likeRecipe`, `unlikeRecipe` controller functions; routes `POST /api/recipes/:id/like` and `DELETE /api/recipes/:id/like`, both returning `{ likeCount, likedByMe }`.

- [ ] **Step 1: Create the like controller**

Create `controllers/likeController.js`:

```js
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
```

- [ ] **Step 2: Wire the routes**

In `routes/recipeRoutes.js`, add the import:

```js
import { likeRecipe, unlikeRecipe } from "../controllers/likeController.js";
```

And after the `router.route("/:id")...` block, add:

```js
router.post("/:id/like", protect, likeRecipe);
router.delete("/:id/like", protect, unlikeRecipe);
```

- [ ] **Step 3: Verify by running the server and exercising both endpoints**

Requires a real `MONGO_URI` and `JWT_SECRET` in `.env` (no third-party media credentials needed for this sub-project). Run `npm run dev`, then in another terminal:

```bash
TOKEN=$(curl -s -X POST http://localhost:5000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"username":"liketester","email":"liketester@example.com","password":"password123"}' \
  | node -e "process.stdin.on('data', d => console.log(JSON.parse(d).token))")

RECIPE_ID=$(curl -s -X POST http://localhost:5000/api/recipes \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"title":"Like Test Recipe"}' \
  | node -e "process.stdin.on('data', d => console.log(JSON.parse(d)._id))")

# Like it twice - should stay at likeCount 1 (idempotent)
curl -s -X POST http://localhost:5000/api/recipes/$RECIPE_ID/like -H "Authorization: Bearer $TOKEN"
curl -s -X POST http://localhost:5000/api/recipes/$RECIPE_ID/like -H "Authorization: Bearer $TOKEN"

# Unlike it twice - should stay at likeCount 0 (idempotent)
curl -s -X DELETE http://localhost:5000/api/recipes/$RECIPE_ID/like -H "Authorization: Bearer $TOKEN"
curl -s -X DELETE http://localhost:5000/api/recipes/$RECIPE_ID/like -H "Authorization: Bearer $TOKEN"
```
Expected: both `POST` calls return `{"likeCount":1,"likedByMe":true}`; both `DELETE` calls return `{"likeCount":0,"likedByMe":false}`.

- [ ] **Step 4: Commit**

```bash
git add controllers/likeController.js routes/recipeRoutes.js
git commit -m "Add recipe like/unlike endpoints"
```

---

### Task 4: Comment controller and routes

**Files:**
- Create: `controllers/commentController.js`
- Modify: `routes/recipeRoutes.js`

**Interfaces:**
- Consumes: `Comment` and `Recipe.commentCount` from Task 2, `protect` from `middleware/authMiddleware.js`.
- Produces: `addComment`, `getComments`, `deleteComment` controller functions; routes `POST /api/recipes/:id/comments`, `GET /api/recipes/:id/comments`, `DELETE /api/recipes/:id/comments/:commentId`.

- [ ] **Step 1: Create the comment controller**

Create `controllers/commentController.js`:

```js
// controllers/commentController.js
import mongoose from "mongoose";
import Recipe from "../models/Recipe.js";
import Comment from "../models/Comment.js";

const MAX_TEXT_LENGTH = 1000;

// POST /api/recipes/:id/comments
export const addComment = async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(400).json({ message: "Invalid recipe ID" });
  }

  const recipe = await Recipe.findById(req.params.id);
  if (!recipe) {
    return res.status(404).json({ message: "Recipe not found" });
  }

  const { text, parentComment } = req.body;
  if (!text || !text.trim()) {
    return res.status(400).json({ message: "Comment text is required" });
  }
  if (text.length > MAX_TEXT_LENGTH) {
    return res
      .status(400)
      .json({ message: `Comment cannot exceed ${MAX_TEXT_LENGTH} characters` });
  }

  let parentId = null;
  if (parentComment) {
    if (!mongoose.Types.ObjectId.isValid(parentComment)) {
      return res.status(400).json({ message: "Invalid parent comment ID" });
    }
    const parent = await Comment.findById(parentComment);
    if (!parent || parent.recipe.toString() !== recipe._id.toString()) {
      return res.status(404).json({ message: "Parent comment not found" });
    }
    if (parent.parentComment) {
      return res.status(400).json({
        message: "Cannot reply to a reply; reply to the top-level comment instead",
      });
    }
    parentId = parent._id;
  }

  const comment = await Comment.create({
    recipe: recipe._id,
    user: req.user._id,
    parentComment: parentId,
    text: text.trim(),
  });

  recipe.commentCount += 1;
  await recipe.save();

  const populated = await comment.populate("user", "username");
  res.status(201).json(populated);
};

// GET /api/recipes/:id/comments
export const getComments = async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(400).json({ message: "Invalid recipe ID" });
  }

  const recipe = await Recipe.findById(req.params.id);
  if (!recipe) {
    return res.status(404).json({ message: "Recipe not found" });
  }

  const comments = await Comment.find({ recipe: recipe._id })
    .sort({ createdAt: 1 })
    .populate("user", "username");

  res.json(comments);
};

// DELETE /api/recipes/:id/comments/:commentId
export const deleteComment = async (req, res) => {
  if (
    !mongoose.Types.ObjectId.isValid(req.params.id) ||
    !mongoose.Types.ObjectId.isValid(req.params.commentId)
  ) {
    return res.status(400).json({ message: "Invalid ID" });
  }

  const recipe = await Recipe.findById(req.params.id);
  if (!recipe) {
    return res.status(404).json({ message: "Recipe not found" });
  }

  const comment = await Comment.findById(req.params.commentId);
  if (!comment || comment.recipe.toString() !== recipe._id.toString()) {
    return res.status(404).json({ message: "Comment not found" });
  }

  const isAuthor = comment.user.toString() === req.user._id.toString();
  const isRecipeOwner = recipe.user.toString() === req.user._id.toString();
  if (!isAuthor && !isRecipeOwner) {
    return res.status(403).json({ message: "Not authorized" });
  }

  const replies = await Comment.find({ parentComment: comment._id });
  const deletedCount = 1 + replies.length;

  await Comment.deleteMany({
    _id: { $in: [comment._id, ...replies.map((r) => r._id)] },
  });

  recipe.commentCount = Math.max(0, recipe.commentCount - deletedCount);
  await recipe.save();

  res.json({ message: "Comment deleted" });
};
```

- [ ] **Step 2: Wire the routes**

In `routes/recipeRoutes.js`, add the import:

```js
import { addComment, getComments, deleteComment } from "../controllers/commentController.js";
```

And after the like routes added in Task 3, add:

```js
router.post("/:id/comments", protect, addComment);
router.get("/:id/comments", getComments);
router.delete("/:id/comments/:commentId", protect, deleteComment);
```

- [ ] **Step 3: Verify by running the server and exercising all three endpoints**

With the server running (reuse `$TOKEN` and `$RECIPE_ID` from Task 3, or recreate them):

```bash
# Add a top-level comment
TOP_ID=$(curl -s -X POST http://localhost:5000/api/recipes/$RECIPE_ID/comments \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"text":"Looks delicious!"}' \
  | node -e "process.stdin.on('data', d => console.log(JSON.parse(d)._id))")

# Reply to it
curl -s -X POST http://localhost:5000/api/recipes/$RECIPE_ID/comments \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d "{\"text\":\"Thanks!\",\"parentComment\":\"$TOP_ID\"}"

# Try to reply to the reply - expect 400
REPLY_ID=$(curl -s -X GET http://localhost:5000/api/recipes/$RECIPE_ID/comments \
  | node -e "process.stdin.on('data', d => console.log(JSON.parse(d)[1]._id))")
curl -s -X POST http://localhost:5000/api/recipes/$RECIPE_ID/comments \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d "{\"text\":\"Nested reply\",\"parentComment\":\"$REPLY_ID\"}"

# List comments - expect 2 (the top-level + its reply)
curl -s http://localhost:5000/api/recipes/$RECIPE_ID/comments

# Delete the top-level comment - expect its reply to go with it
curl -s -X DELETE http://localhost:5000/api/recipes/$RECIPE_ID/comments/$TOP_ID \
  -H "Authorization: Bearer $TOKEN"

# List again - expect an empty array
curl -s http://localhost:5000/api/recipes/$RECIPE_ID/comments
```

Expected: the reply-to-reply attempt returns `400` with the "Cannot reply to a reply" message; the first list call returns an array of 2 comments; the delete returns `{"message":"Comment deleted"}`; the final list call returns `[]`.

- [ ] **Step 4: Commit**

```bash
git add controllers/commentController.js routes/recipeRoutes.js
git commit -m "Add recipe comment endpoints with one-level replies"
```

---

### Task 5: Cascade-delete likes and comments on recipe deletion

**Files:**
- Modify: `controllers/recipeController.js`

**Interfaces:**
- Consumes: `Like` from Task 1, `Comment` from Task 2.

- [ ] **Step 1: Update `deleteRecipe` to clean up Like and Comment docs**

In `controllers/recipeController.js`, add the imports at the top:

```js
import Like from "../models/Like.js";
import Comment from "../models/Comment.js";
```

In `deleteRecipe`, add the cleanup calls before the existing `Ingredient.deleteMany` line:

```js
    await Like.deleteMany({ recipe: recipe._id });
    await Comment.deleteMany({ recipe: recipe._id });
    await Ingredient.deleteMany({ recipe: recipe._id });
    await Recipe.deleteOne({ _id: recipe._id });
```

- [ ] **Step 2: Verify manually**

With the server running, create a fresh recipe, like it, and comment on it, then delete the recipe and confirm no orphaned data:

```bash
RECIPE_ID=$(curl -s -X POST http://localhost:5000/api/recipes \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"title":"Cascade Delete Test"}' \
  | node -e "process.stdin.on('data', d => console.log(JSON.parse(d)._id))")

curl -s -X POST http://localhost:5000/api/recipes/$RECIPE_ID/like -H "Authorization: Bearer $TOKEN"
curl -s -X POST http://localhost:5000/api/recipes/$RECIPE_ID/comments \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"text":"About to delete this recipe"}'

curl -s -X DELETE http://localhost:5000/api/recipes/$RECIPE_ID -H "Authorization: Bearer $TOKEN"
```
Expected: the final `DELETE` returns `{"message":"Recipe deleted"}`. To confirm no orphaned `Like`/`Comment` docs remain, check MongoDB directly (e.g. via `mongosh` or Atlas UI): `db.likes.find({recipe: ObjectId("<RECIPE_ID>")})` and `db.comments.find({recipe: ObjectId("<RECIPE_ID>")})` should both return zero documents.

- [ ] **Step 3: Commit**

```bash
git add controllers/recipeController.js
git commit -m "Cascade-delete likes and comments when a recipe is deleted"
```

---

## Addendum: comment likes and pinning

Added per explicit request to match Instagram/TikTok more fully: liking
individual comments, and the recipe owner pinning one top-level comment
(TikTok's single-pin model). See the spec's "Addendum" section for the
full rationale. Additional constraints for these tasks:

- `CommentLike` has a unique compound index on `(user, comment)`, mirroring `Like`.
- Only a top-level comment (`parentComment === null`) can be pinned; pinning is recipe-owner only.
- `Recipe.pinnedComment` holds at most one comment ID at a time — pinning a new one overwrites it.
- `GET .../comments` moves the pinned comment to the front via a stable sort; all other ordering is unchanged.

---

### Task 6: CommentLike model and Comment.likeCount

**Files:**
- Create: `models/CommentLike.js`
- Modify: `models/Comment.js`

**Interfaces:**
- Produces: `CommentLike` model — `{ _id, user, comment, createdAt, updatedAt }`, unique on `(user, comment)`. `Comment.likeCount` (Number, default 0). Both consumed by Task 7 and Task 9.

- [ ] **Step 1: Create the CommentLike model**

Create `models/CommentLike.js`:

```js
// models/CommentLike.js
import mongoose from "mongoose";

const commentLikeSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    comment: { type: mongoose.Schema.Types.ObjectId, ref: "Comment", required: true },
  },
  { timestamps: true }
);

commentLikeSchema.index({ user: 1, comment: 1 }, { unique: true });

export default mongoose.model("CommentLike", commentLikeSchema);
```

- [ ] **Step 2: Add `likeCount` to the Comment schema**

In `models/Comment.js`, add `likeCount` alongside `text`:

```js
    text: { type: String, required: true, trim: true, maxlength: 1000 },
    likeCount: { type: Number, default: 0 },
```

- [ ] **Step 3: Verify the CommentLike model's index and validation**

Run:
```bash
node -e "
import('./models/CommentLike.js').then(({ default: CommentLike }) => {
  const mongoose = require('mongoose');
  console.log('indexes:', JSON.stringify(CommentLike.schema.indexes()));
  const doc = new CommentLike({ user: new mongoose.Types.ObjectId(), comment: new mongoose.Types.ObjectId() });
  console.log('valid doc errors (expect undefined):', doc.validateSync());
  const missing = new CommentLike({});
  const missingErr = missing.validateSync();
  console.log('missing fields errors (expect user, comment):', missingErr?.errors ? Object.keys(missingErr.errors) : null);
});
"
```
Expected: `indexes` shows an entry for `{"user":1,"comment":1}` with `unique:true`; valid doc errors is `undefined`; missing fields lists `['user', 'comment']` (order may vary).

- [ ] **Step 4: Verify `likeCount` defaults to 0 on Comment**

Run:
```bash
node -e "
import('./models/Comment.js').then(({ default: Comment }) => {
  const mongoose = require('mongoose');
  const c = new Comment({ recipe: new mongoose.Types.ObjectId(), user: new mongoose.Types.ObjectId(), text: 'Test' });
  console.log('likeCount:', c.likeCount, '(expect 0)');
});
"
```
Expected: `likeCount: 0 (expect 0)`

- [ ] **Step 5: Commit**

```bash
git add models/CommentLike.js models/Comment.js
git commit -m "Add CommentLike model and Comment.likeCount"
```

---

### Task 7: Comment like/unlike controller and routes

**Files:**
- Create: `controllers/commentLikeController.js`
- Create: `routes/commentRoutes.js`
- Modify: `server.js`

**Interfaces:**
- Consumes: `CommentLike` and `Comment.likeCount` from Task 6, `protect` from `middleware/authMiddleware.js`.
- Produces: `likeComment`, `unlikeComment` controller functions; routes `POST /api/comments/:commentId/like` and `DELETE /api/comments/:commentId/like`, both returning `{ likeCount, likedByMe }`.

- [ ] **Step 1: Create the comment-like controller**

Create `controllers/commentLikeController.js`:

```js
// controllers/commentLikeController.js
import mongoose from "mongoose";
import Comment from "../models/Comment.js";
import CommentLike from "../models/CommentLike.js";

// POST /api/comments/:commentId/like
export const likeComment = async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.commentId)) {
    return res.status(400).json({ message: "Invalid comment ID" });
  }

  const comment = await Comment.findById(req.params.commentId);
  if (!comment) {
    return res.status(404).json({ message: "Comment not found" });
  }

  try {
    await CommentLike.create({ user: req.user._id, comment: comment._id });
    comment.likeCount += 1;
    await comment.save();
  } catch (err) {
    if (err.code !== 11000) {
      throw err;
    }
    // Already liked - idempotent; comment.likeCount already reflects it.
  }

  res.json({ likeCount: comment.likeCount, likedByMe: true });
};

// DELETE /api/comments/:commentId/like
export const unlikeComment = async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.commentId)) {
    return res.status(400).json({ message: "Invalid comment ID" });
  }

  const comment = await Comment.findById(req.params.commentId);
  if (!comment) {
    return res.status(404).json({ message: "Comment not found" });
  }

  const deleted = await CommentLike.findOneAndDelete({ user: req.user._id, comment: comment._id });
  if (deleted) {
    comment.likeCount = Math.max(0, comment.likeCount - 1);
    await comment.save();
  }

  res.json({ likeCount: comment.likeCount, likedByMe: false });
};
```

- [ ] **Step 2: Create the comment routes file**

Create `routes/commentRoutes.js`:

```js
import express from "express";
import { likeComment, unlikeComment } from "../controllers/commentLikeController.js";
import { protect } from "../middleware/authMiddleware.js";

const router = express.Router();

router.post("/:commentId/like", protect, likeComment);
router.delete("/:commentId/like", protect, unlikeComment);

export default router;
```

- [ ] **Step 3: Mount the new routes in server.js**

In `server.js`, add the import alongside the other route imports:

```js
import commentRoutes from "./routes/commentRoutes.js";
```

And add the mount alongside the other `app.use("/api/...")` lines:

```js
app.use("/api/comments", commentRoutes);
```

- [ ] **Step 4: Verify routes load and register correctly**

Run:
```bash
node -e "
import('./routes/commentRoutes.js').then((m) => {
  const router = m.default;
  const paths = router.stack
    .filter(l => l.route)
    .map(l => Object.keys(l.route.methods).join(',').toUpperCase() + ' ' + l.route.path);
  console.log(paths.join('\n'));
}).catch(e => { console.error('FAILED:', e); process.exit(1); });
"
```
Expected:
```
POST /:commentId/like
DELETE /:commentId/like
```

Then confirm the whole app still boots cleanly with `npm run dev` (or a short-lived `node server.js` with dummy env vars) — no import errors.

- [ ] **Step 5: Commit**

```bash
git add controllers/commentLikeController.js routes/commentRoutes.js server.js
git commit -m "Add comment like/unlike endpoints"
```

---

### Task 8: Comment pinning

**Files:**
- Modify: `models/Recipe.js`
- Modify: `controllers/commentController.js`
- Modify: `routes/recipeRoutes.js`

**Interfaces:**
- Consumes: `Comment` model, `Recipe` model, `protect` middleware.
- Produces: `pinComment`, `unpinComment` controller functions added to `controllers/commentController.js`; routes `POST /api/recipes/:id/comments/:commentId/pin` and `DELETE /api/recipes/:id/pin`. Modifies existing `getComments` (pinned-first ordering) and `deleteComment` (clears the pin if the deleted comment was pinned).

- [ ] **Step 1: Add `pinnedComment` to the Recipe schema**

In `models/Recipe.js`, add it alongside `commentCount`:

```js
    commentCount: { type: Number, default: 0 },
    pinnedComment: { type: mongoose.Schema.Types.ObjectId, ref: "Comment", default: null },
```

- [ ] **Step 2: Add `pinComment` and `unpinComment` to the comment controller**

In `controllers/commentController.js`, add these two exports (after `addComment`, before `getComments` is fine):

```js
// POST /api/recipes/:id/comments/:commentId/pin
export const pinComment = async (req, res) => {
  if (
    !mongoose.Types.ObjectId.isValid(req.params.id) ||
    !mongoose.Types.ObjectId.isValid(req.params.commentId)
  ) {
    return res.status(400).json({ message: "Invalid ID" });
  }

  const recipe = await Recipe.findById(req.params.id);
  if (!recipe) {
    return res.status(404).json({ message: "Recipe not found" });
  }

  if (recipe.user.toString() !== req.user._id.toString()) {
    return res.status(403).json({ message: "Not authorized" });
  }

  const comment = await Comment.findById(req.params.commentId);
  if (!comment || comment.recipe.toString() !== recipe._id.toString()) {
    return res.status(404).json({ message: "Comment not found" });
  }

  if (comment.parentComment) {
    return res.status(400).json({ message: "Cannot pin a reply" });
  }

  recipe.pinnedComment = comment._id;
  await recipe.save();

  res.json({ pinnedComment: recipe.pinnedComment });
};

// DELETE /api/recipes/:id/pin
export const unpinComment = async (req, res) => {
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

  recipe.pinnedComment = null;
  await recipe.save();

  res.json({ pinnedComment: null });
};
```

- [ ] **Step 3: Update `getComments` to sort the pinned comment first**

Replace the existing `getComments` function body in `controllers/commentController.js`:

```js
// GET /api/recipes/:id/comments
export const getComments = async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(400).json({ message: "Invalid recipe ID" });
  }

  const recipe = await Recipe.findById(req.params.id);
  if (!recipe) {
    return res.status(404).json({ message: "Recipe not found" });
  }

  const comments = await Comment.find({ recipe: recipe._id })
    .sort({ createdAt: 1 })
    .populate("user", "username");

  if (recipe.pinnedComment) {
    const pinnedId = recipe.pinnedComment.toString();
    comments.sort((a, b) => {
      const aPinned = a._id.toString() === pinnedId ? 0 : 1;
      const bPinned = b._id.toString() === pinnedId ? 0 : 1;
      return aPinned - bPinned;
    });
  }

  res.json(comments);
};
```

- [ ] **Step 4: Update `deleteComment` to clear the pin if needed**

Replace the existing `deleteComment` function body in `controllers/commentController.js`:

```js
// DELETE /api/recipes/:id/comments/:commentId
export const deleteComment = async (req, res) => {
  if (
    !mongoose.Types.ObjectId.isValid(req.params.id) ||
    !mongoose.Types.ObjectId.isValid(req.params.commentId)
  ) {
    return res.status(400).json({ message: "Invalid ID" });
  }

  const recipe = await Recipe.findById(req.params.id);
  if (!recipe) {
    return res.status(404).json({ message: "Recipe not found" });
  }

  const comment = await Comment.findById(req.params.commentId);
  if (!comment || comment.recipe.toString() !== recipe._id.toString()) {
    return res.status(404).json({ message: "Comment not found" });
  }

  const isAuthor = comment.user.toString() === req.user._id.toString();
  const isRecipeOwner = recipe.user.toString() === req.user._id.toString();
  if (!isAuthor && !isRecipeOwner) {
    return res.status(403).json({ message: "Not authorized" });
  }

  const replies = await Comment.find({ parentComment: comment._id });
  const deletedCount = 1 + replies.length;

  await Comment.deleteMany({
    _id: { $in: [comment._id, ...replies.map((r) => r._id)] },
  });

  recipe.commentCount = Math.max(0, recipe.commentCount - deletedCount);

  if (recipe.pinnedComment && recipe.pinnedComment.toString() === comment._id.toString()) {
    recipe.pinnedComment = null;
  }

  await recipe.save();

  res.json({ message: "Comment deleted" });
};
```

- [ ] **Step 5: Wire the pin/unpin routes**

In `routes/recipeRoutes.js`, extend the existing comment-controller import:

```js
import {
  addComment,
  getComments,
  deleteComment,
  pinComment,
  unpinComment,
} from "../controllers/commentController.js";
```

And after the existing comment routes, add:

```js
router.post("/:id/comments/:commentId/pin", protect, pinComment);
router.delete("/:id/pin", protect, unpinComment);
```

- [ ] **Step 6: Verify routes load correctly**

Run:
```bash
node -e "
import('./routes/recipeRoutes.js').then((m) => {
  const router = m.default;
  const paths = router.stack
    .filter(l => l.route)
    .map(l => Object.keys(l.route.methods).join(',').toUpperCase() + ' ' + l.route.path);
  console.log(paths.join('\n'));
}).catch(e => { console.error('FAILED:', e); process.exit(1); });
"
```
Expected output includes, among the routes from earlier tasks:
```
POST /:id/comments/:commentId/pin
DELETE /:id/pin
```

Then confirm the whole app still boots cleanly (short-lived `node server.js` with dummy env vars) — no import errors.

- [ ] **Step 7: Commit**

```bash
git add models/Recipe.js controllers/commentController.js routes/recipeRoutes.js
git commit -m "Add comment pinning (one pinned comment per recipe, owner-only)"
```

---

### Task 9: Cascade-delete CommentLike docs on recipe deletion

**Files:**
- Modify: `controllers/recipeController.js`

**Interfaces:**
- Consumes: `CommentLike` from Task 6, `Comment` from the base engagement plan.

- [ ] **Step 1: Update `deleteRecipe` to clean up CommentLike docs**

In `controllers/recipeController.js`, add the import at the top:

```js
import CommentLike from "../models/CommentLike.js";
```

Update the cleanup block in `deleteRecipe` (which currently starts with `await Like.deleteMany(...)`) to first collect the recipe's comment IDs and delete their `CommentLike` docs:

```js
    const commentIds = await Comment.find({ recipe: recipe._id }).distinct("_id");
    await CommentLike.deleteMany({ comment: { $in: commentIds } });
    await Like.deleteMany({ recipe: recipe._id });
    await Comment.deleteMany({ recipe: recipe._id });
    await Ingredient.deleteMany({ recipe: recipe._id });
    await Recipe.deleteOne({ _id: recipe._id });
```

- [ ] **Step 2: Verify the controller still loads**

Run:
```bash
node -e "
import('./controllers/recipeController.js').then((m) => {
  console.log('deleteRecipe is function:', typeof m.deleteRecipe === 'function');
}).catch(e => { console.error('FAILED:', e); process.exit(1); });
"
```
Expected: `deleteRecipe is function: true`

- [ ] **Step 3: Commit**

```bash
git add controllers/recipeController.js
git commit -m "Cascade-delete comment likes when a recipe is deleted"
```

---

## Done

At this point: recipes support like/unlike (idempotent) and comments with one level of replies; comments themselves can be liked; the recipe owner can pin one top-level comment, which sorts to the top of the comment list; deleting a recipe, a top-level comment, or a pinned comment all clean up correctly; `likeCount`/`commentCount` stay accurate throughout.
