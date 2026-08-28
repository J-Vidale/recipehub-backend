// utils/parseHashtags.js
// Extracts #hashtags from free text (recipe instructions), the same way a
// real platform pulls tags out of a caption rather than requiring a
// separate structured input. Caps at 30 tags per post, matching Instagram's
// real-world limit, to keep this from being an abuse/storage vector.
const MAX_TAGS = 30;
const HASHTAG_PATTERN = /#([a-z0-9_]{1,50})/gi;

export const parseHashtags = (text) => {
  if (typeof text !== "string") return [];
  const matches = text.matchAll(HASHTAG_PATTERN);
  const tags = new Set();
  for (const match of matches) {
    tags.add(match[1].toLowerCase());
    if (tags.size >= MAX_TAGS) break;
  }
  return [...tags];
};
