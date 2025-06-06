import express from 'express';
import {
  createInterview,
  startInterview,
  getAllInterviews,
  getInterviewById,
  submitInterview
} from '../controllers/interviewController.js';

const router = express.Router();

router.post('/create', createInterview);
router.post('/start', startInterview);
router.post('/submit', submitInterview);
router.get('/all', getAllInterviews);
router.get('/:id', getInterviewById);

export default router;
