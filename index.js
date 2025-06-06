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

// Routes
app.get('/', (req, res) => {
  res.json({ message: 'AI Interview Prep API is running' });
});

// ✅ Create interview session
app.post('/api/interview/create', async (req, res) => {
  try {
    console.log('Received interview creation request:', req.body);
    const { mode, jobRole, industry, experience, resumeText, jobDescription } = req.body;
    const userId = req.user?.id || req.user?._id || req.body.userId || null;
    if (!jobRole || !experience) {
      return res.status(400).json({ message: 'Job role and experience are required' });
    }
    // Enforce free tier limit: 3 interviews/month
    let isPremium = false;
    if (userId) {
      const user = await User.findOne({ clerkUserId: userId });
      isPremium = user && user.plan === 'Premium';
      const startOfMonth = new Date();
      startOfMonth.setDate(1);
      startOfMonth.setHours(0,0,0,0);
      const interviewCount = await InterviewSession.countDocuments({
        'userId': userId,
        createdAt: { $gte: startOfMonth },
      });
      if (!isPremium && interviewCount >= 3) {
        return res.status(403).json({ message: 'Free plan limit reached. Upgrade to Premium for unlimited interviews.' });
      }
    }
    const interview = await InterviewSession.create({
      mode,
      jobRole,
      industry,
      experience,
      resumeText,
      jobDescription,
      status: 'created',
      ...(userId && { userId })
    });
    res.status(201).json({ success: true, interview });
  } catch (err) {
    console.error('Error creating interview:', err);
    res.status(500).json({ message: err.message });
  }
});

// ✅ Generate questions and update session
app.post('/api/interview/start', async (req, res) => {
  try {
    const { interviewId } = req.body;

    const interview = await InterviewSession.findById(interviewId);
    if (!interview) {
      return res.status(404).json({ message: 'Interview not found' });
    }

    const questions = await generateQuestions(
      interview.jobRole,
      interview.industry,
      interview.experience,
      interview.jobDescription,
      interview.resumeText
    );

    interview.questions = questions;
    interview.status = 'in_progress';
    await interview.save();

    res.status(200).json({ success: true, questions });
  } catch (err) {
    console.error('Error generating questions:', err);
    res.status(500).json({ message: err.message });
  }
});

// Get all interview sessions (for dashboard)
app.get('/api/interview/all', async (req, res) => {
  try {
    const interviews = await InterviewSession.find().sort({ createdAt: -1 });
    res.json({ interviews });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Get interview session by id
app.get('/api/interview/:id', async (req, res) => {
  try {
    const interview = await InterviewSession.findById(req.params.id);
    if (!interview) {
      return res.status(404).json({ message: 'Interview not found' });
    }
    res.json({ success: true, interview });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Video upload endpoint for video mode answers
app.post('/api/interview/upload-video', upload.single('video'), async (req, res) => {
  try {
    const { interviewId, questionIndex } = req.body;
    if (!req.file) {
      return res.status(400).json({ message: 'No video file uploaded.' });
    }
    const interview = await InterviewSession.findById(interviewId);
    if (!interview) {
      return res.status(404).json({ message: 'Interview not found' });
    }
    // Store video as base64 in answers array for demo (in production, use cloud/file storage)
    const videoBase64 = req.file.buffer.toString('base64');
    if (!interview.answers) interview.answers = [];
    interview.answers[questionIndex] = { video: videoBase64, mimetype: req.file.mimetype };
    await interview.save();
    res.status(200).json({ success: true, message: 'Video uploaded and saved.' });
  } catch (err) {
    console.error('Error uploading video:', err);
    res.status(500).json({ message: err.message });
  }
});

// Submit interview answers and generate feedback
app.post('/api/interview/submit', async (req, res) => {
  try {
    const { interviewId, answers, mode } = req.body;
    console.log('Received submit:', { interviewId, answers, mode });
    const interview = await InterviewSession.findById(interviewId);
    if (!interview) {
      return res.status(404).json({ message: 'Interview not found' });
    }
    interview.answers = answers;
    // Generate per-question feedback (dummy for now, replace with AI call)
    let feedback;
    if (mode === 'video') {
      feedback = answers.map((ans, idx) =>
        ans && typeof ans === 'string' && ans.trim().length > 0
          ? `Good answer for Q${idx + 1}. Eye contact and clarity are important!`
          : `No answer provided for Q${idx + 1}.`
      );
    } else {
      feedback = answers.map((ans, idx) =>
        ans && ans.length > 0
          ? `Good answer for Q${idx + 1}.`
          : `No answer provided for Q${idx + 1}.`
      );
    }
    // Generate overall feedback (dummy for now, replace with AI call)
    let overallFeedback;
    if (mode === 'video') {
      overallFeedback = 'Great presence! Work on body language and confidence.';
    } else if (mode === 'audio') {
      overallFeedback = 'Great communication skills! Work on clarity and pacing.';
    } else {
      overallFeedback = 'Well-structured answers. Try to be more concise.';
    }
    interview.feedback = feedback;
    interview.overallFeedback = overallFeedback;
    interview.status = 'completed';
    await interview.save();
    console.log('Saved interview:', {
      answers: interview.answers,
      feedback: interview.feedback,
      overallFeedback: interview.overallFeedback,
    });
    res.status(200).json({ success: true, feedback, overallFeedback });
  } catch (err) {
    console.error('Error submitting interview:', err);
    res.status(500).json({ message: err.message });
  }
});

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

// Start server
const PORT = process.env.BACKEND_PORT || process.env.PORT || 5001;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
