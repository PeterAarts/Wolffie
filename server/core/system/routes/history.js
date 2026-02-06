// src/routes/history.js
import express from 'express';
import historyController from '../controllers/historyController.js';

const router = express.Router();

router.get('/last-24-hours', historyController.getLast24Hours.bind(historyController));
router.get('/last-7-days', historyController.getLast7Days.bind(historyController));
router.get('/last-30-days', historyController.getLast30Days.bind(historyController));
router.get('/last-365-days', historyController.getLast365Days.bind(historyController));
router.get('/date/:date', historyController.getDateData.bind(historyController));
router.get('/daily', historyController.getDailySummary.bind(historyController));
router.get('/monthly/:year', historyController.getMonthlySummary.bind(historyController));
router.get('/today', historyController.getToday.bind(historyController));

export default router;