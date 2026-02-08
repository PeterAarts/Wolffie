// src/stores/auth.js - Auth Store using apiClient
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
   * Initialize auth - check token and load user
   */
  async function initialize() {
    const storedToken = localStorage.getItem('auth_token');
    const storedRefreshToken = localStorage.getItem('refresh_token');

    if (!storedToken) {
      isAuthenticated.value = false;
      return false;
    }

    token.value = storedToken;
    refreshToken.value = storedRefreshToken;

    try {
      // Verify token by fetching current user
      const { data } = await apiClient.get('/auth/me');
      
      user.value = data.user;
      isAuthenticated.value = true;
      
      console.log('✅ Authentication restored from token');
      return true;
    } catch (err) {
      // Token is invalid or expired - apiClient will handle logout
      console.log('⚠️ Token validation failed');
      await logout();
      return false;
    }
  }

  /**
   * Login with username and password
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

      // Store tokens
      token.value = data.accessToken;
      refreshToken.value = data.refreshToken;
      user.value = data.user;
      isAuthenticated.value = true;

      localStorage.setItem('auth_token', data.accessToken);
      localStorage.setItem('refresh_token', data.refreshToken);

      console.log('✅ Login successful:', user.value.username);
      return true;
    } catch (err) {
      error.value = err.response?.data?.error || 'Login failed';
      console.error('❌ Login error:', error.value);
      return false;
    } finally {
      loading.value = false;
    }
  }

  /**
   * Logout
   */
  async function logout() {
    try {
      // Call backend logout endpoint with refresh token
      if (refreshToken.value) {
        await apiClient.post('/auth/logout', {
          refreshToken: refreshToken.value
        });
      }
    } catch (err) {
      console.error('Logout API error:', err);
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
      await apiClient.put('/auth/change-password', {
        oldPassword,
        newPassword
      });

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
      return data.users;
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
      await apiClient.post('/auth/users', {
        username,
        email,
        password,
        full_name: fullName,
        role
      });

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
      await apiClient.put(`/auth/users/${id}`, updates);

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
      await apiClient.delete(`/auth/users/${id}`);

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
      return data.sessions;
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
      await apiClient.delete(`/auth/sessions/${sessionId}`);
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