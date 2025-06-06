import express from 'express';
import {
  createInterview,
  startInterview,
  getAllInterviews,
  getInterviewById,
  submitInterview,
  exportInterviewLogs,
  adminEditInterview,
  adminDeleteInterview
} from '../controllers/interviewController.js';

const router = express.Router();

router.post('/create', createInterview);
router.post('/start', startInterview);
router.post('/submit', submitInterview);
router.get('/all', getAllInterviews);
router.get('/:id', getInterviewById);
router.get('/export/logs', exportInterviewLogs);
router.put('/admin/interviews/:id', adminEditInterview); // Admin edit interview
router.delete('/admin/interviews/:id', adminDeleteInterview); // Admin delete interview

export default router;
