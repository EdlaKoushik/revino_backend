import express from 'express';
import { clerkWebhook } from '../controllers/webhookController.js';

const router = express.Router();

router.post('/clerk/webhook', clerkWebhook);

export default router;
