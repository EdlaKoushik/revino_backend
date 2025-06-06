import mongoose from 'mongoose';

const scheduledMockSchema = new mongoose.Schema({
  userId: { type: String, required: true },
  email: { type: String, required: true },
  scheduledFor: { type: Date, required: true },
  createdAt: { type: Date, default: Date.now },
  notified: { type: Boolean, default: false },
  mode: { type: String, enum: ['text', 'audio', 'video'] },
  jobRole: { type: String },
  industry: { type: String },
  experience: { type: String },
  resumeText: { type: String },
  jobDescription: { type: String },
});

export default mongoose.model('ScheduledMock', scheduledMockSchema);
