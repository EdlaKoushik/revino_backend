import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import dotenv from 'dotenv';
// ⬇️ Switch to Together AI generator
import { generateQuestions } from './utils/together.js';
import multer from 'multer';
import axios from 'axios';
import Stripe from 'stripe';
// Import InterviewSession model from models directory
import interviewSessionSchema from './models/InterviewSession.js';
// User model
import User from './models/User.js';
import bodyParser from 'body-parser';
import ScheduledMock from './models/ScheduledMock.js';
import nodemailer from 'nodemailer';
import nodeCron from 'node-cron';
import jwt from 'jsonwebtoken';

dotenv.config();

const app = express();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Middleware
app.use(cors({
  origin: [
    'http://localhost:5174',
    'http://localhost:5173',
    'https://revino-frontend.vercel.app',
    'https://revino-frontend-7zy9x2ocr-edlakoushiks-projects.vercel.app'
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());
app.use('/api/stripe/webhook', bodyParser.raw({ type: 'application/json' }));
// Parse Clerk webhook JSON
app.use('/api/clerk/webhook', express.json());

// MongoDB connection
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('MongoDB connected'))
  .catch((err) => console.error('MongoDB connection error:', err));

// Use the imported schema for the InterviewSession model
const InterviewSession = mongoose.model('InterviewSession', interviewSessionSchema);

// Multer setup for audio and video uploads
const upload = multer({ storage: multer.memoryStorage() });

// --- Premium Middleware ---
// Middleware to check if user is premium
export const requirePremium = async (req, res, next) => {
  try {
    // Accept JWT or Clerk Auth header
    let token = req.headers['authorization'];
    if (token && token.startsWith('Bearer ')) token = token.slice(7);
    let userId = null;
    if (token) {
      try {
        // Try Clerk JWT
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

// --- Example: Protect a premium-only route ---
// app.get('/api/premium/feature', requirePremium, async (req, res) => {
//   res.json({ message: 'You have access to premium features!' });
// });

// --- Admin API: Live Users & Plans ---
app.get('/api/admin/users', async (req, res) => {
  try {
    // TODO: Add admin auth check
    const users = await User.find({}, 'clerkUserId email plan createdAt updatedAt');
    res.json({ users });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// --- Admin API: Update User Plan ---
app.post('/api/admin/user/:clerkUserId/plan', async (req, res) => {
  try {
    // TODO: Add admin auth check
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
});

// --- Add user plan endpoint for frontend gating ---
app.get('/api/user/plan', async (req, res) => {
  try {
    const { clerkUserId } = req.query;
    if (!clerkUserId) return res.status(400).json({ message: 'Missing user id' });
    const user = await User.findOne({ clerkUserId });
    if (!user) return res.status(404).json({ message: 'User not found' });
    res.json({ plan: user.plan });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Routes
app.get('/', (req, res) => {
  res.json({ message: 'AI Interview Prep API is running' });
});

// Register routes
import interviewRoutes from './routes/interviewRoutes.js';
import userRoutes from './routes/userRoutes.js';
import webhookRoutes from './routes/webhookRoutes.js';

app.use('/api/interview', interviewRoutes);
app.use('/api', userRoutes);
app.use('/api', webhookRoutes);

// Whisper transcription endpoint
app.post('/api/interview/transcribe', upload.single('audio'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No audio file uploaded.' });
    }
    // Call OpenAI Whisper API
    const openaiApiKey = process.env.OPENAI_API_KEY;
    if (!openaiApiKey) {
      return res.status(500).json({ message: 'OpenAI API key not set.' });
    }
    const formData = new FormData();
    formData.append('file', req.file.buffer, {
      filename: req.file.originalname || 'audio.webm',
      contentType: req.file.mimetype || 'audio/webm',
    });
    formData.append('model', 'whisper-1');
    // Optionally: language, prompt, etc.
    const response = await axios.post(
      'https://api.openai.com/v1/audio/transcriptions',
      formData,
      {
        headers: {
          ...formData.getHeaders(),
          Authorization: `Bearer ${openaiApiKey}`,
        },
        maxBodyLength: Infinity,
      }
    );
    res.json({ text: response.data.text });
  } catch (err) {
    console.error('Whisper transcription error:', err.response?.data || err.message);
    res.status(500).json({ message: 'Transcription failed', error: err.response?.data || err.message });
  }
});

// Stripe Checkout session endpoint
app.post('/api/stripe/create-checkout-session', async (req, res) => {
  try {
    const { clerkUserId, email } = req.body;
    if (!clerkUserId || !email) {
      return res.status(400).json({ message: 'Missing user info' });
    }
    // Find or create user
    let user = await User.findOne({ clerkUserId });
    if (!user) {
      user = await User.create({ clerkUserId, email });
    }
    // Create Stripe customer if not exists
    let customerId = user.stripeCustomerId;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email,
        metadata: { clerkUserId },
      });
      customerId = customer.id;
      user.stripeCustomerId = customerId;
      await user.save();
    }
    // Create Stripe Checkout session for subscription
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'subscription',
      customer: customerId,
      line_items: [
        {
          price: process.env.STRIPE_PREMIUM_PRICE_ID, // Set this in your .env
          quantity: 1,
        },
      ],
      success_url: `${process.env.FRONTEND_URL}/upgrade?success=1`,
      cancel_url: `${process.env.FRONTEND_URL}/upgrade?canceled=1`,
      metadata: { clerkUserId },
    });
    res.json({ url: session.url });
  } catch (err) {
    console.error('Stripe checkout error:', err);
    res.status(500).json({ message: err.message });
  }
});

app.post('/api/stripe/webhook', async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object;
      const clerkUserId = session.metadata?.clerkUserId;
      if (clerkUserId) {
        await User.findOneAndUpdate(
          { clerkUserId },
          { plan: 'Premium', stripeSubscriptionId: session.subscription },
          { new: true }
        );
      }
      break;
    }
    case 'customer.subscription.deleted':
    case 'customer.subscription.updated': {
      const subscription = event.data.object;
      const customerId = subscription.customer;
      const user = await User.findOne({ stripeCustomerId: customerId });
      if (user) {
        if (subscription.status === 'active' || subscription.status === 'trialing') {
          user.plan = 'Premium';
        } else {
          user.plan = 'Free';
        }
        user.stripeSubscriptionId = subscription.id;
        await user.save();
      }
      break;
    }
    default:
      break;
  }
  res.json({ received: true });
});

// Get all invoices for the logged-in user (Premium)
app.get('/api/stripe/invoices', async (req, res) => {
  try {
    const { clerkUserId } = req.query;
    if (!clerkUserId) return res.status(400).json({ message: 'Missing user id' });
    const user = await User.findOne({ clerkUserId });
    if (!user || !user.stripeCustomerId) return res.status(404).json({ message: 'User or Stripe customer not found' });
    const invoices = await stripe.invoices.list({ customer: user.stripeCustomerId, limit: 20 });
    res.json({ invoices: invoices.data });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Download invoice PDF by invoice id
app.get('/api/stripe/invoice/:invoiceId/pdf', async (req, res) => {
  try {
    const invoiceId = req.params.invoiceId;
    const invoice = await stripe.invoices.retrieve(invoiceId);
    if (!invoice || !invoice.invoice_pdf) return res.status(404).json({ message: 'Invoice not found or not available as PDF' });
    res.redirect(invoice.invoice_pdf);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Delete interview session by id (user only)
app.delete('/api/interview/:id', async (req, res) => {
  try {
    const interview = await InterviewSession.findById(req.params.id);
    if (!interview) {
      return res.status(404).json({ message: 'Interview not found' });
    }
    // Optionally: check user ownership here
    await InterviewSession.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Fetch all unique resumes and job descriptions for a user
app.get('/api/interview/past-materials', async (req, res) => {
  try {
    const { userId } = req.query;
    if (!userId) return res.status(400).json({ message: 'Missing userId' });
    const sessions = await InterviewSession.find({ userId });
    // Only return unique, non-empty resumes and job descriptions
    const resumes = Array.from(new Set(sessions.map(s => s.resumeText).filter(Boolean)));
    const jobDescs = Array.from(new Set(sessions.map(s => s.jobDescription).filter(Boolean)));
    res.json({ resumes, jobDescs });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Schedule a new mock interview (with all interview details)
app.post('/api/schedule-mock', async (req, res) => {
  try {
    const { userId, email, scheduledFor, mode, jobRole, industry, experience, resumeText, jobDescription } = req.body;
    if (!userId || !email || !scheduledFor) {
      return res.status(400).json({ message: 'Missing required fields' });
    }
    const dateObj = new Date(scheduledFor);
    if (isNaN(dateObj.getTime())) {
      return res.status(400).json({ message: 'Invalid date for scheduledFor' });
    }
    const scheduled = await ScheduledMock.create({
      userId, email, scheduledFor: dateObj, mode, jobRole, industry, experience, resumeText, jobDescription
    });
    // Send immediate confirmation email
    await sendMockEmail(email, dateObj, 'confirmation');
    res.status(201).json({ success: true, scheduled });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Get all scheduled mocks for a user
app.get('/api/schedule-mock', async (req, res) => {
  try {
    const { userId } = req.query;
    if (!userId) return res.status(400).json({ message: 'Missing userId' });
    const mocks = await ScheduledMock.find({ userId }).sort({ scheduledFor: 1 });
    res.json({ mocks });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Delete scheduled mock by id
app.delete('/api/schedule-mock/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const deleted = await ScheduledMock.findByIdAndDelete(id);
    if (!deleted) {
      return res.status(404).json({ message: 'Scheduled mock not found' });
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Nodemailer setup (configure with your SMTP credentials)
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.NOTIFY_EMAIL_USER,
    pass: process.env.NOTIFY_EMAIL_PASS,
  },
  tls: {
    rejectUnauthorized: false, // Allow self-signed certificates for development
  },
});

async function sendMockEmail(email, scheduledFor, type) {
  let subject, text;
  const timeStr = new Date(scheduledFor).toLocaleString();
  if (type === 'confirmation') {
    subject = 'Your Mock Interview is Scheduled';
    text = `Your mock interview is scheduled for ${timeStr}. You will receive reminders before your session.`;
  } else {
    subject = 'Mock Interview Reminder';
    text = `Reminder: Your mock interview is scheduled for ${timeStr}. Good luck!`;
  }
  await transporter.sendMail({
    from: process.env.NOTIFY_EMAIL_USER,
    to: email,
    subject,
    text,
  });
}

// Cron job: check every 2 minutes for upcoming mocks and send reminders
nodeCron.schedule('*/2 * * * *', async () => {
  const now = new Date();
  const all = await ScheduledMock.find({ notified: { $ne: true } });
  for (const mock of all) {
    const diff = (new Date(mock.scheduledFor) - now) / 60000; // minutes
    if (!mock.notified && diff <= 60 && diff > 59) {
      await sendMockEmail(mock.email, mock.scheduledFor, 'reminder');
      mock.notified = '1h';
      await mock.save();
    } else if (mock.notified === '1h' && diff <= 30 && diff > 29) {
      await sendMockEmail(mock.email, mock.scheduledFor, 'reminder');
      mock.notified = '30m';
      await mock.save();
    } else if (mock.notified === '30m' && diff <= 5 && diff > 4) {
      await sendMockEmail(mock.email, mock.scheduledFor, 'reminder');
      mock.notified = '5m';
      await mock.save();
    }
  }
});

// Clerk webhook: create user in MongoDB when Clerk user is created
app.post('/api/clerk/webhook', async (req, res) => {
  try {
    const event = req.body;
    console.log('Clerk webhook received:', JSON.stringify(event)); // Add logging
    if (event.type === 'user.created') {
      const { id, email_addresses } = event.data;
      const email = email_addresses?.[0]?.email_address;
      if (id && email) {
        let user = await User.findOne({ clerkUserId: id });
        if (!user) {
          await User.create({ clerkUserId: id, email });
          console.log('User created in MongoDB:', id, email); // Add logging
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
});

// Favicon handler to prevent 404 or 500 errors on /favicon.ico
app.get('/favicon.ico', (req, res) => res.status(204).end());

// Start server
const PORT = process.env.BACKEND_PORT || process.env.PORT || 5001;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
