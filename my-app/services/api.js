// src/services/api.js - WattsOn API Client with Session + JWT Authentication
import axios from 'axios';
import router from '../router';

const apiClient = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000/api',
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
  },
  withCredentials: true, // CRITICAL: Send cookies (session) with every request
});

let isRefreshing = false;
let failedQueue = [];

/**
 * Process queued requests after token refresh
 */
const processQueue = (error, token = null) => {
  failedQueue.forEach(prom => {
    if (error) {
      prom.reject(error);
    } else {
      prom.resolve(token);
    }
  });
  
  failedQueue = [];
};

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
 * ENHANCED: Now tries session-based refresh first, then refresh token
 */
apiClient.interceptors.response.use(
  (response) => {
    return response;
  },
  async (error) => {
    const originalRequest = error.config;

    // Handle 401 Unauthorized
    if (error.response?.status === 401 && !originalRequest._retry) {
      
      // If already refreshing, queue this request
      if (isRefreshing) {
        return new Promise((resolve, reject) => {
          failedQueue.push({ resolve, reject });
        })
        .then(token => {
          originalRequest.headers.Authorization = `Bearer ${token}`;
          return apiClient(originalRequest);
        })
        .catch(err => {
          return Promise.reject(err);
        });
      }

      originalRequest._retry = true;
      isRefreshing = true;

      try {
        // STRATEGY 1: Try to refresh using session (no refresh token needed)
        // The session cookie is sent automatically via withCredentials: true
        try {
          console.log('🔄 Attempting session-based token refresh...');
          
          const { data } = await axios.post(
            `${apiClient.defaults.baseURL}/auth/refresh`,
            {}, // Empty body - backend will check session
            { 
              skipAuth: true,
              withCredentials: true // Send session cookie
            }
          );

          if (data.success && data.accessToken) {
            console.log('✅ Token refreshed from session');
            
            // Store new access token
            localStorage.setItem('auth_token', data.accessToken);
            
            // Update original request with new token
            originalRequest.headers.Authorization = `Bearer ${data.accessToken}`;
            
            // Process any queued requests
            processQueue(null, data.accessToken);
            isRefreshing = false;
            
            // Retry original request
            return apiClient(originalRequest);
          }
        } catch (sessionRefreshError) {
          console.log('⚠️  Session refresh failed, trying refresh token...');
          
          // STRATEGY 2: Try refresh token if session refresh failed
          const refreshToken = localStorage.getItem('refresh_token');
          
          if (refreshToken && !originalRequest.url?.includes('/auth/refresh')) {
            try {
              const { data } = await axios.post(
                `${apiClient.defaults.baseURL}/auth/refresh`,
                { refreshToken },
                { 
                  skipAuth: true,
                  withCredentials: true
                }
              );

              if (data.success && data.accessToken) {
                console.log('✅ Token refreshed from refresh token');
                
                // Store new tokens
                localStorage.setItem('auth_token', data.accessToken);
                if (data.refreshToken) {
                  localStorage.setItem('refresh_token', data.refreshToken);
                }
                
                // Update original request
                originalRequest.headers.Authorization = `Bearer ${data.accessToken}`;
                
                // Process queue
                processQueue(null, data.accessToken);
                isRefreshing = false;
                
                // Retry original request
                return apiClient(originalRequest);
              }
            } catch (refreshTokenError) {
              console.error('❌ Refresh token failed:', refreshTokenError);
            }
          }
        }

        // If we get here, both refresh strategies failed
        console.log('❌ All refresh strategies failed, logging out...');
        
        // Clear auth data
        localStorage.removeItem('auth_token');
        localStorage.removeItem('refresh_token');

        // Dynamically import auth store to avoid circular dependencies
        const { useAuthStore } = await import('../stores/auth');
        const authStore = useAuthStore();

        // Clear auth state
        authStore.user = null;
        authStore.token = null;
        authStore.refreshToken = null;
        authStore.isAuthenticated = false;

        // Process failed queue
        processQueue(new Error('Session expired'), null);
        isRefreshing = false;

        // Show appropriate message
        const message = error.response?.data?.error;
        if (message && (message.includes('expired') || message.includes('invalid'))) {
          console.warn('⏱️  Session expired. Please log in again.');
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

        return Promise.reject(error);

      } catch (logoutError) {
        console.error('❌ Error during automatic logout:', logoutError);
        processQueue(logoutError, null);
        isRefreshing = false;
        return Promise.reject(error);
      }
    }

    // Handle 403 Forbidden
    if (error.response?.status === 403) {
      console.error('🚫 Access forbidden:', error.response.data?.error || 'Insufficient permissions');
    }

    // Handle 500+ Server errors
    if (error.response?.status >= 500) {
      console.error('🔥 Server error:', error.response.data?.error || 'Server error occurred');
    }

    // Handle timeout
    if (error.code === 'ECONNABORTED') {
      console.error('⏱️  Request timeout - server took too long to respond');
    }

    // Handle network errors
    if (!error.response) {
      console.error('🌐 Network error - server may be unreachable');
    }

    return Promise.reject(error);
  }
);

export default apiClient;