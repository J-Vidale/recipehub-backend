# RecipeHub Backend

This is the backend API for **RecipeHub**, a MERN stack recipe sharing application.

---

## Features

- User registration and login with JWT authentication
- Create, update, delete your own recipes
- Add ingredients to recipes
- Like/unlike recipes and comments, comment on recipes (with one level of replies), pin your favorite comment
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
```

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

### **Recipes**
- `GET /api/recipes` — Get all recipes
- `GET /api/recipes/mine` — Get your recipes (protected)
- `GET /api/recipes/:id` — Get a single recipe (protected)
- `POST /api/recipes` — Create a recipe (protected)
- `PUT /api/recipes/:id` — Update your recipe (protected)
- `DELETE /api/recipes/:id` — Delete your recipe (protected)
- `GET /api/recipes/saved` — Get your saved recipes (protected)
- `POST /api/recipes/save/:recipeId` — Save a recipe (protected)
- `DELETE /api/recipes/unsave/:recipeId` — Unsave a recipe (protected)
- `POST /api/recipes/:id/like` — Like a recipe (protected, idempotent)
- `DELETE /api/recipes/:id/like` — Unlike a recipe (protected, idempotent)
- `POST /api/recipes/:id/comments` — Comment on a recipe, or reply to a top-level comment via `parentComment` (protected)
- `GET /api/recipes/:id/comments` — List a recipe's comments
- `DELETE /api/recipes/:id/comments/:commentId` — Delete a comment (protected, comment author or recipe owner only)
- `POST /api/recipes/:id/comments/:commentId/pin` — Pin a top-level comment to the top of the list (protected, recipe owner only)
- `DELETE /api/recipes/:id/pin` — Unpin the recipe's pinned comment, if any (protected, recipe owner only)

### **Comment Likes**
- `POST /api/comments/:commentId/like` — Like a comment (protected, idempotent)
- `DELETE /api/comments/:commentId/like` — Unlike a comment (protected, idempotent)

### **Ingredients**
- `POST /api/ingredients/:recipeId` — Add ingredient to recipe (protected)
- `PUT /api/ingredients/:id` — Update ingredient (protected)
- `DELETE /api/ingredients/:id` — Delete ingredient (protected)

### **Categories & Meals**
- `GET /api/categories` — Get static list of categories
- `GET /api/meals?search=chicken` — Search meals from TheMealDB

---

## Deployment

You can deploy this backend to [Render](https://render.com/) or any Node.js hosting provider.

**Render Deployment Steps:**
1. Push your code to GitHub.
2. Create a new Web Service on Render, connect your repo.
3. Set build command: `npm install`
4. Set start command: `npm run dev` or `node server.js`
5. Add environment variables (`MONGO_URI`, `JWT_SECRET`, `PORT`)
6. Deploy!

---

## License

MIT

---

## Contact

For questions or support, open an issue or contact [J-Vidale](https://github.com/J-Vidale).