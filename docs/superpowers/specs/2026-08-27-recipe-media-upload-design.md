# Recipe Media Upload — Design

## Context

RecipeHub is being built out toward an Instagram/TikTok-style experience for
recipes. Today, `Recipe` documents are text-only (title, category,
instructions, ingredients) — there is no way to attach a photo or video to a
recipe post. This is the first of four planned sub-projects toward a social
feed:

1. **Media upload** (this spec)
2. Engagement (likes + comments)
3. Social graph (follow/followers)
4. Feed endpoint (ranking/pagination)

This spec covers only #1.

## Goals

- Let a recipe owner attach media to their recipe: either up to 5 photos
  (carousel) **or** exactly 1 short video — never both on the same recipe.
- Let a recipe owner remove a media item from their recipe.
- Store media in Cloudinary, not on the backend's local disk (Render's
  filesystem is ephemeral and wipes on every redeploy/restart).
- Clean up Cloudinary assets when a recipe or a media item is deleted, so we
  don't accumulate orphaned files.

## Non-goals (explicitly out of scope for this pass)

- Direct-to-Cloudinary signed uploads from the frontend (backend-proxied
  upload is simpler and sufficient at current scale).
- Video transcoding/compression pipelines beyond what Cloudinary does
  automatically.
- Resumable/chunked uploads.
- Reordering carousel photos after upload (photos are ordered by upload
  order via an `order` field, but no reorder endpoint yet).

## Approach

Two ways to get a file into Cloudinary were considered:

- **(a) Direct-to-Cloudinary signed upload** — frontend uploads straight to
  Cloudinary using a short-lived signature the backend generates. Backend
  never touches the file bytes. Better for bandwidth/scale, but requires
  more frontend integration work (Cloudinary widget or manual signed
  upload flow) and needs its own signature-generation endpoint.
- **(b) Backend-proxied upload** *(chosen)* — frontend sends the file as
  `multipart/form-data` to the backend; the backend validates it, streams
  it to Cloudinary via the Cloudinary Node SDK, and stores the resulting
  URL. Simpler to build, test, and debug end-to-end in one pass, and keeps
  Cloudinary credentials entirely server-side.

(b) is chosen for this pass. A hard file-size cap (see Validation rules)
keeps this workable on a small Render instance even for video. (a) is a
reasonable future optimization if video traffic grows enough to matter.

## Data model changes

`models/Recipe.js` gains a `media` array:

```js
media: [
  {
    type: { type: String, enum: ["image", "video"], required: true },
    url: { type: String, required: true },       // Cloudinary secure_url
    publicId: { type: String, required: true },  // Cloudinary public_id, needed to delete the asset
    order: { type: Number, required: true },      // 0-based position, for carousel display order
  },
],
```

**Rule enforced at the controller level (not the schema):** a recipe's
`media` array contains either 1–5 items all of `type: "image"`, or exactly
1 item of `type: "video"`. Never a mix, never more than 5 photos, never more
than 1 video.

## New endpoints

Follows the existing sub-resource pattern already used for ingredients
(`POST /api/ingredients/:recipeId`).

- **`POST /api/recipes/:id/media`** — protected, owner-only. Multipart
  upload, single file per request (field name `file`). Validates against
  the rule above, uploads to Cloudinary, appends to `recipe.media`, returns
  the updated recipe.
- **`DELETE /api/recipes/:id/media/:mediaId`** — protected, owner-only.
  Deletes the asset from Cloudinary (via stored `publicId`) and removes it
  from `recipe.media`, returns the updated recipe.

## Validation rules

- Allowed image MIME types: `image/jpeg`, `image/png`, `image/webp`. Max
  8MB per image.
- Allowed video MIME types: `video/mp4`, `video/quicktime`, `video/webm`.
  Max 50MB per video (~30–60s short clip at reasonable quality).
- Reject upload with `400` if it would create a mixed image/video array,
  exceed 5 photos, or add a second video.
- Reject upload with `400` if MIME type isn't in the allowed list, or file
  exceeds its size cap.
- `multer` handles multipart parsing with **memory storage** (buffer, not
  disk) — the buffer is streamed straight to Cloudinary via
  `cloudinary.uploader.upload_stream` (using `streamifier` to turn the
  buffer into a readable stream), so nothing touches the ephemeral disk.

## Existing code that needs updating

- **`deleteRecipe`** (`controllers/recipeController.js`) currently deletes
  the recipe's ingredients but does nothing with media. It will be updated
  to also delete every Cloudinary asset referenced in `recipe.media` before
  removing the recipe document, so deleting a recipe doesn't leave orphaned
  files in Cloudinary.
- **`getAllRecipes` / `getSingleRecipe` / `getMyRecipes` / `getRecipesByUser`**
  need no changes — `media` is just part of the document and will be
  returned automatically once it's in the schema.

## New configuration

- **New file** `config/cloudinary.js` — configures the Cloudinary SDK from
  env vars.
- **New env vars** (documented in README): `CLOUDINARY_CLOUD_NAME`,
  `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`.
- **New dependencies**: `cloudinary`, `multer`, `streamifier`.

## Error handling

- Multer errors (file too large, unexpected field) are caught and turned
  into a `400` with a clear message rather than falling through to the
  generic 500 handler.
- Cloudinary upload failures return `502` with a generic "media upload
  failed" message (raw Cloudinary error only in non-production, matching
  the existing pattern in `authController.js`).
- Ownership check (`recipe.user.toString() !== req.user._id.toString()`)
  reused from the existing pattern in `updateRecipe`/`deleteRecipe`.

## Testing

No test framework exists in this repo yet (no Jest/Mocha configured), so
verification for this pass is manual: start the server locally, exercise
both endpoints with `curl`/Postman against a real Cloudinary account
(free tier), and confirm assets appear/disappear in the Cloudinary
dashboard as expected. Adding a test framework is out of scope for this
spec.

## Frontend impact (not built in this pass, noted for context)

The frontend repo (`recipehub-frontend`) will eventually need an upload UI
on the create/edit recipe pages and to render `recipe.media` on recipe
cards/detail pages. Not part of this backend spec, but the API shape above
is designed to be straightforward to consume from `src/services/api.js`.
