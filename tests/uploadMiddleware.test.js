import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import request from "supertest";
import {
  uploadSingleImage,
  uploadSingleMedia,
  MAX_IMAGE_BYTES,
} from "../middleware/uploadMiddleware.js";

const MB = 1024 * 1024;

const appWith = (middleware) => {
  const app = express();
  app.post("/upload", middleware, (req, res) =>
    res.json({ accepted: true, size: req.file?.size, mime: req.file?.mimetype })
  );
  return app;
};

let imageApp;
let mediaApp;

beforeAll(() => {
  imageApp = appWith(uploadSingleImage);
  mediaApp = appWith(uploadSingleMedia);
});

afterAll(() => {});

const post = (app, { mime, bytes, name = "file" }) =>
  request(app)
    .post("/upload")
    .attach("file", Buffer.alloc(bytes), { filename: name, contentType: mime });

describe("the avatar route accepts images only", () => {
  // Sharing the general media filter here meant a 50MB video was accepted
  // by multer and buffered into memory in full before the handler rejected
  // it for being the wrong type.
  it("rejects a video before reading it", async () => {
    const res = await post(imageApp, { mime: "video/mp4", bytes: 1 * MB, name: "clip.mp4" });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/image/i);
  });

  it("rejects an image over the 8MB image ceiling", async () => {
    const res = await post(imageApp, { mime: "image/png", bytes: 9 * MB, name: "big.png" });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/8MB/);
  });

  it("accepts a normal avatar", async () => {
    const res = await post(imageApp, { mime: "image/jpeg", bytes: 64 * 1024, name: "me.jpg" });
    expect(res.status).toBe(200);
    expect(res.body.accepted).toBe(true);
    expect(res.body.mime).toBe("image/jpeg");
  });

  it.each(["image/jpeg", "image/png", "image/webp"])("accepts %s", async (mime) => {
    const res = await post(imageApp, { mime, bytes: 1024 });
    expect(res.status).toBe(200);
  });

  it("rejects a type that is not on the allow list at all", async () => {
    const res = await post(imageApp, { mime: "application/pdf", bytes: 1024, name: "doc.pdf" });
    expect(res.status).toBe(400);
  });
});

describe("the recipe media route still takes video", () => {
  it("accepts an mp4", async () => {
    const res = await post(mediaApp, { mime: "video/mp4", bytes: 1 * MB, name: "clip.mp4" });
    expect(res.status).toBe(200);
    expect(res.body.accepted).toBe(true);
  });

  it("still enforces the image ceiling for images", async () => {
    const res = await post(mediaApp, { mime: "image/png", bytes: 9 * MB, name: "big.png" });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/8MB/);
  });
});

describe("multer errors become 400s, not 500s", () => {
  it("returns a JSON message rather than falling through to the error handler", async () => {
    const res = await post(imageApp, { mime: "video/quicktime", bytes: 2048, name: "x.mov" });
    expect(res.status).toBe(400);
    expect(res.headers["content-type"]).toMatch(/json/);
    expect(typeof res.body.message).toBe("string");
  });
});

describe("limits", () => {
  it("exports an 8MB image ceiling", () => {
    expect(MAX_IMAGE_BYTES).toBe(8 * MB);
  });
});
