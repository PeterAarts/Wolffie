// core/auth/services/tokenService.js
//
// Wijzigingen t.o.v. MySQL-versie:
//   NOW()  →  datetime('now')  (twee plaatsen: cleanupExpiredTokens, getUserTokens)
//
// Alle andere SQL en de result.affectedRows toegang werken correct
// met de better-sqlite3 shim in database.js.

import jwt    from 'jsonwebtoken';
import crypto from 'crypto';
import db     from '../../database.js';

const JWT_ACCESS_SECRET  = process.env.JWT_ACCESS_SECRET  || crypto.randomBytes(32).toString('hex');
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || crypto.randomBytes(32).toString('hex');

const ACCESS_TOKEN_EXPIRY  = '15m';
const REFRESH_TOKEN_EXPIRY = '7d';

class TokenService {

  // ── Genereren ─────────────────────────────────────────────────────────────

  generateAccessToken(user) {
    const payload = {
      userId:   user.id,
      username: user.username,
      email:    user.email,
      role:     user.role,
    };

    return jwt.sign(payload, JWT_ACCESS_SECRET, {
      expiresIn: ACCESS_TOKEN_EXPIRY,
      issuer:    'wattson',
      audience:  'wattson-client',
    });
  }

  async generateRefreshToken(user, ipAddress = null, userAgent = null) {
    const token = crypto.randomBytes(40).toString('hex');

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    await db.pool.query(
      `INSERT INTO refresh_tokens
         (user_id, token, expires_at, ip_address, user_agent)
       VALUES (?, ?, ?, ?, ?)`,
      [user.id, token, expiresAt.toISOString().replace('T', ' ').slice(0, 19), ipAddress, userAgent]
    );

    return token;
  }

  // ── Verifiëren ────────────────────────────────────────────────────────────

  verifyAccessToken(token) {
    try {
      return jwt.verify(token, JWT_ACCESS_SECRET, {
        issuer:   'wattson',
        audience: 'wattson-client',
      });
    } catch (error) {
      if (error.name === 'TokenExpiredError')  throw new Error('TokenExpired');
      if (error.name === 'JsonWebTokenError')  throw new Error('InvalidToken');
      throw error;
    }
  }

  async verifyRefreshToken(token) {
    const [rows] = await db.pool.query(
      `SELECT rt.*, u.id, u.username, u.email, u.role, u.is_active
       FROM refresh_tokens rt
       JOIN users u ON rt.user_id = u.id
       WHERE rt.token = ? AND rt.revoked = false`,
      [token]
    );

    if (rows.length === 0) throw new Error('Invalid refresh token');

    const tokenData = rows[0];

    if (new Date(tokenData.expires_at) < new Date()) throw new Error('Refresh token expired');
    if (!tokenData.is_active)                        throw new Error('User account is disabled');

    return {
      id:       tokenData.id,
      username: tokenData.username,
      email:    tokenData.email,
      role:     tokenData.role,
    };
  }

  // ── Intrekken ─────────────────────────────────────────────────────────────

  async revokeRefreshToken(token) {
    await db.pool.query(
      'UPDATE refresh_tokens SET revoked = true WHERE token = ?',
      [token]
    );
  }

  async revokeAllUserTokens(userId) {
    await db.pool.query(
      'UPDATE refresh_tokens SET revoked = true WHERE user_id = ?',
      [userId]
    );
  }

  // ── Opruimen ──────────────────────────────────────────────────────────────
  //
  // MySQL gebruikte NOW() — vervangen door datetime('now').
  // result.affectedRows werkt correct met de shim (Pattern A: const [result] = ...).

  async cleanupExpiredTokens() {
    const [result] = await db.pool.query(
      `DELETE FROM refresh_tokens
       WHERE expires_at < datetime('now') OR revoked = true`
    );

    return result.affectedRows;
  }

  // ── Ophalen ───────────────────────────────────────────────────────────────
  //
  // MySQL gebruikte NOW() — vervangen door datetime('now').

  async getUserTokens(userId) {
    const [rows] = await db.pool.query(
      `SELECT id, token, expires_at, ip_address, user_agent, created_at
       FROM refresh_tokens
       WHERE user_id = ?
         AND revoked   = false
         AND expires_at > datetime('now')
       ORDER BY created_at DESC`,
      [userId]
    );

    return rows;
  }

  // ── Hulpfuncties ──────────────────────────────────────────────────────────

  decodeToken(token) {
    return jwt.decode(token);
  }

  getTokenInfo(token) {
    const decoded = this.decodeToken(token);
    if (!decoded) return null;

    return {
      userId:    decoded.userId,
      username:  decoded.username,
      email:     decoded.email,
      role:      decoded.role,
      issuedAt:  new Date(decoded.iat * 1000),
      expiresAt: new Date(decoded.exp * 1000),
      issuer:    decoded.iss,
      audience:  decoded.aud,
    };
  }

  isTokenExpired(token) {
    try {
      this.verifyAccessToken(token);
      return false;
    } catch (error) {
      return error.message === 'TokenExpired';
    }
  }
}

export default new TokenService();