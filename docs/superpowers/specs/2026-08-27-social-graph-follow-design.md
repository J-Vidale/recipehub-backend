# Social Graph (Follow/Followers) — Design

## Context

RecipeHub is being built out toward an Instagram/TikTok-style experience for
recipes, as four independent sub-projects:

1. Media upload (`claude/recipe-hub-backend-setup-sf8t53`)
2. Engagement — likes + comments (`claude/recipe-engagement-likes-comments`)
3. **Social graph — follow/followers (this spec)**
4. Feed endpoint (ranking/pagination) — depends on #2 and #3 being merged

This branch (`follow-followers`) is cut fresh from `main`, independent of
sub-projects 1 and 2, matching the isolation approach used for those.

## Goals

- Let a logged-in user follow or unfollow another user.
- Following is instant — no approval step, matching how public
  recipe-sharing accounts typically work (Instagram/TikTok default).
- Idempotent: following an already-followed user, or unfollowing a
  not-followed user, is not an error — matches the pattern already used for
  recipe/comment likes.
- A user cannot follow themselves.
- Anyone (no auth required) can view a user's followers/following list,
  matching how recipe browsing and user profiles are already public.
- Keep `User.followerCount`/`User.followingCount` in sync so a future feed
  can build a "people you follow" query without a separate count lookup on
  every request.

## Non-goals (explicitly out of scope for this pass)

- Follow requests/approval (private accounts). Instant/open follow only.
- Blocking or muting.
- Notifications for new followers (downstream of the feed sub-project, not
  this one).
- Mutual-follow / "friends" concept — this is one-directional, like
  Instagram/TikTok follow (not Facebook friend requests).

## Data model

### `Follow` (new collection, `models/Follow.js`)

```js
{
  follower: { type: ObjectId, ref: "User", required: true },  // who is doing the following
  following: { type: ObjectId, ref: "User", required: true }, // who is being followed
  // timestamps: true
}
```

Unique compound index on `(follower, following)` — enforces one follow
relationship per pair at the database level, same reasoning as `Like`'s
`(user, recipe)` index: cheap indexed existence checks, scales independently
of follower count on either side.

### `User` (modified)

Adds two denormalized counters:

```js
followerCount: { type: Number, default: 0 },
followingCount: { type: Number, default: 0 },
```

Updated via atomic `$inc` alongside the corresponding `Follow` create/delete
(the codebase already moved to this pattern for `Recipe.likeCount` after a
prior bug where a read-modify-write `doc.field += 1; doc.save()` pattern
lost updates under concurrent requests — same fix applied here from the
start rather than retrofitted later).

## New endpoints

New route file `routes/followRoutes.js`, mounted at `/api/users` in
`server.js` (alongside the existing `userRoutes.js` mount, same base path
since these are all user-relationship endpoints).

- **`POST /api/users/:id/follow`** — protected. Creates a `Follow` if one
  doesn't already exist for this follower+following pair, increments both
  users' counters. `400` if `:id` equals the requester's own ID (can't
  follow yourself). Idempotent. Returns
  `{ followerCount, followingCount: <own>, followingByMe: true }` where
  `followerCount` is the target user's updated follower count.
- **`DELETE /api/users/:id/follow`** — protected. Deletes the `Follow` if it
  exists, decrements both counters. Idempotent. Returns the same shape with
  `followingByMe: false`.
- **`GET /api/users/:id/followers`** — public. List of users who follow
  `:id` (each entry populated with `username`, not the full user doc).
- **`GET /api/users/:id/following`** — public. List of users `:id` follows.

## Existing code that needs updating

- **`deleteRecipe`** stays untouched — deleting a recipe has no relationship
  to a user's follow graph.
- No existing endpoint needs modification for this sub-project; this is
  purely additive (new model, new controller, new routes, new `User`
  fields). The one exception: if a user account is ever deleted in the
  future, that flow would need to clean up `Follow` docs referencing it —
  but there is no account-deletion endpoint in this codebase today, so
  that's out of scope until one exists.

## Error handling

- `400` if `:id` is not a valid ObjectId, or if `:id` equals the
  requester's own ID (self-follow).
- `404` if the target user doesn't exist.
- Follow/unfollow are idempotent — no `409` on a duplicate follow or a
  redundant unfollow, same rationale as recipe/comment likes (a toggle-style
  UI button can double-fire).

## Testing

No automated test framework in this repo (consistent with every other spec
in this project). Verified manually: schema validation via `validateSync`/
index inspection (no DB needed), module loading, route registration, a
clean server boot, and — where a real `MONGO_URI` is available — `curl`
against the live endpoints. This sub-project needs no third-party
credentials beyond Mongo, same as the engagement sub-project.

## Frontend impact (not built in this pass, noted for context)

The frontend will eventually need a Follow/Unfollow button on user
profiles and follower/following list views. Not part of this backend spec.
