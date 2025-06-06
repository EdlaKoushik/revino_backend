import mongoose from 'mongoose';
import interviewSessionSchema from '../models/InterviewSession.js';
const InterviewSession = mongoose.models.InterviewSession || mongoose.model('InterviewSession', interviewSessionSchema);
import { generateQuestions } from '../utils/together.js';
import User from '../models/User.js';

export const createInterview = async (req, res) => {
  try {
    const { mode, jobRole, industry, experience, resumeText, jobDescription, userId: bodyUserId, email } = req.body;
    const userId = req.user?.id || req.user?._id || bodyUserId || null;
    if (!jobRole || !experience) {
      return res.status(400).json({ message: 'Job role and experience are required' });
    }
    // Ensure user exists in User collection
    let user = null;
    if (userId && email) {
      user = await User.findOne({ clerkUserId: userId });
      if (!user) {
        user = await User.create({ clerkUserId: userId, email });
      }
    }
    if (!userId) {
      return res.status(400).json({ message: 'User ID is required to create an interview.' });
    }
    // --- Free plan: enforce 3 interviews/month limit ---
    if (user && user.plan === 'Free') {
      // Check if user has upgraded this month
      const now = new Date();
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      // If user upgraded this month, treat as Premium for this month
      if (user.updatedAt && new Date(user.updatedAt) > startOfMonth && user.plan === 'Premium') {
        // User upgraded this month, allow unlimited interviews
        // (No limit logic here)
      } else {
        // Count interviews created this month
        const endOfMonth = new Date(startOfMonth);
        endOfMonth.setMonth(endOfMonth.getMonth() + 1);
        const count = await InterviewSession.countDocuments({
          userId,
          createdAt: { $gte: startOfMonth, $lt: endOfMonth }
        });
        if (count >= 3) {
          return res.status(403).json({
            message: 'Free plan users can only take 3 mock interviews per month. Upgrade to Premium for unlimited access.'
          });
        }
      }
    }
    // --- End free plan check ---
    const interview = await InterviewSession.create({
      mode,
      jobRole,
      industry,
      experience,
      resumeText,
      jobDescription,
      status: 'created',
      userId,
      ...(email && { email })
    });
    res.status(201).json({ success: true, interview });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

export const startInterview = async (req, res) => {
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
    res.status(500).json({ message: err.message });
  }
};

export const getAllInterviews = async (req, res) => {
  try {
    // Always filter by userId if available (from auth or query)
    const userId = req.user?.id || req.user?._id || req.query.userId;
    const filter = userId ? { userId } : {};
    const interviews = await InterviewSession.find(filter).sort({ createdAt: -1 });
    res.json({ interviews });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

export const getInterviewById = async (req, res) => {
  try {
    const interview = await InterviewSession.findById(req.params.id);
    if (!interview) {
      return res.status(404).json({ message: 'Interview not found' });
    }
    res.json({ success: true, interview });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

export const submitInterview = async (req, res) => {
  try {
    const { interviewId, answers, mode } = req.body;
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
    res.status(200).json({ success: true, feedback, overallFeedback });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
