# Social UI (Likes, Follow, Comments) — Design

## Context

A repo-wide audit (backend + frontend, run in parallel via two research
agents) found that the backend fully supports RecipeHub's core social
features — likes, follow/unfollow, threaded comments with pinning — but
**none of it has any frontend UI**. A grep for `follow|like|comment` across
`src/` (excluding CSS/formData false positives) returned zero matches. For
an app explicitly being built toward an Instagram/TikTok-style experience,
this is the single largest gap between what the backend can do and what a
user can actually do in the browser.

This spec covers building that UI. It's frontend-only — no backend changes
are needed, since `recipe-feed` (backend) already ships everything this
depends on: like/unlike, follow/unfollow, threaded comments (one level),
comment likes, comment pinning, and (as of the same audit pass) a public
`GET /api/users/:id` profile endpoint.

## Goals

- **Like button** on the recipe detail page: optimistic toggle, matching
  the existing save-button pattern already used in this codebase
  (`RecipeDetail.jsx`, `YourRecipes.jsx`).
- **Follow/unfollow button** and a **public profile page** (`/users/:id`)
  showing a user's username, follower/following/recipe counts, and their
  recipes — read-only (no edit/delete, unlike the existing `/profile`
  "my dashboard" page, which stays as-is for the logged-in user's own
  recipes).
- **Comment section** on the recipe detail page: list comments (pinned
  comment first), post a top-level comment, reply to a top-level comment
  (one level, matching the backend's restriction), like/unlike a comment,
  and — for the recipe's owner only — pin/unpin a top-level comment.
- Recipe author names become links to their public profile, wherever an
  author is shown (recipe detail, and recipe cards where the API already
  returns the populated author).

## Non-goals (explicitly out of scope, and why)

- **Notifications** (someone liked/followed/commented). No notification
  model or delivery mechanism exists; that's a real sub-project of its
  own, not a side effect of adding buttons.
- **Real-time updates** (a new comment appearing without a refresh). Both
  feeds and this UI are pull/refresh-based throughout the app already;
  no polling or websocket layer exists to build on.
- **Comment editing.** The backend doesn't support it (only create/delete),
  so the UI won't either.
- **Follower/following list pages** (e.g. a scrollable modal of a user's
  followers). The backend's `getFollowers`/`getFollowing` exist and are
  now capped/sorted, but building dedicated list UI for them is a fair
  chunk of its own scope; this pass shows the *counts* on the profile page
  and stops there.
- **Wiring the like/follow/comment count changes into the trending score
  live** — they already are, server-side (the discover feed's aggregation
  already reads current `likeCount`/`commentCount`/`saveCount`); no new
  work needed here.

## Components

### `LikeButton` (new, `src/components/LikeButton.jsx`)

Reusable. Props: `recipeId`, `initialLikeCount`, `initialLikedByMe`.
Optimistic toggle: flip the heart/count immediately, `POST/DELETE
/recipes/:id/like`, revert on failure — same shape as the existing
`handleSave` optimistic pattern. Guarded behind auth: renders a
"Log in to like" link for guests, matching how the save button was just
fixed to behave for guests.

### `FollowButton` (new, `src/components/FollowButton.jsx`)

Props: `userId`, `initialFollowerCount`, `initialFollowingByMe`. Same
optimistic-toggle shape as `LikeButton`, calling `POST/DELETE
/users/:id/follow`. Hidden entirely when viewing your own profile (you
can't follow yourself; the backend also rejects this with a 400). Guarded
behind auth the same way.

### `UserProfilePage` (new, `src/pages/UserProfile.jsx`, route `/users/:id`)

On mount: `GET /api/users/:id` for the header (username, counts),
`GET /api/recipes/user/:id` for their recipes (already paginated from the
audit fixes; this pass loads page 1 with a "Load more" button, same
pattern as `Explore.jsx`). Renders `<FollowButton>` unless `id` matches
the logged-in user's own `_id`, in which case it links to `/profile`
instead (their own editable dashboard).

### `CommentSection` (new, `src/components/CommentSection.jsx`)

Used inside `RecipeDetail.jsx`. On mount: `GET /recipes/:id/comments`
(already returns pinned-first from the backend). Renders:
- A text input + submit for a new top-level comment (auth-gated; guests
  see a "Log in to comment" link, same pattern as like/save).
- Each top-level comment: author (links to `/users/:id`), text, a
  `CommentLikeButton` (small inline version of the optimistic-toggle
  pattern, hitting `POST/DELETE /comments/:commentId/like`), a "Reply"
  link that reveals an inline reply input, and — if the current user is
  the comment's author OR the recipe's owner — a "Delete" button.
- Each comment's replies (one level, already enforced server-side)
  indented underneath it, same actions minus "Reply" (replies can't be
  replied to).
- If the current user is the recipe's owner: a "Pin"/"Unpin" control on
  each top-level comment.

No pagination on comments in this pass — the backend now caps
`GET /recipes/:id/comments` at 50 by default (part of the same audit
fix), which is a reasonable first-version limit; a "load more" for
comment threads is a natural follow-up, not required to ship the core
feature.

## Data flow / API contracts (all already exist, no backend changes)

- `POST /recipes/:id/like`, `DELETE /recipes/:id/like` → `{ likeCount, likedByMe }`
- `POST /users/:id/follow`, `DELETE /users/:id/follow` → `{ followerCount, followingByMe }`
- `GET /users/:id` → `{ _id, username, followerCount, followingCount, recipeCount, createdAt }`
- `GET /recipes/:id/comments` → array of `{ _id, text, user: {_id, username}, parentComment, likeCount, createdAt }`, pinned-first
- `POST /recipes/:id/comments` body `{ text, parentComment? }` → created comment
- `DELETE /recipes/:id/comments/:commentId`
- `POST /recipes/:id/comments/:commentId/pin`, `DELETE /recipes/:id/pin`
- `POST /comments/:commentId/like`, `DELETE /comments/:commentId/like` → `{ likeCount, likedByMe }`
- `GET /recipes/:id` (already populates `user` as `{_id, username}` as of
  the audit fix) — `RecipeDetail.jsx` needs no new fetch for the author's
  identity, just a link using the existing `recipe.user`.

The recipe detail fetch currently doesn't return `likeCount`/`likedByMe`
for the viewer — `likeCount` is already on the `Recipe` document (returned
as-is), but `likedByMe` isn't computed server-side anywhere. Rather than
add a new backend endpoint just for this, `LikeButton` does its own cheap
existence check the same way the save button already does today
(`RecipeDetail.jsx`'s existing `isSaved` effect checks `/recipes/saved`
client-side) — except there's no equivalent "my likes" list endpoint. The
simplest correct option, and the one this spec uses: `LikeButton` starts
from `initialLikedByMe = false` optimistically-unknown, and instead of
guessing, the first render fires nothing extra — the toggle itself always
tells the truth (`likedByMe` comes back from the like/unlike response),
so the only inaccuracy is on first paint for a recipe the user already
liked, showing "Like" instead of "Liked" until they interact. Fully fixing
that needs either a new backend field or a client-side "my likes" list,
both bigger than this pass — noted as a follow-up, not blocking.

## Testing

Same as the rest of this project: no automated test framework. Verified
via a production build (catches syntax/reference errors) and a Playwright
pass against the running dev server exercising the real flows (like
toggle, follow toggle, posting/replying to/deleting a comment, pinning),
consistent with how the earlier ingredient-fields fix and the navbar fix
were verified this session.
