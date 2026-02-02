// src/services/alphaess.js
import api from './api';

export const alphaessService = {
  // Real-time status
  getStatus: () => api.get('/alphaess/status'),
  getCompleteStatus: () => api.get('/alphaess/complete-status'),
  getPVDetails: () => api.get('/alphaess/pv-details'),
  
  // Dispatch control
  chargeFromGrid: (data) => api.post('/alphaess/charge', data),
  dischargeToGrid: (data) => api.post('/alphaess/discharge', data),
  preventDischarge: () => api.post('/alphaess/prevent-discharge'),
  normalOperation: () => api.post('/alphaess/normal'),
  stopDispatch: () => api.post('/alphaess/stop'),
  getDispatchStatus: () => api.get('/alphaess/dispatch-status'),
};