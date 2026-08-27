# Social Graph (Follow/Followers) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a logged-in user follow/unfollow another user (instant, no approval), with public followers/following lists and `User.followerCount`/`followingCount` kept in sync for a future feed.

**Architecture:** `Follow` is a new top-level Mongoose collection referencing `User` by ID twice (`follower`, `following`), same pattern as `Like`. All counter mutations use atomic `$inc` from the start (this codebase already fixed a read-modify-write race on `Recipe.likeCount` once; this sub-project starts with the atomic pattern rather than retrofitting it later).

**Tech Stack:** Node.js, Express 5, Mongoose.

## Global Constraints

- `Follow` has a unique compound index on `(follower, following)` — one follow relationship per pair, enforced at the DB level (spec §Data model).
- A user cannot follow themselves — `400` if `:id` equals the requester's own ID (spec §Error handling).
- Follow/unfollow are idempotent — following an already-followed user or unfollowing a not-followed user is not an error (spec §Goals).
- Followers/following lists are public — no auth required to view them (spec §Goals).
- No automated test framework exists in this repo. Every task below is verified manually with exact commands and expected output.

---

### Task 1: Follow model and User counters

**Files:**
- Create: `models/Follow.js`
- Modify: `models/User.js`

**Interfaces:**
- Produces: `Follow` model — documents shaped `{ _id, follower, following, createdAt, updatedAt }`, unique on `(follower, following)`. `User.followerCount`, `User.followingCount` (Number, default 0). Both consumed by Task 2.

- [ ] **Step 1: Create the Follow model**

Create `models/Follow.js`:

```js
// models/Follow.js
import mongoose from "mongoose";

const followSchema = new mongoose.Schema(
  {
    follower: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    following: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true }
);

followSchema.index({ follower: 1, following: 1 }, { unique: true });

export default mongoose.model("Follow", followSchema);
```

- [ ] **Step 2: Add `followerCount`/`followingCount` to the User schema**

In `models/User.js`, add both fields alongside `savedRecipes`:

```js
    savedRecipes: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Recipe",
      },
    ],
    followerCount: { type: Number, default: 0 },
    followingCount: { type: Number, default: 0 },
```

- [ ] **Step 3: Verify the Follow model's index and validation**

Run:
```bash
node -e "
import('./models/Follow.js').then(({ default: Follow }) => {
  const mongoose = require('mongoose');
  console.log('indexes:', JSON.stringify(Follow.schema.indexes()));
  const doc = new Follow({ follower: new mongoose.Types.ObjectId(), following: new mongoose.Types.ObjectId() });
  console.log('valid doc errors (expect undefined):', doc.validateSync());
  const missing = new Follow({});
  const missingErr = missing.validateSync();
  console.log('missing fields errors (expect follower, following):', missingErr?.errors ? Object.keys(missingErr.errors) : null);
});
"
```
Expected: `indexes` shows an entry for `{"follower":1,"following":1}` with `unique:true`; valid doc errors is `undefined`; missing fields lists `['follower', 'following']` (order may vary).

- [ ] **Step 4: Verify the User counters default to 0**

Run:
```bash
node -e "
import('./models/User.js').then(({ default: User }) => {
  const u = new User({ username: 'test', email: 't@example.com', password: 'password123' });
  console.log('followerCount:', u.followerCount, '(expect 0)');
  console.log('followingCount:', u.followingCount, '(expect 0)');
});
"
```
Expected: both print `0 (expect 0)`.

- [ ] **Step 5: Commit**

```bash
git add models/Follow.js models/User.js
git commit -m "Add Follow model and User follower/following counters"
```

---

### Task 2: Follow controller and routes

**Files:**
- Create: `controllers/followController.js`
- Create: `routes/followRoutes.js`
- Modify: `server.js`

**Interfaces:**
- Consumes: `Follow` and `User.followerCount`/`followingCount` from Task 1, `protect` from `middleware/authMiddleware.js`.
- Produces: `followUser`, `unfollowUser`, `getFollowers`, `getFollowing` controller functions; routes `POST /api/users/:id/follow`, `DELETE /api/users/:id/follow`, `GET /api/users/:id/followers`, `GET /api/users/:id/following`, mounted at `/api/users` alongside the existing `userRoutes.js` mount.

- [ ] **Step 1: Create the follow controller**

Create `controllers/followController.js`:

```js
// controllers/followController.js
import mongoose from "mongoose";
import User from "../models/User.js";
import Follow from "../models/Follow.js";

// POST /api/users/:id/follow
export const followUser = async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(400).json({ message: "Invalid user ID" });
  }
  if (req.params.id === req.user._id.toString()) {
    return res.status(400).json({ message: "You cannot follow yourself" });
  }

  const targetUser = await User.findById(req.params.id);
  if (!targetUser) {
    return res.status(404).json({ message: "User not found" });
  }

  try {
    await Follow.create({ follower: req.user._id, following: targetUser._id });
    await User.updateOne({ _id: targetUser._id }, { $inc: { followerCount: 1 } });
    await User.updateOne({ _id: req.user._id }, { $inc: { followingCount: 1 } });
  } catch (err) {
    if (err.code !== 11000) {
      throw err;
    }
    // Already following - idempotent.
  }

  const updatedTarget = await User.findById(targetUser._id).select("followerCount");
  res.json({ followerCount: updatedTarget.followerCount, followingByMe: true });
};

// DELETE /api/users/:id/follow
export const unfollowUser = async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(400).json({ message: "Invalid user ID" });
  }

  const targetUser = await User.findById(req.params.id);
  if (!targetUser) {
    return res.status(404).json({ message: "User not found" });
  }

  const deleted = await Follow.findOneAndDelete({
    follower: req.user._id,
    following: targetUser._id,
  });

  if (deleted) {
    await User.updateOne(
      { _id: targetUser._id, followerCount: { $gt: 0 } },
      { $inc: { followerCount: -1 } }
    );
    await User.updateOne(
      { _id: req.user._id, followingCount: { $gt: 0 } },
      { $inc: { followingCount: -1 } }
    );
  }

  const updatedTarget = await User.findById(targetUser._id).select("followerCount");
  res.json({ followerCount: updatedTarget.followerCount, followingByMe: false });
};

// GET /api/users/:id/followers
export const getFollowers = async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(400).json({ message: "Invalid user ID" });
  }

  const targetUser = await User.findById(req.params.id);
  if (!targetUser) {
    return res.status(404).json({ message: "User not found" });
  }

  const follows = await Follow.find({ following: targetUser._id }).populate(
    "follower",
    "username"
  );
  res.json(follows.map((f) => f.follower));
};

// GET /api/users/:id/following
export const getFollowing = async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(400).json({ message: "Invalid user ID" });
  }

  const targetUser = await User.findById(req.params.id);
  if (!targetUser) {
    return res.status(404).json({ message: "User not found" });
  }

  const follows = await Follow.find({ follower: targetUser._id }).populate(
    "following",
    "username"
  );
  res.json(follows.map((f) => f.following));
};
```

- [ ] **Step 2: Create the follow routes file**

Create `routes/followRoutes.js`:

```js
import express from "express";
import {
  followUser,
  unfollowUser,
  getFollowers,
  getFollowing,
} from "../controllers/followController.js";
import { protect } from "../middleware/authMiddleware.js";

const router = express.Router();

router.post("/:id/follow", protect, followUser);
router.delete("/:id/follow", protect, unfollowUser);
router.get("/:id/followers", getFollowers);
router.get("/:id/following", getFollowing);

export default router;
```

- [ ] **Step 3: Mount the routes in server.js**

In `server.js`, add the import alongside the other route imports:

```js
import followRoutes from "./routes/followRoutes.js";
```

And add a second mount at the same base path as `userRoutes`, right after it:

```js
app.use("/api/users", userRoutes);
app.use("/api/users", followRoutes);
```

- [ ] **Step 4: Verify routes load and register correctly**

Run:
```bash
node -e "
import('./routes/followRoutes.js').then((m) => {
  const paths = m.default.stack.filter(l => l.route).map(l => Object.keys(l.route.methods).join(',').toUpperCase() + ' ' + l.route.path);
  console.log(paths.join('\n'));
}).catch(e => { console.error('FAILED:', e); process.exit(1); });
"
```
Expected:
```
POST /:id/follow
DELETE /:id/follow
GET /:id/followers
GET /:id/following
```

Then confirm the whole app still boots cleanly with `npm run dev` (or a short-lived `node server.js` with dummy env vars) — no import errors, and no route conflict with the existing `GET /api/users/me`.

- [ ] **Step 5: Verify the self-follow and idempotency guards directly**

Run:
```bash
node -e "
import('./controllers/followController.js').then((follow) => {
  const mockRes = (label) => ({
    status(code) { this.code = code; return this; },
    json(body) { console.log(label, '-> status', this.code || 200, JSON.stringify(body)); },
  });
  const sameId = '507f1f77bcf86cd799439011';
  follow.followUser({ params: { id: sameId }, user: { _id: sameId } }, mockRes('self-follow'));
  follow.followUser({ params: { id: 'not-an-id' }, user: { _id: sameId } }, mockRes('bad id'));
});
"
```
Expected:
```
self-follow -> status 400 {"message":"You cannot follow yourself"}
bad id -> status 400 {"message":"Invalid user ID"}
```

- [ ] **Step 6: Commit**

```bash
git add controllers/followController.js routes/followRoutes.js server.js
git commit -m "Add follow/unfollow and followers/following endpoints"
```

---

### Task 3: Manual end-to-end verification (requires a real MongoDB)

This task has no code changes - it's the live verification the earlier
sub-projects (media upload, engagement) also relied on `curl` for, since
this repo has no automated test framework.

- [ ] **Step 1: Exercise the full flow against a real MongoDB**

With the server running and a real `MONGO_URI`/`JWT_SECRET` in `.env`:

```bash
TOKEN_A=$(curl -s -X POST http://localhost:5000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"username":"followerUser","email":"follower@example.com","password":"password123"}' \
  | node -e "process.stdin.on('data', d => console.log(JSON.parse(d).token))")

USER_B_ID=$(curl -s -X POST http://localhost:5000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"username":"targetUser","email":"target@example.com","password":"password123"}' \
  | node -e "process.stdin.on('data', d => console.log(JSON.parse(d)._id))")

# Follow twice - should stay at followerCount 1 (idempotent)
curl -s -X POST http://localhost:5000/api/users/$USER_B_ID/follow -H "Authorization: Bearer $TOKEN_A"
curl -s -X POST http://localhost:5000/api/users/$USER_B_ID/follow -H "Authorization: Bearer $TOKEN_A"

# List followers/following
curl -s http://localhost:5000/api/users/$USER_B_ID/followers
curl -s http://localhost:5000/api/users/$USER_B_ID/following

# Unfollow twice - should stay at followerCount 0 (idempotent)
curl -s -X DELETE http://localhost:5000/api/users/$USER_B_ID/follow -H "Authorization: Bearer $TOKEN_A"
curl -s -X DELETE http://localhost:5000/api/users/$USER_B_ID/follow -H "Authorization: Bearer $TOKEN_A"
```

Expected: both `POST` calls return `{"followerCount":1,"followingByMe":true}`; the followers list shows one entry with `username: "followerUser"`; the following list for `$USER_B_ID` is empty (B hasn't followed anyone); both `DELETE` calls return `{"followerCount":0,"followingByMe":false}`.

- [ ] **Step 2: No commit for this task** - it's verification only, nothing to check in.

---

## Done

At this point: users can follow/unfollow each other (idempotent, no self-follow), followers/following lists are public, and `followerCount`/`followingCount` stay accurate throughout via atomic updates from the start.
