import jwt from 'jsonwebtoken';
import User from '../models/User.js';
// A token minted before the password changed is no longer good. Tokens are
// stateless and last a week, so without this a password change left every
// session that already existed still working - including the one whose
// existence prompted the change. Shared with the socket handshake, which
// has to apply the same rule.
import { mintedBeforePasswordChange } from '../utils/tokenFreshness.js';

export const protect = async (req, res, next) => {
  let token = req.headers.authorization?.startsWith('Bearer')
    ? req.headers.authorization.split(' ')[1]
    : null;

  if (!token) return res.status(401).json({ message: 'Not authorized, no token' });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = await User.findById(decoded.id).select('-password').lean();
    if (!req.user) {
      return res.status(401).json({ message: 'User not found' });
    }
    if (mintedBeforePasswordChange(decoded, req.user)) {
      return res.status(401).json({ message: 'Session ended. Please log in again.' });
    }
    next();
  } catch (err) {
    res.status(401).json({ message: 'Invalid token' });
  }
};

// Populates req.user when a valid token is present, but never blocks the
// request — for endpoints that are public but behave differently for a
// logged-in viewer (e.g. "do I already follow this person").
export const optionalAuth = async (req, res, next) => {
  const token = req.headers.authorization?.startsWith('Bearer')
    ? req.headers.authorization.split(' ')[1]
    : null;

  if (!token) return next();

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id).select('-password').lean();
    // Same rule on the public endpoints: a stale token should not keep
    // reporting a viewer, or "do I follow this person" would still answer
    // for a session that has been ended.
    if (user && !mintedBeforePasswordChange(decoded, user)) {
      req.user = user;
    }
  } catch (err) {
    // Invalid/expired token on a public endpoint — proceed as a guest.
  }
  next();
};