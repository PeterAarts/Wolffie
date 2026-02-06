// src/services/history.js
import api from './api';

export const historyService = {
  getLast24Hours: () => api.get('/sysem/history/last-24-hours'),
  getDateData: (date) => api.get(`/system/history/date/${date}`),
  getDailySummary: (start, end) => api.get('/system/history/daily', { params: { start, end } }),
  getMonthlySummary: (year) => api.get(`/system/history/monthly/${year}`),
  getToday: () => api.get('/system/history/today'),
};