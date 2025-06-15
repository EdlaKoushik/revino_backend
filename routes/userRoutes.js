import express from 'express';
import { getAllUsers, updateUserPlan, adminEditUser, deleteUserAndData } from '../controllers/userController.js';

const router = express.Router();

router.get('/admin/users', getAllUsers);
router.post('/admin/user/:clerkUserId/plan', updateUserPlan);
router.put('/admin/users/:id', adminEditUser); // Admin edit user details/plan
router.delete('/user/:clerkUserId', deleteUserAndData); // Delete user and all data

export default router;
