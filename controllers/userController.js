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

// Admin: Edit user details (email, plan, status, etc.)
export const adminEditUser = async (req, res) => {
  try {
    const { id } = req.params; // Mongo _id or clerkUserId
    const updates = req.body; // { email, plan, status, ... }
    // Only allow valid plan values
    if (updates.plan && !['Free', 'Premium', 'Inactive'].includes(updates.plan)) {
      return res.status(400).json({ message: 'Invalid plan' });
    }
    // Remove fields not in schema
    const allowed = ['email', 'plan'];
    const filteredUpdates = Object.fromEntries(Object.entries(updates).filter(([k]) => allowed.includes(k)));
    let user = await User.findByIdAndUpdate(id, filteredUpdates, { new: true });
    if (!user) {
      user = await User.findOneAndUpdate({ clerkUserId: id }, filteredUpdates, { new: true });
    }
    if (!user) return res.status(404).json({ message: 'User not found' });
    res.json({ success: true, user });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
