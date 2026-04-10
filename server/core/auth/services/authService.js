// core/auth/services/authService.js
//
// Wijziging t.o.v. origineel:
//   shouldLockAccount() → fifteenMinutesAgo als ISO-string ipv Date object
//   getFailedLoginAttempts() → since wordt geconverteerd naar string voor SQL binding
//   SQLite accepteert geen Date-objecten als bind-parameter.

import userService  from './userService.js';
import tokenService from './tokenService.js';
import db           from '../../database.js';

class AuthService {

  // ── Login ──────────────────────────────────────────────────────────────────

  async login(username, password, ipAddress = null, userAgent = null) {
    const user = await userService.verifyCredentials(username, password);

    if (!user) {
      await this.logAuthEvent({
        username,
        event_type:    'failed_login',
        ip_address:    ipAddress,
        success:       false,
        error_message: 'Invalid credentials',
      });
      throw new Error('Invalid username or password');
    }

    const accessToken  = tokenService.generateAccessToken(user);
    const refreshToken = await tokenService.generateRefreshToken(user, ipAddress, userAgent);

    await userService.updateLastLogin(user.id);

    await this.logAuthEvent({
      user_id:    user.id,
      username:   user.username,
      event_type: 'login',
      ip_address: ipAddress,
      success:    true,
    });

    return {
      user: {
        id:        user.id,
        username:  user.username,
        email:     user.email,
        full_name: user.full_name,
        role:      user.role,
      },
      accessToken,
      refreshToken,
    };
  }

  // ── Logout ─────────────────────────────────────────────────────────────────

  async logout(refreshToken, ipAddress = null) {
    try {
      const user = await tokenService.verifyRefreshToken(refreshToken);
      await tokenService.revokeRefreshToken(refreshToken);
      await this.logAuthEvent({
        user_id:    user.id,
        username:   user.username,
        event_type: 'logout',
        ip_address: ipAddress,
        success:    true,
      });
      return true;
    } catch {
      return true; // Altijd succesvol — gebruiker wil uitloggen
    }
  }

  // ── Token refresh ──────────────────────────────────────────────────────────

  async refreshAccessToken(refreshToken, ipAddress = null) {
    const user        = await tokenService.verifyRefreshToken(refreshToken);
    const accessToken = tokenService.generateAccessToken(user);

    await this.logAuthEvent({
      user_id:    user.id,
      username:   user.username,
      event_type: 'token_refresh',
      ip_address: ipAddress,
      success:    true,
    });

    return {
      accessToken,
      user: {
        id:       user.id,
        username: user.username,
        email:    user.email,
        role:     user.role,
      },
    };
  }

  // ── Wachtwoord wijzigen ────────────────────────────────────────────────────

  async changePassword(userId, oldPassword, newPassword) {
    try {
      await userService.changePassword(userId, oldPassword, newPassword);

      const user = await userService.getUserById(userId);
      await tokenService.revokeAllUserTokens(userId);

      await this.logAuthEvent({
        user_id:    userId,
        username:   user.username,
        event_type: 'password_change',
        success:    true,
      });

      return true;
    } catch (error) {
      const user = await userService.getUserById(userId);
      await this.logAuthEvent({
        user_id:       userId,
        username:      user?.username,
        event_type:    'password_change',
        success:       false,
        error_message: error.message,
      });
      throw error;
    }
  }

  // ── Sessie validatie ───────────────────────────────────────────────────────

  validateSession(accessToken) {
    try {
      const decoded = tokenService.verifyAccessToken(accessToken);
      return {
        valid: true,
        user: {
          id:       decoded.userId,
          username: decoded.username,
          email:    decoded.email,
          role:     decoded.role,
        },
      };
    } catch (error) {
      return { valid: false, error: error.message };
    }
  }

  // ── Sessies ophalen ────────────────────────────────────────────────────────

  async getActiveSessions(userId) {
    const tokens = await tokenService.getUserTokens(userId);
    return tokens.map(token => ({
      id:         token.id,
      ip_address: token.ip_address,
      user_agent: token.user_agent,
      created_at: token.created_at,
      expires_at: token.expires_at,
    }));
  }

  async revokeSession(userId, tokenId) {
    const [tokens] = await db.pool.query(
      'SELECT token FROM refresh_tokens WHERE id = ? AND user_id = ?',
      [tokenId, userId]
    );
    if (tokens.length === 0) throw new Error('Session not found');
    await tokenService.revokeRefreshToken(tokens[0].token);
    return true;
  }

  async revokeOtherSessions(userId, currentRefreshToken) {
    await db.pool.query(
      'UPDATE refresh_tokens SET revoked = true WHERE user_id = ? AND token != ?',
      [userId, currentRefreshToken]
    );
    return true;
  }

  // ── Audit log ──────────────────────────────────────────────────────────────

  async logAuthEvent({ user_id = null, username, event_type, ip_address = null, success = true, error_message = null }) {
    await db.pool.query(
      `INSERT INTO auth_audit_log
         (user_id, username, event_type, ip_address, success, error_message)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [user_id, username, event_type, ip_address, success ? 1 : 0, error_message]
    );
  }

  async getAuditLog({ userId = null, limit = 100, offset = 0 }) {
    let query  = 'SELECT * FROM auth_audit_log WHERE 1=1';
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

  // ── Brute-force bescherming ────────────────────────────────────────────────
  //
  // Wijziging:
  //   fifteenMinutesAgo = new Date(...)  →  ISO-string
  //   SQLite accepteert geen Date-objecten als bind-parameter.
  //   De timestamp-kolom in auth_audit_log slaat waarden op als TEXT (ISO-string),
  //   dus string-vergelijking werkt correct.

  async getFailedLoginAttempts(username, since = null) {
    let query  = `
      SELECT COUNT(*) as count
      FROM auth_audit_log
      WHERE username   = ?
        AND event_type = 'failed_login'
        AND success    = 0
    `;
    const params = [username];

    if (since) {
      // Converteer Date naar ISO-string als dat nog niet gedaan is
      const sinceStr = since instanceof Date
        ? since.toISOString().slice(0, 19).replace('T', ' ')
        : since;
      query += ' AND timestamp > ?';
      params.push(sinceStr);
    }

    const [rows] = await db.pool.query(query, params);
    return rows[0].count;
  }

  async shouldLockAccount(username) {
    // ISO-string in plaats van Date object — SQLite accepteert geen Date
    const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000)
      .toISOString()
      .slice(0, 19)
      .replace('T', ' ');

    const failedAttempts = await this.getFailedLoginAttempts(username, fifteenMinutesAgo);
    return failedAttempts >= 5;
  }
}

export default new AuthService();