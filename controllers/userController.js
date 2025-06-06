import User from '../models/User.js';

export const getAllUsers = async (req, res) => {
  try {
    const users = await User.find({}, 'clerkUserId email plan createdAt updatedAt');
    res.json({ users });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

export const updateUserPlan = async (req, res) => {
  try {
    const { plan } = req.body;
    if (!['Free', 'Premium'].includes(plan)) return res.status(400).json({ message: 'Invalid plan' });
    const user = await User.findOneAndUpdate(
      { clerkUserId: req.params.clerkUserId },
      { plan },
      { new: true }
    );
    if (!user) return res.status(404).json({ message: 'User not found' });
    res.json({ user });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
