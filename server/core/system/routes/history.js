// src/routes/history.js
import express from 'express';
import historyController from '../controllers/historyController.js';

const router = express.Router();

// Generieke periode (bijv. laatste 7, 30 of custom range)
router.get('/range', historyController.getRange.bind(historyController));

// Specifieke dagen
router.get('/date/:date', historyController.getDateData.bind(historyController));
router.get('/today', historyController.getToday.bind(historyController));

export default router;