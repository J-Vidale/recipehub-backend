// utils/cache.js
import redisClient from "../config/redis.js";

const PREFIX = "cache:";

// Every function here is a safe no-op when Redis isn't configured or is
// unreachable - a cache failure must never surface as a request failure.

export const getCached = async (key) => {
  if (!redisClient) return null;
  try {
    const value = await redisClient.get(PREFIX + key);
    return value ? JSON.parse(value) : null;
  } catch (err) {
    console.error("Cache read failed:", err.message);
    return null;
  }
};

export const setCached = async (key, value, ttlSeconds) => {
  if (!redisClient) return;
  try {
    await redisClient.set(PREFIX + key, JSON.stringify(value), "EX", ttlSeconds);
  } catch (err) {
    console.error("Cache write failed:", err.message);
  }
};
