# Recipe Feed — Design

## Context

RecipeHub is being built out toward an Instagram/TikTok-style experience for
recipes, as four planned sub-projects:

1. Media upload
2. Engagement — likes + comments
3. Social graph — follow/followers
4. **Feed endpoint (this spec)**

Sub-projects 1-3 are each on their own branch; this sub-project needs all
three merged together first, since a feed genuinely depends on their data
(media to display, `likeCount`/`commentCount` to rank by, follow
relationships for the personalized feed). They've been combined into
`recipe-feed`, branched fresh from `main` with 1, 2, and 3 merged in (plus
`perf/repo-wide-fixes`, since building a feed on top of the still-broken
recipe-creation flow — see that branch's history — would just surface
broken data). This spec is built on top of `recipe-feed`.

## Goals

- A **following feed** (`GET /api/recipes/feed`, protected): recipes from
  users the requester follows, newest first, paginated.
- A **discover feed** (`GET /api/recipes`, upgraded from today's
  unpaginated "get everything"): all recipes, ranked by a trending score,
  paginated.
- The trending score is explicitly modeled on TikTok's *documented* signal
  hierarchy — saves/shares outweigh likes, follower count is not a ranking
  factor — not on its full recommendation system (see Non-goals for why).
- `Recipe.saveCount` added and kept in sync, the same denormalized-counter
  pattern already used for `likeCount`/`commentCount`/`followerCount`.

## Non-goals (explicitly out of scope, and why)

- **Watch-time / completion-rate ranking.** This is TikTok's actual
  strongest signal (reported at roughly 40-50% of ranking weight), but it
  requires video-playback instrumentation - a client that reports viewing
  progress, and a backend endpoint/pipeline to record it. Nothing like that
  exists in this app today, and media itself is optional per recipe
  (photos or video). Building watch-time tracking is a real sub-project of
  its own, not a side effect of a feed endpoint.
- **Follower-first test-pool rollout.** TikTok reportedly shows a new post
  to a small pool (largely existing followers) first, then expands
  distribution based on how that pool engages. Reproducing this needs a
  staged-distribution state machine per post and view tracking to measure
  the test pool's engagement - out of scope for a first version.
- **Per-user personalized ranking / collaborative filtering.** TikTok's
  actual "For You" ranking is personalized per viewer based on interaction
  history. This spec's discover feed is the same ranked order for every
  viewer (a global trending feed), not personalized. Personalization needs
  an interaction-history model and enough real usage data to train against
  - neither exists yet.
- Real-time/streaming feed updates (e.g., "3 new recipes" banner while
  viewing). Both feeds are pull/refresh-based.

## Data model

### `Recipe` (modified)

```js
saveCount: { type: Number, default: 0 },
```

Updated via atomic `$inc` in `saveRecipe`/`unsaveRecipe` (which currently
only touch `User.savedRecipes` - the recipe itself has no record of how
many times it's been saved). Same idempotent-decrement guard already used
for `likeCount`: `{ _id, saveCount: { $gt: 0 } }` filter on the decrement so
it can never go negative.

No other schema changes. Both feed endpoints query the existing `Recipe`
collection; no new collection needed.

## New/changed endpoints

### `GET /api/recipes/feed` (new, protected)

Recipes from users the requester follows (via the `Follow` collection from
sub-project 3), newest first. Cursor-based pagination: query params
`?cursor=<recipeId>&limit=<n>` (default limit 20, max 50). The cursor is
the `_id` of the last recipe on the previous page; since results are
sorted by `(createdAt desc, _id desc)` and `createdAt` never changes
retroactively, `{ _id: { $lt: cursor } }` combined with the same sort
order is a stable, correct cursor for this stable sort key - no
duplicate or skipped items even if new recipes are created between page
loads. Response: `{ recipes: [...], nextCursor: <id or null> }`.

If the requester follows no one, returns `{ recipes: [], nextCursor: null }`
- not an error.

### `GET /api/recipes` (changed from today's bare `Recipe.find()`)

Becomes the discover/trending feed. Query params `?page=<n>&limit=<n>`
(default page 1, limit 20, max 50) - **page-based, not cursor-based**,
and deliberately so: the trending score is computed live from each
recipe's current `saveCount`/`commentCount`/`likeCount` and age, so it
shifts slightly between requests as time passes and engagement changes.
A cursor built from a live-computed, shifting score isn't meaningfully
more stable than page numbers here - both are approximate for a live
ranking, and page-based is simpler and matches how most real "trending"
endpoints are built without a caching/snapshot layer. Optional
`?sort=newest` falls back to plain chronological (an escape hatch, not a
personalization feature). Response: `{ recipes: [...], page, hasMore }`.

**Trending score** (computed via a Mongoose aggregation pipeline, not
stored - it depends on the current time, so it can't be a static field
without a periodic recompute job this pass doesn't build):

```
ageInHours = (now - recipe.createdAt) in hours
score = (saveCount * 3 + commentCount * 2 + likeCount * 1) / (ageInHours + 2) ^ 1.5
```

This is the well-known "Hacker News hot ranking" shape (weighted signal
divided by age-decay) - a standard, well-understood choice for a
trending feed, not a novel formula. The weights (save=3, comment=2,
like=1) directly encode the save/share-over-like hierarchy from TikTok's
documented ranking signals.

## Existing code that needs updating

- **`getAllRecipes`** (`controllers/recipeController.js`) is replaced by
  the new paginated/ranked implementation above. Same route
  (`GET /api/recipes`), different handler body and response shape.
- **`saveRecipe`/`unsaveRecipe`** need the atomic `$inc`/`$dec` on
  `Recipe.saveCount` added alongside their existing `User.savedRecipes`
  update.
- **Frontend `Explore.jsx`** currently does `setRecipes(res.data)` expecting
  a bare array from `GET /api/recipes`. Changing the response shape to
  `{ recipes, page, hasMore }` without updating this would break the page
  that's the primary consumer of this exact endpoint. This spec includes
  updating it (unlike sub-projects 1-3, where frontend wiring was
  explicitly deferred, this one would leave an existing working page
  broken if skipped).

## Error handling

- `400` if `cursor` (feed) isn't a valid ObjectId, or `page`/`limit` (discover)
  aren't positive integers within bounds.
- Both endpoints clamp `limit` to `[1, 50]` rather than erroring on an
  out-of-range value, matching how most paginated APIs handle this (a
  client-supplied limit of 10000 gets silently capped, not rejected).

## Testing

Same as every other sub-project in this project: no automated test
framework. Verified via schema/aggregation-pipeline checks that don't need
a live DB where possible, and `curl` against a real MongoDB where the
computation genuinely requires one (the trending aggregation can't be
meaningfully verified without real documents to rank).

## Frontend impact

`Explore.jsx` is updated as part of this spec (see above - not deferred,
since it's the endpoint's existing consumer). A "following feed" page/tab
using the new `GET /api/recipes/feed` is not built in this pass - the
current frontend has no navigation concept of a personalized home feed
distinct from Explore; adding that page is a larger frontend change
better scoped on its own.
