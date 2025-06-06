import User from '../models/User.js';
import jwt from 'jsonwebtoken';

export const requirePremium = async (req, res, next) => {
  try {
    let token = req.headers['authorization'];
    if (token && token.startsWith('Bearer ')) token = token.slice(7);
    let userId = null;
    if (token) {
      try {
        const decoded = jwt.decode(token);
        userId = decoded?.sub || decoded?.id || null;
      } catch {}
    }
    userId = userId || req.user?.id || req.user?._id || req.body.userId || req.query.userId;
    if (!userId) return res.status(401).json({ message: 'Not authenticated' });
    const user = await User.findOne({ clerkUserId: userId });
    if (!user) return res.status(404).json({ message: 'User not found' });
    if (user.plan !== 'Premium') {
      return res.status(403).json({ message: 'Premium plan required for this feature.' });
    }
    req.user = user;
    next();
  } catch (err) {
    res.status(500).json({ message: 'Premium check failed', error: err.message });
  }
};
