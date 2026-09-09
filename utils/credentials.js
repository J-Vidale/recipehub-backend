// What counts as a usable username, email and password.
//
// Registration checked three things: that the fields were strings, that
// none was empty, and that the password was at least six characters. That
// left a username of ten thousand characters, or one made of zero-width
// joiners, or an email that is not an email, all perfectly acceptable.
//
// Kept separate from the controller so the rules can be read and tested
// without an HTTP request or a database.

export const MIN_USERNAME_LENGTH = 3;
export const MAX_USERNAME_LENGTH = 30;

// Deliberately narrow. A username is a handle, not a display name: it goes
// in URLs, in @mentions and in sentences like "follow marta". Allowing the
// whole of Unicode there means allowing characters that render as nothing
// (zero-width joiners) or exactly like other characters (Cyrillic а for
// Latin a), which is how one account gets to look like another.
const USERNAME_SHAPE = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;

export const MIN_PASSWORD_LENGTH = 6;
// bcrypt only reads the first 72 bytes, so a longer password is not a
// stronger one - but hashing it still costs, and the request body can hold
// a hundred kilobytes.
export const MAX_PASSWORD_LENGTH = 128;

// Not RFC 5322. Anything claiming to validate an address properly with a
// regex is wrong, and the only real check is sending mail to it. This
// rejects what is plainly not an address and nothing more.
const EMAIL_SHAPE = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;
const MAX_EMAIL_LENGTH = 254; // the longest a mailbox address may be

export const validateUsername = (value) => {
  if (typeof value !== "string") return "Username is required";
  const username = value.trim();
  if (!username) return "Username is required";
  if (username.length < MIN_USERNAME_LENGTH) {
    return `Username must be at least ${MIN_USERNAME_LENGTH} characters`;
  }
  if (username.length > MAX_USERNAME_LENGTH) {
    return `Username must be ${MAX_USERNAME_LENGTH} characters or fewer`;
  }
  if (!USERNAME_SHAPE.test(username)) {
    return "Username can use letters, numbers, and . _ - and must start with a letter or number";
  }
  return null;
};

export const validateEmail = (value) => {
  if (typeof value !== "string") return "Email is required";
  const email = value.trim();
  if (!email) return "Email is required";
  if (email.length > MAX_EMAIL_LENGTH) return "Email address is too long";
  if (!EMAIL_SHAPE.test(email)) return "Enter a valid email address";
  return null;
};

export const validatePassword = (value) => {
  if (typeof value !== "string" || !value) return "Password is required";
  if (value.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters`;
  }
  if (value.length > MAX_PASSWORD_LENGTH) {
    return `Password must be ${MAX_PASSWORD_LENGTH} characters or fewer`;
  }
  return null;
};
