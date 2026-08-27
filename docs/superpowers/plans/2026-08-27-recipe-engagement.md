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

## Done

At this point: recipes support like/unlike (idempotent) and comments with one level of replies; deleting a recipe, or a top-level comment, cleans up everything underneath it; `likeCount`/`commentCount` stay accurate throughout.
