// config/redis.js
import Redis from "ioredis";

// Caching is optional infrastructure, not a hard dependency - the app must
// boot and serve every request correctly with zero Redis configured. If
// REDIS_URL isn't set, redisClient stays null and every cache read/write
// in utils/cache.js becomes a silent no-op.
let redisClient = null;

if (process.env.REDIS_URL) {
  redisClient = new Redis(process.env.REDIS_URL, {
    // Fail fast rather than hanging a request behind a slow/dead cache -
    // a cache is only worth having if it can never make things slower
    // than not having one.
    connectTimeout: 500,
    commandTimeout: 200,
    maxRetriesPerRequest: 1,
    retryStrategy: (times) => (times > 2 ? null : 50),
    enableOfflineQueue: false,
    lazyConnect: false,
  });

  redisClient.on("error", (err) => {
    console.error("Redis error (caching disabled for this request):", err.message);
  });
  redisClient.on("connect", () => {
    console.log("Redis connected - caching enabled");
  });
} else {
  console.log("REDIS_URL not set - caching disabled, running without a cache layer");
}

export default redisClient;
