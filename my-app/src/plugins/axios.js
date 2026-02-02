// frontend/src/plugins/axios.js
import axios from 'axios';
import { useAuthStore } from '@/stores/auth';

axios.defaults.baseURL = import.meta.env.VITE_API_BASE_URL;

// Response interceptor - auto-refresh on 401
axios.interceptors.response.use(
  response => response,
  async error => {
    const authStore = useAuthStore();
    
    if (error.response?.status === 401 && error.response?.data?.error === 'TokenExpired') {
      try {
        await authStore.refreshAccessToken();
        // Retry original request
        return axios(error.config);
      } catch (refreshError) {
        return Promise.reject(refreshError);
      }
    }

    return Promise.reject(error);
  }
);