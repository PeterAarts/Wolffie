import userService from './userService.js';
import tokenService from './tokenService.js';
import db from '../../database.js';

class AuthService {
  /**
   * Login user
   */
  async login(username, password, ipAddress = null, userAgent = null) {
    // Verify credentials
    const user = await userService.verifyCredentials(username, password);
    
    if (!user) {
      // Log failed login attempt
      await this.logAuthEvent({
        username,
        event_type: 'failed_login',
        ip_address: ipAddress,
        success: false,
        error_message: 'Invalid credentials'
      });

      throw new Error('Invalid username or password');
    }

    // Generate tokens
    const accessToken = tokenService.generateAccessToken(user);
    const refreshToken = await tokenService.generateRefreshToken(user, ipAddress, userAgent);

    // Update last login time
    await userService.updateLastLogin(user.id);

    // Log successful login
    await this.logAuthEvent({
      user_id: user.id,
      username: user.username,
      event_type: 'login',
      ip_address: ipAddress,
      success: true
    });

    return {
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        full_name: user.full_name,
        role: user.role
      },
      accessToken,
      refreshToken
    };
  }

  /**
   * Logout user
   */
  async logout(refreshToken, ipAddress = null) {
    try {
      // Verify and get user from token
      const user = await tokenService.verifyRefreshToken(refreshToken);

      // Revoke the refresh token
      await tokenService.revokeRefreshToken(refreshToken);

      // Log logout
      await this.logAuthEvent({
        user_id: user.id,
        username: user.username,
        event_type: 'logout',
        ip_address: ipAddress,
        success: true
      });

      return true;
    } catch (error) {
      // Even if token is invalid, return success
      // (user wants to logout anyway)
      return true;
    }
  }

  /**
   * Refresh access token
   */
  async refreshAccessToken(refreshToken, ipAddress = null) {
    // Verify refresh token
    const user = await tokenService.verifyRefreshToken(refreshToken);

    // Generate new access token
    const accessToken = tokenService.generateAccessToken(user);

    // Log token refresh
    await this.logAuthEvent({
      user_id: user.id,
      username: user.username,
      event_type: 'token_refresh',
      ip_address: ipAddress,
      success: true
    });

    return {
      accessToken,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role
      }
    };
  }

  /**
   * Change password
   */
  async changePassword(userId, oldPassword, newPassword) {
    try {
      await userService.changePassword(userId, oldPassword, newPassword);

      // Get user for logging
      const user = await userService.getUserById(userId);

      // Revoke all refresh tokens (force re-login everywhere)
      await tokenService.revokeAllUserTokens(userId);

      // Log password change
      await this.logAuthEvent({
        user_id: userId,
        username: user.username,
        event_type: 'password_change',
        success: true
      });

      return true;
    } catch (error) {
      // Log failed password change
      const user = await userService.getUserById(userId);
      await this.logAuthEvent({
        user_id: userId,
        username: user?.username,
        event_type: 'password_change',
        success: false,
        error_message: error.message
      });

      throw error;
    }
  }

  /**
   * Validate session (check if access token is valid)
   */
  validateSession(accessToken) {
    try {
      const decoded = tokenService.verifyAccessToken(accessToken);
      return {
        valid: true,
        user: {
          id: decoded.userId,
          username: decoded.username,
          email: decoded.email,
          role: decoded.role
        }
      };
    } catch (error) {
      return {
        valid: false,
        error: error.message
      };
    }
  }

  /**
   * Get active sessions for a user
   */
  async getActiveSessions(userId) {
    const tokens = await tokenService.getUserTokens(userId);

    return tokens.map(token => ({
      id: token.id,
      ip_address: token.ip_address,
      user_agent: token.user_agent,
      created_at: token.created_at,
      expires_at: token.expires_at
    }));
  }

  /**
   * Revoke a specific session
   */
  async revokeSession(userId, tokenId) {
    const [tokens] = await db.pool.query(
      `SELECT token FROM refresh_tokens 
       WHERE id = ? AND user_id = ?`,
      [tokenId, userId]
    );

    if (tokens.length === 0) {
      throw new Error('Session not found');
    }

    await tokenService.revokeRefreshToken(tokens[0].token);

    return true;
  }

  /**
   * Revoke all sessions except current
   */
  async revokeOtherSessions(userId, currentRefreshToken) {
    await db.pool.query(
      `UPDATE refresh_tokens 
       SET revoked = true 
       WHERE user_id = ? AND token != ?`,
      [userId, currentRefreshToken]
    );

    return true;
  }

  /**
   * Log authentication event
   */
  async logAuthEvent({ user_id = null, username, event_type, ip_address = null, success = true, error_message = null }) {
    await db.pool.query(
      `INSERT INTO auth_audit_log 
       (user_id, username, event_type, ip_address, success, error_message)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [user_id, username, event_type, ip_address, success, error_message]
    );
  }

  /**
   * Get authentication audit log
   */
  async getAuditLog({ userId = null, limit = 100, offset = 0 }) {
    let query = `
      SELECT * FROM auth_audit_log
      WHERE 1=1
    `;
    const params = [];

    if (userId) {
      query += ' AND user_id = ?';
      params.push(userId);
    }

    query += ' ORDER BY timestamp DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const [rows] = await db.pool.query(query, params);
    return rows;
  }

  /**
   * Get failed login attempts for a user
   */
  async getFailedLoginAttempts(username, since = null) {
    let query = `
      SELECT COUNT(*) as count
      FROM auth_audit_log
      WHERE username = ? 
        AND event_type = 'failed_login'
        AND success = false
    `;
    const params = [username];

    if (since) {
      query += ' AND timestamp > ?';
      params.push(since);
    }

    const [rows] = await db.pool.query(query, params);
    return rows[0].count;
  }

  /**
   * Check if account should be locked (too many failed attempts)
   */
  async shouldLockAccount(username) {
    // Check failed attempts in last 15 minutes
    const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000);
    const failedAttempts = await this.getFailedLoginAttempts(username, fifteenMinutesAgo);

    // Lock after 5 failed attempts
    return failedAttempts >= 5;
  }
}

export default new AuthService();