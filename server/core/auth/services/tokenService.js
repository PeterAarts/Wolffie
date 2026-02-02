import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import db from '../../database.js';

// JWT secrets from environment or generate random ones
const JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || crypto.randomBytes(32).toString('hex');
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || crypto.randomBytes(32).toString('hex');

// Token expiry times
const ACCESS_TOKEN_EXPIRY = '15m';      // 15 minutes
const REFRESH_TOKEN_EXPIRY = '7d';      // 7 days

class TokenService {
  /**
   * Generate access token (JWT)
   */
  generateAccessToken(user) {
    const payload = {
      userId: user.id,
      username: user.username,
      email: user.email,
      role: user.role
    };

    return jwt.sign(payload, JWT_ACCESS_SECRET, {
      expiresIn: ACCESS_TOKEN_EXPIRY,
      issuer: 'wattson',
      audience: 'wattson-client'
    });
  }

  /**
   * Generate refresh token (stored in database)
   */
  async generateRefreshToken(user, ipAddress = null, userAgent = null) {
    // Generate random token
    const token = crypto.randomBytes(40).toString('hex');

    // Calculate expiry date
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7); // 7 days

    // Store in database
    await db.pool.query(
      `INSERT INTO refresh_tokens 
       (user_id, token, expires_at, ip_address, user_agent)
       VALUES (?, ?, ?, ?, ?)`,
      [user.id, token, expiresAt, ipAddress, userAgent]
    );

    return token;
  }

  /**
   * Verify access token
   */
  verifyAccessToken(token) {
    try {
      const decoded = jwt.verify(token, JWT_ACCESS_SECRET, {
        issuer: 'wattson',
        audience: 'wattson-client'
      });
      return decoded;
    } catch (error) {
      if (error.name === 'TokenExpiredError') {
        throw new Error('TokenExpired');
      }
      if (error.name === 'JsonWebTokenError') {
        throw new Error('InvalidToken');
      }
      throw error;
    }
  }

  /**
   * Verify refresh token
   */
  async verifyRefreshToken(token) {
    const [rows] = await db.pool.query(
      `SELECT rt.*, u.id, u.username, u.email, u.role, u.is_active
       FROM refresh_tokens rt
       JOIN users u ON rt.user_id = u.id
       WHERE rt.token = ? AND rt.revoked = false`,
      [token]
    );

    if (rows.length === 0) {
      throw new Error('Invalid refresh token');
    }

    const tokenData = rows[0];

    // Check if token is expired
    if (new Date(tokenData.expires_at) < new Date()) {
      throw new Error('Refresh token expired');
    }

    // Check if user is active
    if (!tokenData.is_active) {
      throw new Error('User account is disabled');
    }

    return {
      id: tokenData.id,
      username: tokenData.username,
      email: tokenData.email,
      role: tokenData.role
    };
  }

  /**
   * Revoke refresh token
   */
  async revokeRefreshToken(token) {
    await db.pool.query(
      `UPDATE refresh_tokens SET revoked = true WHERE token = ?`,
      [token]
    );
  }

  /**
   * Revoke all refresh tokens for a user
   */
  async revokeAllUserTokens(userId) {
    await db.pool.query(
      `UPDATE refresh_tokens SET revoked = true WHERE user_id = ?`,
      [userId]
    );
  }

  /**
   * Clean up expired tokens
   */
  async cleanupExpiredTokens() {
    const [result] = await db.pool.query(
      `DELETE FROM refresh_tokens 
       WHERE expires_at < NOW() OR revoked = true`
    );

    return result.affectedRows;
  }

  /**
   * Get all active tokens for a user
   */
  async getUserTokens(userId) {
    const [rows] = await db.pool.query(
      `SELECT id, token, expires_at, ip_address, user_agent, created_at
       FROM refresh_tokens
       WHERE user_id = ? AND revoked = false AND expires_at > NOW()
       ORDER BY created_at DESC`,
      [userId]
    );

    return rows;
  }

  /**
   * Decode token without verification (for debugging)
   */
  decodeToken(token) {
    return jwt.decode(token);
  }

  /**
   * Get token info
   */
  getTokenInfo(token) {
    const decoded = this.decodeToken(token);
    if (!decoded) {
      return null;
    }

    return {
      userId: decoded.userId,
      username: decoded.username,
      email: decoded.email,
      role: decoded.role,
      issuedAt: new Date(decoded.iat * 1000),
      expiresAt: new Date(decoded.exp * 1000),
      issuer: decoded.iss,
      audience: decoded.aud
    };
  }

  /**
   * Check if access token is expired
   */
  isTokenExpired(token) {
    try {
      this.verifyAccessToken(token);
      return false;
    } catch (error) {
      if (error.message === 'TokenExpired') {
        return true;
      }
      return false;
    }
  }
}

export default new TokenService();