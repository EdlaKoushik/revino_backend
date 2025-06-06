import User from '../models/User.js';

export const clerkWebhook = async (req, res) => {
  try {
    const event = req.body;
    console.log('Clerk webhook received:', JSON.stringify(event));
    if (event.type === 'user.created') {
      const { id, email_addresses } = event.data;
      const email = email_addresses?.[0]?.email_address;
      if (id && email) {
        let user = await User.findOne({ clerkUserId: id });
        if (!user) {
          await User.create({ clerkUserId: id, email });
          console.log('User created in MongoDB:', id, email);
        } else {
          console.log('User already exists in MongoDB:', id);
        }
      } else {
        console.error('Missing id or email in Clerk webhook event:', event);
      }
    }
    res.status(200).json({ received: true });
  } catch (err) {
    console.error('Error handling Clerk webhook:', err);
    res.status(500).json({ error: err.message });
  }
};
