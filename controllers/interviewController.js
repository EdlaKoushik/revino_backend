import mongoose from 'mongoose';
import interviewSessionSchema from '../models/InterviewSession.js';
const InterviewSession = mongoose.models.InterviewSession || mongoose.model('InterviewSession', interviewSessionSchema);
import { generateQuestions, generateIdealAnswers } from '../utils/together.js';
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
    if (!Array.isArray(interview.questions)) {
      return res.status(500).json({ message: 'Interview questions are missing or invalid.' });
    }
    if (!Array.isArray(answers)) {
      return res.status(400).json({ message: 'Answers must be an array.' });
    }
    interview.answers = answers;
    // Score calculation: percentage of non-empty, sufficiently detailed answers
    const total = interview.questions.length;
    // Only count answers with at least 30 characters as "answered"
    const answered = answers.filter(a => a && a.trim().length >= 30).length;
    // Score is based on answer quality, not just attempted
    let score = 0;
    answers.forEach(ans => {
      if (!ans || ans.trim().length === 0) return;
      if (ans.trim().length < 10) score += 5; // very brief
      else if (ans.trim().length < 30) score += 10; // needs more detail
      else if (ans.trim().length < 60) score += 15; // moderate
      else if (ans.trim().length < 120) score += 18; // good
      else score += 20; // perfect
    });
    // Normalize to 100 max
    score = Math.round((score / (total * 20)) * 100);
    // Cap at 95 to avoid 100% even for perfect answers
    if (score > 95) score = 95;
    // Per-question feedback: more nuanced
    let feedback = answers.map((ans, idx) => {
      if (!ans || ans.trim().length === 0) return 'Poor: No answer provided.';
      if (ans.trim().length < 10) return 'Poor: Very brief answer.';
      if (ans.trim().length < 30) return 'Average: Needs more detail.';
      if (ans.trim().length < 60) return 'Moderate: Decent, but could be expanded.';
      if (ans.trim().length < 120) return 'Good: Clear and relevant.';
      return 'Perfect: Comprehensive and well-structured.';
    });
    // Generate ideal answers using AI
    let idealAnswers = [];
    try {
      idealAnswers = await generateIdealAnswers(
        interview.questions,
        interview.jobRole,
        interview.industry,
        interview.experience,
        interview.jobDescription,
        interview.resumeText
      );
    } catch (e) {
      idealAnswers = interview.questions.map((q, idx) => `A strong answer for Q${idx + 1} should address the main requirements and demonstrate relevant skills.`);
    }
    // Overall feedback based on score
    let overallFeedback = '';
    if (score === 100) overallFeedback = 'Perfect! You answered all questions thoroughly and demonstrated excellent knowledge.';
    else if (score >= 80) overallFeedback = 'Great job! Most answers were strong, but review a few areas for improvement.';
    else if (score >= 60) overallFeedback = 'Good effort. Some answers were solid, but try to add more detail and clarity.';
    else if (score >= 40) overallFeedback = 'Moderate performance. Focus on providing more complete and relevant answers.';
    else if (score > 0) overallFeedback = 'Needs improvement. Many answers were missing or too brief. Practice expanding your responses.';
    else overallFeedback = 'No answers provided. Please try to answer the questions next time.';
    interview.feedback = feedback;
    interview.idealAnswers = idealAnswers;
    interview.overallFeedback = overallFeedback;
    interview.status = 'completed';
    interview.score = score;
    await interview.save();
    res.status(200).json({ success: true, feedback, idealAnswers, overallFeedback, score });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// Export all interview logs as CSV for admin
export const exportInterviewLogs = async (req, res) => {
  try {
    // Only allow admin (add real admin check in production)
    // Fetch all interviews
    const interviews = await InterviewSession.find({}).lean();
    if (!interviews.length) {
      return res.status(404).json({ message: 'No interview logs found.' });
    }
    // Prepare CSV header
    const header = [
      'InterviewID', 'UserID', 'Email', 'JobRole', 'Industry', 'Experience', 'Mode', 'Status', 'CreatedAt', 'Questions', 'Answers', 'Feedback', 'IdealAnswers', 'OverallFeedback'
    ];
    // Prepare CSV rows
    const rows = interviews.map(i => [
      i._id,
      i.userId,
      i.email || '',
      i.jobRole || '',
      i.industry || '',
      i.experience || '',
      i.mode || '',
      i.status || '',
      i.createdAt ? new Date(i.createdAt).toISOString() : '',
      (i.questions || []).join(' | '),
      (i.answers || []).join(' | '),
      (i.feedback || []).join(' | '),
      (i.idealAnswers || []).join(' | '),
      i.overallFeedback || ''
    ]);
    // Convert to CSV string
    const csv = [header, ...rows].map(r => r.map(x => '"' + String(x).replace(/"/g, '""') + '"').join(',')).join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="interview_logs.csv"');
    res.send(csv);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// Admin: Edit interview session (status, feedback, overallFeedback, etc.)
export const adminEditInterview = async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body; // e.g., { status, feedback, overallFeedback, ... }
    const interview = await InterviewSession.findByIdAndUpdate(id, updates, { new: true });
    if (!interview) return res.status(404).json({ message: 'Interview not found' });
    res.json({ success: true, interview });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// Admin: Delete interview session
export const adminDeleteInterview = async (req, res) => {
  try {
    const { id } = req.params;
    const deleted = await InterviewSession.findByIdAndDelete(id);
    if (!deleted) return res.status(404).json({ message: 'Interview not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
