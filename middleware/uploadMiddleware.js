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

// Enforces the per-type size limit while the file is still streaming in,
// so an oversized image is rejected as soon as it crosses 8MB instead of
// being fully buffered up to the (larger) video ceiling first.
class LimitedMemoryStorage {
  _handleFile(req, file, cb) {
    const mediaType = ALLOWED_MIME_TYPES[file.mimetype];
    const limit = mediaType === "video" ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
    const chunks = [];
    let size = 0;
    let settled = false;

    const finish = (err, result) => {
      if (settled) return;
      settled = true;
      cb(err, result);
    };

    file.stream.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        file.stream.destroy();
        finish(
          new Error(
            `File exceeds the ${Math.round(limit / (1024 * 1024))}MB limit for this file type`
          )
        );
        return;
      }
      chunks.push(chunk);
    });

    file.stream.on("end", () => {
      finish(null, { buffer: Buffer.concat(chunks), size });
    });

    file.stream.on("error", (err) => {
      finish(err);
    });
  }

  _removeFile(req, file, cb) {
    cb(null);
  }
}

const upload = multer({
  storage: new LimitedMemoryStorage(),
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_MIME_TYPES[file.mimetype]) {
      return cb(new Error("Unsupported file type"));
    }
    cb(null, true);
  },
}).single("file");

// Images only, for routes where a video is never valid (avatars). Sharing
// the media filter there meant a 50MB mp4 was accepted by multer and fully
// buffered into memory before the handler rejected it for being the wrong
// type; here it is refused on the first chunk at the 8MB image ceiling.
const uploadImage = multer({
  storage: new LimitedMemoryStorage(),
  fileFilter: (req, file, cb) => {
    if (ALLOWED_MIME_TYPES[file.mimetype] !== "image") {
      return cb(new Error("Only JPEG, PNG or WebP images are allowed"));
    }
    cb(null, true);
  },
}).single("file");

// Wraps multer so its errors (file too large, wrong type) become a 400
// instead of falling through to the generic 500 error handler.
const handleUploadErrors = (runUpload) => (req, res, next) => {
  runUpload(req, res, (err) => {
    if (err) {
      return res.status(400).json({ message: err.message });
    }
    next();
  });
};

export const uploadSingleMedia = handleUploadErrors(upload);
export const uploadSingleImage = handleUploadErrors(uploadImage);
