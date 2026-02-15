// src/services/history.js
import api from './api';

export const historyService = {
  // Voor hoge resolutie (snapshots)
  getToday: (granularity = 15) => 
    api.get('/history/today', { params: { granularity } }),
  
  getDateData: (date, granularity = 15) => 
    api.get(`/history/date/${date}`, { params: { granularity } }),

  // Voor periodes (meerdere dagen via de daily tabel)
  getRange: (startDate, endDate) => 
    api.get('/history/range', { params: { startDate, endDate } }),
};