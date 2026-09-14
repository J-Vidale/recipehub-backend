// middleware/adminMiddleware.js

/**
 * Who may moderate.
 *
 * Read from the environment rather than stored on the user, on purpose.
 * A flag in the database is one bad write away from being set by someone
 * who should not have it - a mass-assignment bug in any endpoint that
 * touches a user document would be enough - and there is no safe way to
 * grant the first one through an API that does not already have an admin.
 * An environment variable has neither problem: nothing a request can do
 * changes it, and the person who owns the deployment sets it.
 *
 * ADMIN_USERNAMES is a comma-separated list. Unset means nobody, which is
 * the right default: an empty list locks the door, it does not leave it
 * open.
 */
export const adminUsernames = (env = process.env) =>
  (env.ADMIN_USERNAMES || "")
    .split(",")
    .map((name) => name.trim().toLowerCase())
    .filter(Boolean);

/**
 * Whether this user moderates. Compared case-insensitively, because
 * usernames are unique case-insensitively everywhere else in this app -
 * see the collation on the username index - and an admin list that cared
 * about case would be a trap nobody would think to look for.
 */
export const isAdmin = (user, env = process.env) => {
  const name = user?.username;
  if (typeof name !== "string" || !name) return false;
  return adminUsernames(env).includes(name.trim().toLowerCase());
};

/**
 * Mount after protect(), which is what puts req.user there.
 *
 * Answers 404 rather than 403. A 403 confirms the route exists and that
 * somebody is allowed to use it, which is a free hint to anyone probing;
 * to a caller who is not a moderator, a moderation endpoint may as well
 * not be there.
 */
export const requireAdmin = (req, res, next) => {
  if (!isAdmin(req.user)) {
    return res.status(404).json({ message: "Not found" });
  }
  next();
};
