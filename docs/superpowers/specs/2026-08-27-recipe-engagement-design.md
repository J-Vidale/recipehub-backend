# Recipe Engagement (Likes + Comments) — Design

## Context

RecipeHub is being built out toward an Instagram/TikTok-style experience for
recipes, as four independent sub-projects:

1. Media upload (built on its own branch, `claude/recipe-hub-backend-setup-sf8t53`)
2. **Engagement — likes + comments (this spec)**
3. Social graph (follow/followers)
4. Feed endpoint (ranking/pagination)

Each sub-project lives on its own branch cut from `main`, so an issue in one
doesn't block or entangle the others. This branch (`claude/recipe-engagement-likes-comments`)
does not include the media-upload changes.

This spec covers only #2, and assumes the current state of `main`: `Recipe`
has `user`, `title`, `category`, `instructions`, `ingredients` — no `media`,
`likes`, or `comments` yet.

## Goals

- Let a logged-in user like or unlike a recipe.
- Let a logged-in user comment on a recipe, and reply to a top-level comment
  (one level of nesting, matching Instagram/TikTok — a reply cannot itself
  be replied to).
- Let anyone (no auth required) read a recipe's comments, matching how
  recipe browsing is already public.
- Let a comment's author, or the recipe's owner, delete a comment.
  Deleting a top-level comment also deletes its replies.
- Keep `Recipe.likeCount` and `Recipe.commentCount` in sync so a future
  feed can sort/filter by engagement without an expensive count query on
  every read.

## Non-goals (explicitly out of scope for this pass)

- Editing a comment after posting (matches Instagram/TikTok — delete-only).
- Pagination of comments (fine at current scale; flat list returned in
  full, easy to add a `?page=` param later without a breaking change).
- Nesting beyond one level.
- Notifications for likes/comments (that's downstream of the social graph
  and feed sub-projects, not this one).
- Exposing "did the current user like this recipe" on the general recipe
  list/detail endpoints (`getAllRecipes`/`getSingleRecipe`) — those stay
  unauthenticated-friendly. The like/unlike endpoints themselves return
  the current like state directly, which is enough for a frontend to
  manage optimistic UI without querying it separately.

## Data model

### `Like` (new collection, `models/Like.js`)

```js
{
  user: { type: ObjectId, ref: "User", required: true },
  recipe: { type: ObjectId, ref: "Recipe", required: true },
  // timestamps: true
}
```

Unique compound index on `(user, recipe)` — enforces one like per user per
recipe at the database level, and makes "does this user like this recipe"
a cheap indexed lookup.

**Why a separate collection instead of an embedded `likedBy` array on
`Recipe`:** an embedded array grows unbounded as a recipe gets popular,
bloating the `Recipe` document (worst case, toward MongoDB's 16MB document
limit) and making "did user X like this" an array scan instead of an
indexed lookup. A separate collection, the same pattern already used for
`Ingredient`, scales independently of like count.

### `Comment` (new collection, `models/Comment.js`)

```js
{
  recipe: { type: ObjectId, ref: "Recipe", required: true },
  user: { type: ObjectId, ref: "User", required: true },
  parentComment: { type: ObjectId, ref: "Comment", default: null },
  text: { type: String, required: true, maxlength: 1000 },
  // timestamps: true
}
```

`parentComment: null` means top-level. A reply sets `parentComment` to a
top-level comment's `_id`. The one-level rule is enforced at write time,
not by the schema: creating a comment whose `parentComment` itself has a
non-null `parentComment` is rejected with `400`.

### `Recipe` (modified)

Adds two denormalized counters:

```js
likeCount: { type: Number, default: 0 },
commentCount: { type: Number, default: 0 },
```

Updated via `$inc` alongside the corresponding `Like`/`Comment`
create/delete, not recomputed from a count query.

## New endpoints

Mirrors the existing `save`/`unsave` pair (`POST /api/recipes/save/:recipeId`,
`DELETE /api/recipes/unsave/:recipeId`) and the sub-resource pattern used
for ingredients.

- **`POST /api/recipes/:id/like`** — protected. Creates a `Like` if one
  doesn't already exist for this user+recipe, increments `likeCount`.
  Idempotent: liking an already-liked recipe is not an error, just returns
  the current state. Returns `{ likeCount, likedByMe: true }`.
- **`DELETE /api/recipes/:id/like`** — protected. Deletes the `Like` if it
  exists, decrements `likeCount`. Idempotent: unliking a not-liked recipe
  is not an error. Returns `{ likeCount, likedByMe: false }`.
- **`POST /api/recipes/:id/comments`** — protected. Body: `{ text, parentComment? }`.
  Validates `text` is non-empty and ≤1000 chars. If `parentComment` is
  given, it must reference an existing top-level comment on the same
  recipe (400 otherwise). Increments `commentCount`. Returns the created
  comment.
- **`GET /api/recipes/:id/comments`** — public. Returns all comments for
  the recipe, flat, sorted oldest-first, each with `_id`, `user`
  (populated with `username`), `text`, `parentComment`, `createdAt`.
  Frontend groups replies under their parent client-side.
- **`DELETE /api/recipes/:id/comments/:commentId`** — protected. Allowed
  if the requester is the comment's author OR the recipe's owner. Deletes
  the comment and, if it was top-level, all its replies. Decrements
  `commentCount` by the total number of comments removed (1, or 1 + reply
  count).

## Existing code that needs updating

- **`deleteRecipe`** (`controllers/recipeController.js`) currently deletes
  a recipe's `Ingredient` docs. It will be extended to also delete all
  `Like` and `Comment` docs referencing that recipe, so deleting a recipe
  doesn't leave orphaned engagement data behind.

## Error handling

- `404` if the recipe (or, for comment deletion, the comment) doesn't
  exist.
- `400` if `text` is missing/empty/over 1000 chars, or if `parentComment`
  points at a reply rather than a top-level comment, or at a comment on a
  different recipe.
- `403` if a delete is attempted by someone who isn't the comment's author
  or the recipe's owner.
- Like/unlike are deliberately idempotent (no error on double-like or
  double-unlike) rather than returning `409`, since a toggle-button UI can
  easily double-fire a request.

## Testing

No automated test framework exists in this repo (consistent with the
media-upload spec's finding). Verification here is manual: run the server
locally against a real MongoDB (Atlas free tier or local), exercise all
five endpoints with `curl`, and confirm `likeCount`/`commentCount` stay
correct through create/delete/cascade-delete sequences. Unlike the
media-upload sub-project, this one needs no third-party credentials beyond
`MONGO_URI`/`JWT_SECRET`, so it's fully testable without any new account
sign-up.

## Frontend impact (not built in this pass, noted for context)

The frontend will eventually need like buttons and a comment section on
the recipe detail page. Not part of this backend spec.

## Addendum: comment likes and pinning

Added after the base engagement work above was already implemented and
committed on this branch, per explicit request to match Instagram/TikTok
behavior more fully. Builds directly on the `Comment` model and endpoints
above.

### Goals

- Let a logged-in user like/unlike an individual comment (not just a
  recipe), idempotently, same as recipe likes.
- Let a recipe's owner pin exactly one top-level comment to the top of
  that recipe's comment list — matches TikTok, which allows a single
  pinned comment per video (Instagram allows up to 3; picking TikTok's
  simpler single-pin model to avoid unnecessary complexity, still
  "standard" behavior for this category of app).

### Data model

**`CommentLike`** (new collection, `models/CommentLike.js`), mirrors `Like`:

```js
{
  user: { type: ObjectId, ref: "User", required: true },
  comment: { type: ObjectId, ref: "Comment", required: true },
  // timestamps: true
}
```

Unique compound index on `(user, comment)`, same reasoning as `Like`: a
separate collection scales independently of per-comment like count.

**`Comment`** (modified): adds `likeCount: { type: Number, default: 0 }`,
denormalized the same way as `Recipe.likeCount`.

**`Recipe`** (modified): adds `pinnedComment: { type: ObjectId, ref: "Comment", default: null }`.
Storing the pin on `Recipe` (rather than a `pinned: Boolean` on `Comment`)
means pinning a new comment is a single overwrite — there's no way to end
up with two comments simultaneously marked pinned.

### New endpoints

- **`POST /api/comments/:commentId/like`** / **`DELETE /api/comments/:commentId/like`**
  — protected, idempotent, identical shape to the recipe like/unlike
  endpoints, returns `{ likeCount, likedByMe }`. Lives in a new
  `routes/commentRoutes.js` mounted at `/api/comments` in `server.js`,
  since liking a comment only needs the comment's ID, not its recipe's.
- **`POST /api/recipes/:id/comments/:commentId/pin`** — protected,
  recipe-owner only. Rejects with `400` if the target comment is a reply
  (has a non-null `parentComment`) or `404` if it doesn't belong to this
  recipe. Sets `recipe.pinnedComment` to the comment's ID (overwriting any
  previous pin).
- **`DELETE /api/recipes/:id/pin`** — protected, recipe-owner only. Clears
  `recipe.pinnedComment` unconditionally (no-op if nothing was pinned).

### Existing code that needs updating

- **`getComments`** (`controllers/commentController.js`): after fetching
  the recipe's comments sorted oldest-first, if `recipe.pinnedComment` is
  set, stable-sort so that comment moves to the front — everything else
  keeps its original relative order. (JS `Array.prototype.sort` is
  guaranteed stable in Node, so a simple "is this the pinned one" partition
  is sufficient — no need to re-fetch or re-query.)
- **`deleteComment`** (`controllers/commentController.js`): if the comment
  being deleted is the recipe's current `pinnedComment`, clear
  `recipe.pinnedComment` as part of the same operation.
- **`deleteRecipe`** (`controllers/recipeController.js`): extend the
  existing cascade-delete to also delete all `CommentLike` docs for every
  comment on that recipe.

### Error handling

- `403` if pin/unpin is attempted by anyone other than the recipe owner.
- `400` if trying to pin a reply.
- `404` if the comment doesn't exist or belongs to a different recipe.
- Comment like/unlike follow the same idempotent-no-error pattern as
  recipe like/unlike.

### Testing

Same manual approach as the rest of this spec — no automated test
framework in this repo. Verified via `curl` against a real MongoDB.
