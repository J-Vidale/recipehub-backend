// middleware/uploadMiddleware.js
import multer from "multer";

export const ALLOWED_MIME_TYPES = {
  "image/jpeg": "image",
  "image/png": "image",
  "image/webp": "image",
  "video/mp4": "video",
  "video/quicktime": "video",
  "video/webm": "video",
};

export const MAX_IMAGE_BYTES = 8 * 1024 * 1024; // 8MB
export const MAX_VIDEO_BYTES = 50 * 1024 * 1024; // 50MB

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_VIDEO_BYTES }, // hard ceiling; per-type limit enforced in the controller
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_MIME_TYPES[file.mimetype]) {
      return cb(new Error("Unsupported file type"));
    }
    cb(null, true);
  },
}).single("file");

// Wraps multer so its errors (file too large, wrong type) become a 400
// instead of falling through to the generic 500 error handler.
export const uploadSingleMedia = (req, res, next) => {
  upload(req, res, (err) => {
    if (err) {
      return res.status(400).json({ message: err.message });
    }
    next();
  });
};
