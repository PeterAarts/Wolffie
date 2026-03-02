// src/stores/auth.js - Auth Store with Session Support
import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import apiClient from '../services/api';

export const useAuthStore = defineStore('auth', () => {
  // State
  const user = ref(null);
  const token = ref(localStorage.getItem('auth_token'));
  const refreshToken = ref(localStorage.getItem('refresh_token'));
  const isAuthenticated = ref(false);
  const loading = ref(false);
  const error = ref(null);

  // Computed
  const isAdmin = computed(() => user.value?.role === 'admin');
  const userName = computed(() => user.value?.username || 'User');

  /**
   * Initialize auth - ENHANCED with session support
   * Checks in this order:
   * 1. Session (via /auth/status) - most reliable for browser refresh
   * 2. JWT token (via /auth/me) - fallback if no session
   */
  async function initialize() {
    console.log('🔐 Initializing authstore latest version...');
    
    try {
      // STEP 1: Check if we have a valid session (works even without tokens)
      // The session cookie is sent automatically
      try {
        const { data: statusData } = await apiClient.get('/auth/status', {
          skipAuth: true // Don't add Authorization header
        });

        if (statusData.success && statusData.authenticated) {
          console.log('✅ Valid session found');
          
          // Set user from session
          user.value = statusData.user;
          isAuthenticated.value = true;

          // Get JWT token if we don't have one
          const storedToken = localStorage.getItem('auth_token');
          if (!storedToken) {
            console.log('🔄 Getting JWT from session...');
            
            // Refresh endpoint will use session to issue new JWT
            const { data: refreshData } = await apiClient.post('/auth/refresh', {}, {
              skipAuth: true
            });

            if (refreshData.success && refreshData.accessToken) {
              token.value = refreshData.accessToken;
              localStorage.setItem('auth_token', refreshData.accessToken);
              
              if (refreshData.refreshToken) {
                refreshToken.value = refreshData.refreshToken;
                localStorage.setItem('refresh_token', refreshData.refreshToken);
              }
              
              console.log('✅ JWT obtained from session');
            }
          } else {
            token.value = storedToken;
          }

          console.log('✅ Authentication restored from session');
          return true;
        } else {
          console.log('ℹ️  No active session');
        }
      } catch (sessionError) {
        console.log('ℹ️  Session check failed, trying token validation...');
      }

      // STEP 2: If no session, try to validate stored JWT token
      const storedToken = localStorage.getItem('auth_token');
      const storedRefreshToken = localStorage.getItem('refresh_token');

      if (!storedToken) {
        console.log('ℹ️  No stored token found');
        isAuthenticated.value = false;
        return false;
      }

      token.value = storedToken;
      refreshToken.value = storedRefreshToken;

      try {
        // Verify token by fetching current user
        const { data } = await apiClient.get('/auth/me');
        
        if (data.success && data.user) {
          user.value = data.user;
          isAuthenticated.value = true;
          
          console.log('✅ Authentication restored from JWT token');
          return true;
        }
      } catch (tokenError) {
        console.log('⚠️  Token validation failed');
        // Token is invalid - clear it
        await logout();
        return false;
      }

      // No valid authentication found
      console.log('❌ No valid authentication');
      isAuthenticated.value = false;
      return false;

    } catch (err) {
      console.error('❌ Auth initialization error:', err);
      isAuthenticated.value = false;
      return false;
    }
  }

  /**
   * Login with username and password
   * ENHANCED: Backend now creates session + returns JWT
   */
  async function login(username, password) {
    loading.value = true;
    error.value = null;

    try {
      const { data } = await apiClient.post('/auth/login', {
        username,
        password
      }, {
        skipAuth: true // Don't add auth header to login request
      });

      if (!data.success) {
        throw new Error(data.error || 'Login failed');
      }

      // Store tokens
      token.value = data.accessToken;
      refreshToken.value = data.refreshToken;
      user.value = data.user;
      isAuthenticated.value = true;

      localStorage.setItem('auth_token', data.accessToken);
      localStorage.setItem('refresh_token', data.refreshToken);

      console.log('✅ Login successful:', user.value.username);
      console.log('🍪 Session created (cookie set by backend)');
      
      return true;
    } catch (err) {
      error.value = err.response?.data?.error || err.message || 'Login failed';
      console.error('❌ Login error:', error.value);
      return false;
    } finally {
      loading.value = false;
    }
  }

  /**
   * Logout
   * ENHANCED: Backend now destroys session + invalidates tokens
   */
  async function logout() {
    try {
      // Call backend logout endpoint with refresh token
      if (refreshToken.value) {
        await apiClient.post('/auth/logout', {
          refreshToken: refreshToken.value
        });
        console.log('✅ Session destroyed on backend');
      }
    } catch (err) {
      console.error('⚠️  Logout API error:', err);
      // Continue with local logout even if API call fails
    }

    // Clear state
    user.value = null;
    token.value = null;
    refreshToken.value = null;
    isAuthenticated.value = false;
    error.value = null;

    // Clear storage
    localStorage.removeItem('auth_token');
    localStorage.removeItem('refresh_token');

    console.log('👋 Logged out');
  }

  /**
   * Change password
   */
  async function changePassword(oldPassword, newPassword) {
    loading.value = true;
    error.value = null;

    try {
      const { data } = await apiClient.put('/auth/change-password', {
        oldPassword,
        newPassword
      });

      if (!data.success) {
        throw new Error(data.error || 'Password change failed');
      }

      console.log('✅ Password changed successfully');
      
      // After password change, user needs to re-login
      await logout();
      
      return true;
    } catch (err) {
      error.value = err.response?.data?.error || 'Failed to change password';
      console.error('❌ Change password error:', error.value);
      return false;
    } finally {
      loading.value = false;
    }
  }

  /**
   * Check if admin user exists (for setup wizard)
   */
  async function checkAdminExists() {
    try {
      const { data } = await apiClient.get('/auth/check-admin', {
        skipAuth: true
      });
      return data.exists;
    } catch (err) {
      console.error('Check admin error:', err);
      return false;
    }
  }

  /**
   * Initialize admin user (for setup wizard)
   */
  async function initializeAdmin(username, password) {
    loading.value = true;
    error.value = null;

    try {
      await apiClient.post('/auth/initialize-admin', {
        username,
        password
      }, {
        skipAuth: true
      });

      console.log('✅ Admin account created');

      // Auto-login after creating admin
      return await login(username, password);
    } catch (err) {
      error.value = err.response?.data?.error || 'Failed to create admin';
      console.error('❌ Initialize admin error:', error.value);
      return false;
    } finally {
      loading.value = false;
    }
  }

  /**
   * List all users (admin only)
   */
  async function listUsers() {
    try {
      const { data } = await apiClient.get('/auth/users');
      return data.users || [];
    } catch (err) {
      console.error('List users error:', err);
      return [];
    }
  }

  /**
   * Create user (admin only)
   */
  async function createUser(username, email, password, fullName, role = 'user') {
    loading.value = true;
    error.value = null;

    try {
      const { data } = await apiClient.post('/auth/users', {
        username,
        email,
        password,
        full_name: fullName,
        role
      });

      if (!data.success) {
        throw new Error(data.error || 'User creation failed');
      }

      console.log('✅ User created:', username);
      return true;
    } catch (err) {
      error.value = err.response?.data?.error || 'Failed to create user';
      console.error('❌ Create user error:', error.value);
      return false;
    } finally {
      loading.value = false;
    }
  }

  /**
   * Update user (admin only)
   */
  async function updateUser(id, updates) {
    loading.value = true;
    error.value = null;

    try {
      const { data } = await apiClient.put(`/auth/users/${id}`, updates);

      if (!data.success) {
        throw new Error(data.error || 'User update failed');
      }

      console.log('✅ User updated');
      return true;
    } catch (err) {
      error.value = err.response?.data?.error || 'Failed to update user';
      console.error('❌ Update user error:', error.value);
      return false;
    } finally {
      loading.value = false;
    }
  }

  /**
   * Delete user (admin only)
   */
  async function deleteUser(id) {
    loading.value = true;
    error.value = null;

    try {
      const { data } = await apiClient.delete(`/auth/users/${id}`);

      if (!data.success) {
        throw new Error(data.error || 'User deletion failed');
      }

      console.log('✅ User deleted');
      return true;
    } catch (err) {
      error.value = err.response?.data?.error || 'Failed to delete user';
      console.error('❌ Delete user error:', error.value);
      return false;
    } finally {
      loading.value = false;
    }
  }

  /**
   * Get active sessions (admin only)
   */
  async function getSessions() {
    try {
      const { data } = await apiClient.get('/auth/sessions');
      return data.sessions || [];
    } catch (err) {
      console.error('Get sessions error:', err);
      return [];
    }
  }

  /**
   * Revoke a session (admin only)
   */
  async function revokeSession(sessionId) {
    try {
      const { data } = await apiClient.delete(`/auth/sessions/${sessionId}`);

      if (!data.success) {
        throw new Error(data.error || 'Session revocation failed');
      }

      console.log('✅ Session revoked');
      return true;
    } catch (err) {
      console.error('❌ Revoke session error:', err);
      return false;
    }
  }

  return {
    // State
    user,
    token,
    refreshToken,
    isAuthenticated,
    loading,
    error,

    // Computed
    isAdmin,
    userName,

    // Actions
    initialize,
    login,
    logout,
    changePassword,
    checkAdminExists,
    initializeAdmin,
    listUsers,
    createUser,
    updateUser,
    deleteUser,
    getSessions,
    revokeSession
  };
});