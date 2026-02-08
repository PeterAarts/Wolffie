// src/services/apiClient.js - WattsOn API Client with Authentication
import axios from 'axios';
import router from '../router';

const apiClient = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000/api',
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
  },
  withCredentials: true,
});

let isLoggingOut = false;

/**
 * Request interceptor - Add auth token to requests
 */
apiClient.interceptors.request.use(
  (config) => {
    // Skip auth for specific requests (like login)
    if (config.skipAuth) {
      return config;
    }

    // Add access token to Authorization header
    const accessToken = localStorage.getItem('auth_token');
    if (accessToken) {
      config.headers.Authorization = `Bearer ${accessToken}`;
    }

    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

/**
 * Response interceptor - Handle 401 errors and token refresh
 */
apiClient.interceptors.response.use(
  (response) => {
    return response;
  },
  async (error) => {
    const originalRequest = error.config;

    // Handle 401 Unauthorized
    if (error.response?.status === 401) {
      
      // Prevent multiple simultaneous logout attempts
      if (!isLoggingOut && !originalRequest._retry) {
        isLoggingOut = true;
        originalRequest._retry = true;

        try {
          // Get refresh token
          const refreshToken = localStorage.getItem('refresh_token');
          
          // If we have a refresh token, try to refresh the access token
          if (refreshToken && !originalRequest.url?.includes('/auth/refresh')) {
            try {
              const { data } = await axios.post(
                `${apiClient.defaults.baseURL}/auth/refresh`,
                { refreshToken },
                { skipAuth: true }
              );

              // Store new access token
              localStorage.setItem('auth_token', data.accessToken);

              // Update the original request with new token
              originalRequest.headers.Authorization = `Bearer ${data.accessToken}`;

              isLoggingOut = false;

              // Retry the original request
              return apiClient(originalRequest);
            } catch (refreshError) {
              // Refresh failed, proceed to logout
              console.error('Token refresh failed:', refreshError);
            }
          }

          // If we get here, either no refresh token or refresh failed
          // Clear auth data
          localStorage.removeItem('auth_token');
          localStorage.removeItem('refresh_token');

          // Dynamically import auth store to avoid circular dependencies
          const { useAuthStore } = await import('../stores/auth');
          const authStore = useAuthStore();

          // Clear auth state
          authStore.user = null;
          authStore.token = null;
          authStore.isAuthenticated = false;

          // Show appropriate message
          const message = error.response.data?.error;
          if (message && (message.includes('expired') || message.includes('invalid'))) {
            console.warn('Session expired. Please log in again.');
          }

          // Redirect to login if not already there
          if (router.currentRoute.value.name !== 'Login') {
            router.push({
              name: 'Login',
              query: {
                redirect: router.currentRoute.value.fullPath,
                reason: 'session-expired'
              }
            });
          }

        } catch (logoutError) {
          console.error('Error during automatic logout:', logoutError);
        } finally {
          isLoggingOut = false;
        }
      }

      return Promise.reject(error);
    }

    // Handle 403 Forbidden
    if (error.response?.status === 403) {
      console.error('Access forbidden:', error.response.data?.error || 'Insufficient permissions');
    }

    // Handle 500+ Server errors
    if (error.response?.status >= 500) {
      console.error('Server error:', error.response.data?.error || 'Server error occurred');
    }

    // Handle timeout
    if (error.code === 'ECONNABORTED') {
      console.error('Request timeout - server took too long to respond');
    }

    // Handle network errors
    if (!error.response) {
      console.error('Network error - server may be unreachable');
    }

    return Promise.reject(error);
  }
);

export default apiClient;