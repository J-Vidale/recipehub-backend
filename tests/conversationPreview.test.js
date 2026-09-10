import { describe, it, expect, vi, afterEach } from "vitest";
import { previewOf, MAX_PREVIEW_LENGTH } from "../controllers/messageController.js";

// The conversation list shows one line per row, sorted by lastMessageAt.
// Two things were wrong with how that row got written.
//
// It was a read-modify-write: two messages arriving close together both
// loaded the conversation, both set the preview, and whichever saved last
// won - which could be the older of the two, putting a stale line at the
// wrong place in the list. It is a conditional update now, and only ever
// moves the preview forward.
//
// And it stored the whole message. A message can be 2000 characters and a
// page can hold 50 conversations, so a list response carried tens of
// kilobytes of message bodies to render a few words each.

afterEach(() => vi.restoreAllMocks());

describe("the preview text", () => {
  it("leaves a short message alone", () => {
    expect(previewOf("Dinner at eight?")).toBe("Dinner at eight?");
  });

  it("keeps a message at the limit whole", () => {
    const exact = "x".repeat(MAX_PREVIEW_LENGTH);
    expect(previewOf(exact)).toBe(exact);
  });

  it("cuts a long one down and says it was cut", () => {
    const long = "x".repeat(MAX_PREVIEW_LENGTH + 500);
    const preview = previewOf(long);
    expect(preview).toHaveLength(MAX_PREVIEW_LENGTH);
    expect(preview.endsWith("…")).toBe(true);
  });

  it("does not leave a space before the ellipsis", () => {
    const long = `${"word ".repeat(60)}end`;
    const preview = previewOf(long);
    expect(preview).not.toMatch(/ …$/);
  });

  it("is far smaller than a message is allowed to be", () => {
    // The message cap is 2000. If the preview cap ever creeps up to meet
    // it, the saving this was written for is gone.
    expect(MAX_PREVIEW_LENGTH).toBeLessThan(500);
  });
});

describe("the conditional that writes it", () => {
  it("only moves the preview forward", async () => {
    const { readFile } = await import("node:fs/promises");
    const source = await readFile(new URL("../controllers/messageController.js", import.meta.url), "utf8");
    expect(source).toMatch(/lastMessageAt: \{ \$lte: message\.createdAt \}/);
    // The read-modify-write it replaced.
    expect(source).not.toMatch(/conversation\.lastMessageText\s*=/);
    expect(source).not.toMatch(/await conversation\.save\(\)/);
  });

  it("lets a first message through on a fresh conversation", async () => {
    // lastMessageAt defaults to the conversation's own creation time, so
    // $lt would turn away a message sent in the same millisecond and the
    // conversation would sit in the list with no preview at all.
    const { readFile } = await import("node:fs/promises");
    const source = await readFile(new URL("../controllers/messageController.js", import.meta.url), "utf8");
    expect(source).not.toMatch(/lastMessageAt: \{ \$lt: message\.createdAt \}/);
  });
});
