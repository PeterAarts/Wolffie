// core/auth/services/userService.js
//
// Wijzigingen t.o.v. MySQL-versie:
//   NOW()  →  datetime('now')  (zes plaatsen)
//
// result.insertId werkt correct met de better-sqlite3 shim (Pattern A).
// Boolean literals (is_active = true) werken in SQLite 3.23+ ongewijzigd.

import bcrypt from 'bcrypt';
import db     from '../../database.js';

const SALT_ROUNDS = 10;

class UserService {

  // ── Opzoeken ──────────────────────────────────────────────────────────────

  async getAllUsers() {
    const [rows] = await db.pool.query(
      `SELECT
         id, username, email, full_name, role,
         is_active, created_at, updated_at, last_password_update, last_login_at
       FROM users
       ORDER BY created_at DESC`
    );
    return rows;
  }

  async getUserById(id) {
    const [rows] = await db.pool.query(
      `SELECT
         id, username, email, full_name, role,
         is_active, created_at, updated_at, last_password_update, last_login_at
       FROM users
       WHERE id = ?`,
      [id]
    );
    return rows[0] || null;
  }

  async getUserByUsername(username) {
    const [rows] = await db.pool.query(
      'SELECT * FROM users WHERE username = ?',
      [username]
    );
    return rows[0] || null;
  }

  async getUserByEmail(email) {
    const [rows] = await db.pool.query(
      'SELECT * FROM users WHERE email = ?',
      [email]
    );
    return rows[0] || null;
  }

  // ── Aanmaken ──────────────────────────────────────────────────────────────
  //
  // MySQL gebruikte NOW() voor last_password_update — vervangen door datetime('now').
  // result.insertId werkt correct met de shim (Pattern A: const [result] = ...).

  async createUser({ username, email, password, full_name, role = 'user' }) {
    if (!username || !email || !password) {
      throw new Error('Username, email, and password are required');
    }

    if (await this.getUserByUsername(username)) throw new Error('Username already exists');
    if (await this.getUserByEmail(email))       throw new Error('Email already exists');

    const validRoles = ['admin', 'user', 'viewer'];
    if (!validRoles.includes(role)) throw new Error('Invalid role');

    const password_hash = await bcrypt.hash(password, SALT_ROUNDS);

    const [result] = await db.pool.query(
      `INSERT INTO users
         (username, email, password_hash, full_name, role, is_active, last_password_update)
       VALUES (?, ?, ?, ?, ?, 1, datetime('now'))`,
      [username, email, password_hash, full_name, role]
    );

    return {
      id:        result.insertId,
      username,
      email,
      full_name,
      role,
      is_active: true,
    };
  }

  // ── Bijwerken ─────────────────────────────────────────────────────────────
  //
  // MySQL gebruikte NOW() voor updated_at — vervangen door datetime('now').

  async updateUser(id, updates) {
    const user = await this.getUserById(id);
    if (!user) throw new Error('User not found');

    const allowedFields = ['email', 'full_name', 'role', 'is_active'];
    const updateFields  = [];
    const values        = [];

    for (const [key, value] of Object.entries(updates)) {
      if (allowedFields.includes(key)) {
        updateFields.push(`${key} = ?`);
        values.push(value);
      }
    }

    if (updateFields.length === 0) throw new Error('No valid fields to update');

    if (updates.email && updates.email !== user.email) {
      const existing = await this.getUserByEmail(updates.email);
      if (existing && existing.id !== id) throw new Error('Email already exists');
    }

    if (updates.role) {
      const validRoles = ['admin', 'user', 'viewer'];
      if (!validRoles.includes(updates.role)) throw new Error('Invalid role');
    }

    values.push(id);

    await db.pool.query(
      `UPDATE users SET ${updateFields.join(', ')}, updated_at = datetime('now') WHERE id = ?`,
      values
    );

    return this.getUserById(id);
  }

  // ── Wachtwoord ────────────────────────────────────────────────────────────
  //
  // MySQL gebruikte NOW() voor updated_at en last_password_update — vervangen.

  async changePassword(id, oldPassword, newPassword) {
    const [rows] = await db.pool.query(
      'SELECT password_hash FROM users WHERE id = ?',
      [id]
    );

    if (rows.length === 0) throw new Error('User not found');

    const isValid = await bcrypt.compare(oldPassword, rows[0].password_hash);
    if (!isValid) throw new Error('Current password is incorrect');

    if (newPassword.length < 8) throw new Error('Password must be at least 8 characters');

    const password_hash = await bcrypt.hash(newPassword, SALT_ROUNDS);

    await db.pool.query(
      `UPDATE users
          SET password_hash        = ?,
              updated_at           = datetime('now'),
              last_password_update = datetime('now')
        WHERE id = ?`,
      [password_hash, id]
    );

    return true;
  }

  async resetPassword(id, newPassword) {
    const user = await this.getUserById(id);
    if (!user) throw new Error('User not found');

    if (newPassword.length < 8) throw new Error('Password must be at least 8 characters');

    const password_hash = await bcrypt.hash(newPassword, SALT_ROUNDS);

    await db.pool.query(
      `UPDATE users
          SET password_hash        = ?,
              updated_at           = datetime('now'),
              last_password_update = datetime('now')
        WHERE id = ?`,
      [password_hash, id]
    );

    return true;
  }

  // ── Verwijderen ───────────────────────────────────────────────────────────

  async deleteUser(id) {
    const user = await this.getUserById(id);
    if (!user) throw new Error('User not found');

    if (user.role === 'admin') {
      const [admins] = await db.pool.query(
        `SELECT COUNT(*) as count FROM users WHERE role = 'admin' AND is_active = 1`
      );
      if (admins[0].count <= 1) throw new Error('Cannot delete the last admin user');
    }

    await db.pool.query('DELETE FROM users WHERE id = ?', [id]);

    return true;
  }

  // ── Authenticatie ─────────────────────────────────────────────────────────

  async verifyCredentials(identifier, password) {
    const [rows] = await db.pool.query(
      `SELECT * FROM users WHERE (username = ? OR email = ?) AND is_active = 1`,
      [identifier, identifier]
    );

    const user = rows[0];
    if (!user) return null;

    const isValid = await bcrypt.compare(password, user.password_hash);
    return isValid ? user : null;
  }

  // ── Last login ────────────────────────────────────────────────────────────
  //
  // MySQL gebruikte NOW() — vervangen door datetime('now').

  async updateLastLogin(userId) {
    await db.pool.query(
      `UPDATE users SET last_login_at = datetime('now') WHERE id = ?`,
      [userId]
    );
  }

  // ── Statistieken ──────────────────────────────────────────────────────────

  async getUserStats() {
    const [stats] = await db.pool.query(`
      SELECT
        COUNT(*)                                          AS total_users,
        SUM(CASE WHEN is_active = 1    THEN 1 ELSE 0 END) AS active_users,
        SUM(CASE WHEN role = 'admin'   THEN 1 ELSE 0 END) AS admin_users,
        SUM(CASE WHEN role = 'user'    THEN 1 ELSE 0 END) AS regular_users,
        SUM(CASE WHEN role = 'viewer'  THEN 1 ELSE 0 END) AS viewer_users
      FROM users
    `);

    return stats[0];
  }

  // ── Default admin ─────────────────────────────────────────────────────────

  async createDefaultAdminIfNeeded() {
    const [users] = await db.pool.query('SELECT COUNT(*) as count FROM users');

    if (users[0].count === 0) {
      console.log('   - No users found, creating default admin...');

      const admin = await this.createUser({
        username:  'admin',
        email:     'admin@localhost',
        password:  'admin123',
        full_name: 'System Administrator',
        role:      'admin',
      });

      console.log('   \x1b[32m✓\x1b[0m Default admin created');
      console.log('     Username: admin');
      console.log('     Password: admin123');
      console.log('     \x1b[33m⚠ Wijzig dit wachtwoord direct na de eerste login!\x1b[0m');

      return admin;
    }

    return null;
  }
}

export default new UserService();