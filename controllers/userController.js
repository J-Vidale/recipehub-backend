import User from '../models/User.js';

// Get logged-in user info
export const getMe = async (req, res) => {
  const user = await User.findById(req.user.id).select('-password');
  res.json(user);
};
