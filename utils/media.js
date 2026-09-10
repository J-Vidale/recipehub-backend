// utils/media.js
import cloudinary from "../config/cloudinary.js";

/**
 * Delete an asset from Cloudinary, and never let that failure become the
 * caller's failure.
 *
 * The reason this needs to exist: cloudinary.uploader.destroy *throws*
 * rather than returning a rejected promise when the credentials are
 * missing - "Must supply api_key". A synchronous throw happens before
 * .catch() can be attached and before Promise.allSettled ever sees the
 * value, so both of the shapes previously used for this were no protection
 * at all. With Cloudinary unset or misconfigured, deleting a recipe or
 * changing an avatar failed outright, having already written the change to
 * the database - the opposite of the best-effort cleanup they were
 * written to be.
 *
 * Callers that genuinely need to know the asset is gone - deleting one
 * image from a recipe, where leaving the row behind would be wrong -
 * should call Cloudinary directly and handle the error.
 *
 * @param {string} publicId
 * @param {"image"|"video"} resourceType
 * @returns {Promise<boolean>} whether the asset was deleted, for logging.
 */
export const destroyQuietly = async (publicId, resourceType = "image") => {
  if (!publicId) return false;
  try {
    await cloudinary.uploader.destroy(publicId, { resource_type: resourceType });
    return true;
  } catch (error) {
    // Worth a line in the log - it leaves an asset behind and costs
    // storage - but never worth failing the request that is already done.
    console.error(`Could not remove ${publicId} from Cloudinary: ${error.message}`);
    return false;
  }
};
