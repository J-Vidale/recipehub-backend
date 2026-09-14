// utils/tokenFreshness.js
//
// Whether a token was minted before its owner last changed their password.
//
// Changing a password is how someone takes an account back, so every token
// issued before that moment has to stop working - not just the ones
// presented to the HTTP API. This lives here rather than inside the auth
// middleware because the socket handshake needs the same rule, and a
// config module importing an Express middleware to get at it would be the
// wrong shape.
//
// The save hook stamps passwordChangedAt a second in the past on purpose:
// a JWT's iat is whole seconds, so a token minted in the same second as
// the change would otherwise be rejected - including the replacement one
// handed back to the person who just changed it.
export const mintedBeforePasswordChange = (decoded, user) => {
  if (!user?.passwordChangedAt || !decoded?.iat) return false;
  return decoded.iat * 1000 < new Date(user.passwordChangedAt).getTime();
};
