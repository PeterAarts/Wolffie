import express from 'express';
import authService from '../services/authService.js';
import userService from '../services/userService.js';
import tokenService from '../services/tokenService.js';
import { authenticate } from '../middleware/authenticate.js';
import { authorize, requireAdmin } from '../middleware/authorize.js';
import { authLimiter, passwordResetLimiter } from '../middleware/rateLimiter.js';

const router = express.Router();

/**
 * POST /api/auth/login
 * Login user
 */
router.post('/login', authLimiter, async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({
        success: false,
        error: 'Username and password are required'
      });
    }

    const result = await authService.login(
      username,
      password,
      req.ip,
      req.get('user-agent')
    );

    res.json({
      success: true,
      ...result
    });
  } catch (error) {
    res.status(401).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/auth/logout
 * Logout user
 */
router.post('/logout', authenticate, async (req, res) => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return res.status(400).json({
        success: false,
        error: 'Refresh token is required'
      });
    }

    await authService.logout(refreshToken, req.ip);

    res.json({
      success: true,
      message: 'Logged out successfully'
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/auth/refresh
 * Refresh access token
 */
router.post('/refresh', async (req, res) => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return res.status(400).json({
        success: false,
        error: 'Refresh token is required'
      });
    }

    const result = await authService.refreshAccessToken(refreshToken, req.ip);

    res.json({
      success: true,
      ...result
    });
  } catch (error) {
    res.status(401).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/auth/me
 * Get current user info
 */
router.get('/me', authenticate, async (req, res) => {
  try {
    const user = await userService.getUserById(req.user.id);

    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    res.json({
      success: true,
      user
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * PUT /api/auth/change-password
 * Change current user's password
 */
router.put('/change-password', authenticate, passwordResetLimiter, async (req, res) => {
  try {
    const { oldPassword, newPassword } = req.body;

    if (!oldPassword || !newPassword) {
      return res.status(400).json({
        success: false,
        error: 'Old password and new password are required'
      });
    }

    await authService.changePassword(req.user.id, oldPassword, newPassword);

    res.json({
      success: true,
      message: 'Password changed successfully. Please login again.'
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/auth/sessions
 * Get active sessions for current user
 */
router.get('/sessions', authenticate, async (req, res) => {
  try {
    const sessions = await authService.getActiveSessions(req.user.id);

    res.json({
      success: true,
      sessions
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * DELETE /api/auth/sessions/:id
 * Revoke a specific session
 */
router.delete('/sessions/:id', authenticate, async (req, res) => {
  try {
    await authService.revokeSession(req.user.id, parseInt(req.params.id));

    res.json({
      success: true,
      message: 'Session revoked'
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/auth/sessions/revoke-others
 * Revoke all sessions except current
 */
router.post('/sessions/revoke-others', authenticate, async (req, res) => {
  try {
    const { currentRefreshToken } = req.body;

    if (!currentRefreshToken) {
      return res.status(400).json({
        success: false,
        error: 'Current refresh token is required'
      });
    }

    await authService.revokeOtherSessions(req.user.id, currentRefreshToken);

    res.json({
      success: true,
      message: 'Other sessions revoked'
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/auth/users
 * Get all users (admin only)
 */
router.get('/users', authenticate, requireAdmin, async (req, res) => {
  try {
    const users = await userService.getAllUsers();

    res.json({
      success: true,
      users
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/auth/users
 * Create new user (admin only)
 */
router.post('/users', authenticate, requireAdmin, async (req, res) => {
  try {
    const { username, email, password, full_name, role } = req.body;

    const user = await userService.createUser({
      username,
      email,
      password,
      full_name,
      role
    });

    res.status(201).json({
      success: true,
      user
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/auth/users/:id
 * Get user by ID (admin only)
 */
router.get('/users/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    const user = await userService.getUserById(parseInt(req.params.id));

    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    res.json({
      success: true,
      user
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * PUT /api/auth/users/:id
 * Update user (admin only)
 */
router.put('/users/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    const user = await userService.updateUser(parseInt(req.params.id), req.body);

    res.json({
      success: true,
      user
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * DELETE /api/auth/users/:id
 * Delete user (admin only)
 */
router.delete('/users/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    const userId = parseInt(req.params.id);

    // Don't allow deleting yourself
    if (userId === req.user.id) {
      return res.status(400).json({
        success: false,
        error: 'Cannot delete your own account'
      });
    }

    await userService.deleteUser(userId);

    res.json({
      success: true,
      message: 'User deleted'
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * PUT /api/auth/users/:id/reset-password
 * Reset user password (admin only)
 */
router.put('/users/:id/reset-password', authenticate, requireAdmin, passwordResetLimiter, async (req, res) => {
  try {
    const { newPassword } = req.body;

    if (!newPassword) {
      return res.status(400).json({
        success: false,
        error: 'New password is required'
      });
    }

    await userService.resetPassword(parseInt(req.params.id), newPassword);

    res.json({
      success: true,
      message: 'Password reset successfully'
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/auth/audit
 * Get authentication audit log (admin only)
 */
router.get('/audit', authenticate, requireAdmin, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 100;
    const offset = parseInt(req.query.offset) || 0;
    const userId = req.query.userId ? parseInt(req.query.userId) : null;

    const logs = await authService.getAuditLog({ userId, limit, offset });

    res.json({
      success: true,
      logs
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/auth/cleanup-tokens
 * Cleanup expired tokens (admin only)
 */
router.post('/cleanup-tokens', authenticate, requireAdmin, async (req, res) => {
  try {
    const count = await tokenService.cleanupExpiredTokens();

    res.json({
      success: true,
      message: `Cleaned up ${count} expired tokens`
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

export default router;