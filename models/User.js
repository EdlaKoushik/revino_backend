import mongoose from 'mongoose';

const userSchema = new mongoose.Schema({
  clerkUserId: { type: String, required: true, unique: true },
  email: { type: String, required: true },
  plan: { type: String, enum: ['Free', 'Premium'], default: 'Free' },
  stripeCustomerId: { type: String },
  stripeSubscriptionId: { type: String },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
}, { timestamps: true });

userSchema.post('save', function(doc) {
  if (doc.isNew) {
    console.log('User document created in MongoDB:', doc);
  }
});

export default mongoose.model('User', userSchema);
