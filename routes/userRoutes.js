import express from 'express';
import { getAllUsers, updateUserPlan } from '../controllers/userController.js';

const router = express.Router();

router.get('/admin/users', getAllUsers);
router.post('/admin/user/:clerkUserId/plan', updateUserPlan);

export default router;
