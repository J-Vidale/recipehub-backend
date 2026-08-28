# RecipeHub Backend

This is the backend API for **RecipeHub**, a MERN stack recipe sharing application.

---

## Features

- User registration and login with JWT authentication
- Create, update, delete your own recipes, with a list of ingredients on each
- Attach photos (up to 5, carousel-style) or a short video to a recipe, stored on Cloudinary
- Like/unlike recipes and comments, comment on recipes (with one level of replies), pin your favorite comment
- Follow/unfollow other users
- Personalized following feed, and a TikTok-inspired trending discover feed
- Save/unsave recipes to your profile
- View your own and saved recipes
- RESTful API structure
- MongoDB database with Mongoose models

---

## Getting Started

### Prerequisites

- Node.js (v18+ recommended)
- MongoDB database (local or Atlas)

### Installation

```sh
git clone https://github.com/yourusername/recipehub-backend.git
cd recipehub-backend
npm install
```

### Environment Variables

Create a `.env` file in the root with the following:

```
MONGO_URI=your_mongodb_connection_string
JWT_SECRET=your_jwt_secret
PORT=5000
CLOUDINARY_CLOUD_NAME=your_cloud_name
CLOUDINARY_API_KEY=your_api_key
CLOUDINARY_API_SECRET=your_api_secret
REDIS_URL=your_redis_connection_string
```

`REDIS_URL` is optional. If it's unset, or Redis is unreachable, the app runs exactly as it would with it — caching is a pure performance layer, never a hard dependency. See "Caching" below.

### Running the Server

```sh
npm run dev
```
The server will start on `http://localhost:5000`.

---

## API Endpoints

### **Auth**
- `POST /api/auth/register` — Register a new user
- `POST /api/auth/login` — Login and receive JWT

### **User**
- `GET /api/users/me` — Get current user info (protected)
- `GET /api/users/:id` — Get a user's public profile (`username`, `followerCount`, `followingCount`, `recipeCount`, `createdAt`)
- `POST /api/users/:id/follow` — Follow a user (protected, idempotent)
- `DELETE /api/users/:id/follow` — Unfollow a user (protected, idempotent)
- `GET /api/users/:id/followers?limit=<n>` — List a user's followers, most recent first (`limit` defaults to 50, max 100)
- `GET /api/users/:id/following?limit=<n>` — List who a user follows, most recent first (`limit` defaults to 50, max 100)
- `GET /api/users/blocked` — List users you've blocked (protected)
- `POST /api/users/:id/block` — Block a user (protected, idempotent). Also severs any existing follow relationship between the two of you in either direction.
- `DELETE /api/users/:id/block` — Unblock a user (protected, idempotent)

Blocking (either direction) prevents following and commenting between the two users. It does not currently filter blocked users' content out of feeds or search results — that's a larger, documented follow-up, not yet built.

### **Reports**
- `POST /api/reports` — Report a recipe, user, or comment (protected). Body: `{ targetType: "recipe"|"user"|"comment", targetId, reason }`. Reports are captured for later review; there's no admin/moderation dashboard yet to act on them.

### **Recipes**
- `GET /api/recipes?page=<n>&limit=<n>&sort=<newest>` — Discover feed: all recipes ranked by trending score (shares weighted highest, then saves/comments/likes, decayed by age — matching how real platforms weight a share above a like), paginated. `page` defaults to 1, `limit` defaults to 20 (max 50). Pass `sort=newest` for plain chronological order instead. Response: `{ recipes, page, hasMore }`.
- `GET /api/recipes/feed?cursor=<recipeId>&limit=<n>` — Following feed: recipes from users you follow, newest first (protected). Cursor-paginated; `limit` defaults to 20 (max 50). Response: `{ recipes, nextCursor }`.
- `GET /api/recipes/mine?page=<n>&limit=<n>` — Get your recipes, paginated (protected). Response: `{ recipes, page, hasMore }`.
- `GET /api/recipes/user/:userId?page=<n>&limit=<n>` — Get a user's recipes, paginated. Response: `{ recipes, page, hasMore }`.
- `GET /api/recipes/tag/:tag?page=<n>&limit=<n>` — Get recipes tagged with `#tag`, paginated. Response: `{ recipes, page, hasMore, tag }`.
- `GET /api/recipes/:id` — Get a single recipe
- `POST /api/recipes` — Create a recipe (protected). Body: `{ title, instructions, category, ingredients }`, where `ingredients` is an array of `{ name, amount }`. `#hashtags` written in `instructions` are automatically parsed into the recipe's `tags` (max 30, deduped, case-insensitive) — no separate tags field to fill in.
- `PUT /api/recipes/:id` — Update your recipe (protected). Same body shape as create; `ingredients`, if provided, replaces the recipe's full ingredient list. Updating `instructions` re-parses its hashtags.
- `DELETE /api/recipes/:id` — Delete your recipe (protected)
- `GET /api/recipes/saved` — Get your saved recipes (protected)
- `POST /api/recipes/save/:recipeId` — Save a recipe (protected)
- `DELETE /api/recipes/unsave/:recipeId` — Unsave a recipe (protected)
- `POST /api/recipes/:id/media` — Upload a photo or video to your recipe (protected, multipart `file` field). A recipe holds either up to 5 photos or 1 video, never both.
- `DELETE /api/recipes/:id/media/:mediaId` — Remove a media item from your recipe (protected)
- `POST /api/recipes/:id/like` — Like a recipe (protected, idempotent)
- `DELETE /api/recipes/:id/like` — Unlike a recipe (protected, idempotent)
- `POST /api/recipes/:id/share` — Share/repost a recipe (protected, idempotent)
- `DELETE /api/recipes/:id/share` — Undo a share (protected, idempotent)
- `POST /api/recipes/:id/comments` — Comment on a recipe, or reply to a top-level comment via `parentComment` (protected)
- `GET /api/recipes/:id/comments` — List a recipe's comments
- `DELETE /api/recipes/:id/comments/:commentId` — Delete a comment (protected, comment author or recipe owner only)
- `POST /api/recipes/:id/comments/:commentId/pin` — Pin a top-level comment to the top of the list (protected, recipe owner only)
- `DELETE /api/recipes/:id/pin` — Unpin the recipe's pinned comment, if any (protected, recipe owner only)

### **Comment Likes**
- `POST /api/comments/:commentId/like` — Like a comment (protected, idempotent)
- `DELETE /api/comments/:commentId/like` — Unlike a comment (protected, idempotent)

### **Notifications**
- `GET /api/notifications?cursor=<id>&limit=<n>` — List your notifications, newest first (protected). Cursor-paginated; `limit` defaults to 20 (max 50). Response: `{ notifications, nextCursor }`.
- `GET /api/notifications/unread-count` — Get your unread notification count (protected). Response: `{ count }`.
- `POST /api/notifications/:id/read` — Mark one notification as read (protected, owner only).
- `POST /api/notifications/read-all` — Mark all of your notifications as read (protected).

Notifications are created for likes, follows, comments, replies, and shares — never for your own actions on your own content. A recipe like or share notifies the recipe's owner, a follow notifies the person followed, a top-level comment notifies the recipe's owner, and a reply notifies the parent comment's author.

### **Search**
- `GET /api/search?q=<query>&limit=<n>` — Combined search across recipe titles and usernames, case-insensitive substring match. `limit` applies to each list independently (defaults to 10, max 25). Response: `{ recipes, users }`.

### **Tags**
- `GET /api/tags/popular?limit=<n>` — Most-used hashtags across all recipes, most popular first (`limit` defaults to 20, max 50). Response: `{ tags: [{ tag, count }] }`.

### **Categories & Meals**
- `GET /api/categories` — Get static list of categories
- `GET /api/meals?search=chicken` — Search meals from TheMealDB

---

## Caching

`GET /api/recipes` (the discover/trending feed, the most expensive read in
the app — a full-collection aggregation) is cached in Redis for 60 seconds,
keyed by page and limit. That TTL is a deliberate choice, not a compromise:
the trending score is itself a live, shifting approximation (see the feed's
design doc), so a cache briefly serving a 60-second-old ranking is no less
"correct" than computing it fresh on every request. There is no write-time
cache invalidation — engagement changes the ranking gradually, and letting
the cache simply expire is standard practice for a trending feed.

Caching is entirely optional infrastructure:
- No `REDIS_URL` set → the app runs with caching disabled, no error, no
  degraded behavior beyond the discover feed hitting MongoDB every time.
- `REDIS_URL` set but unreachable → the same: every cache operation fails
  silently (logged, not thrown) and falls through to hitting MongoDB
  directly. Connection attempts use aggressive timeouts (500ms connect,
  200ms per command, 2 retries max) so a dead cache can never make a
  request slower than having no cache at all.

To enable it, provision a Redis instance (Render's Redis add-on, Upstash,
or any Redis-compatible host) and set `REDIS_URL` to its connection string.

---

## Deployment

You can deploy this backend to [Render](https://render.com/) or any Node.js hosting provider.

**Render Deployment Steps:**
1. Push your code to GitHub.
2. Create a new Web Service on Render, connect your repo.
3. Set build command: `npm install`
4. Set start command: `npm start` (do **not** use `npm run dev` in production — that runs `nodemon`, a dev-only file watcher)
5. Add environment variables (`MONGO_URI`, `JWT_SECRET`, `PORT`, `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`)
6. Deploy!

---

## License

MIT

---

## Contact

For questions or support, open an issue or contact [J-Vidale](https://github.com/J-Vidale).