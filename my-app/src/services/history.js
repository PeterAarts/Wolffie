// src/services/history.js
import api from './api';

export const historyService = {
  getLast24Hours: () => api.get('/history/last-24-hours'),
  getDateData: (date) => api.get(`/history/date/${date}`),
  getDailySummary: (start, end) => api.get('/history/daily', { params: { start, end } }),
  getMonthlySummary: (year) => api.get(`/history/monthly/${year}`),
  getToday: () => api.get('/history/today'),
};