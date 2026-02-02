// user crud services
import bcrypt from 'bcrypt';
import db from '../../database.js';

const SALT_ROUNDS = 10;

class UserService {
  /**
   * Get all users
   */
  async getAllUsers() {
    const [rows] = await db.pool.query(
      `SELECT 
        id, username, email, full_name, role, 
        is_active, created_at, updated_at, last_login_at
       FROM users
       ORDER BY created_at DESC`
    );
    return rows;
  }

  /**
   * Get user by ID
   */
  async getUserById(id) {
    const [rows] = await db.pool.query(
      `SELECT 
        id, username, email, full_name, role, 
        is_active, created_at, updated_at, last_login_at
       FROM users
       WHERE id = ?`,
      [id]
    );
    return rows[0] || null;
  }

  /**
   * Get user by username
   */
  async getUserByUsername(username) {
    const [rows] = await db.pool.query(
      `SELECT * FROM users WHERE username = ?`,
      [username]
    );
    return rows[0] || null;
  }

  /**
   * Get user by email
   */
  async getUserByEmail(email) {
    const [rows] = await db.pool.query(
      `SELECT * FROM users WHERE email = ?`,
      [email]
    );
    return rows[0] || null;
  }

  /**
   * Create a new user
   */
  async createUser({ username, email, password, full_name, role = 'user' }) {
    // Validate input
    if (!username || !email || !password) {
      throw new Error('Username, email, and password are required');
    }

    // Check if username already exists
    const existingUsername = await this.getUserByUsername(username);
    if (existingUsername) {
      throw new Error('Username already exists');
    }

    // Check if email already exists
    const existingEmail = await this.getUserByEmail(email);
    if (existingEmail) {
      throw new Error('Email already exists');
    }

    // Validate role
    const validRoles = ['admin', 'user', 'viewer'];
    if (!validRoles.includes(role)) {
      throw new Error('Invalid role');
    }

    // Hash password
    const password_hash = await bcrypt.hash(password, SALT_ROUNDS);

    // Insert user
    const [result] = await db.pool.query(
      `INSERT INTO users (username, email, password_hash, full_name, role, is_active)
       VALUES (?, ?, ?, ?, ?, true)`,
      [username, email, password_hash, full_name, role]
    );

    return {
      id: result.insertId,
      username,
      email,
      full_name,
      role,
      is_active: true
    };
  }

  /**
   * Update user
   */
  async updateUser(id, updates) {
    const user = await this.getUserById(id);
    if (!user) {
      throw new Error('User not found');
    }

    const allowedFields = ['email', 'full_name', 'role', 'is_active'];
    const updateFields = [];
    const values = [];

    for (const [key, value] of Object.entries(updates)) {
      if (allowedFields.includes(key)) {
        updateFields.push(`${key} = ?`);
        values.push(value);
      }
    }

    if (updateFields.length === 0) {
      throw new Error('No valid fields to update');
    }

    // Check if email is being changed and is unique
    if (updates.email && updates.email !== user.email) {
      const existingEmail = await this.getUserByEmail(updates.email);
      if (existingEmail && existingEmail.id !== id) {
        throw new Error('Email already exists');
      }
    }

    // Validate role if being updated
    if (updates.role) {
      const validRoles = ['admin', 'user', 'viewer'];
      if (!validRoles.includes(updates.role)) {
        throw new Error('Invalid role');
      }
    }

    values.push(id);

    await db.pool.query(
      `UPDATE users SET ${updateFields.join(', ')}, updated_at = NOW()
       WHERE id = ?`,
      values
    );

    return this.getUserById(id);
  }

  /**
   * Change user password
   */
  async changePassword(id, oldPassword, newPassword) {
    const [rows] = await db.pool.query(
      'SELECT password_hash FROM users WHERE id = ?',
      [id]
    );

    if (rows.length === 0) {
      throw new Error('User not found');
    }

    // Verify old password
    const isValid = await bcrypt.compare(oldPassword, rows[0].password_hash);
    if (!isValid) {
      throw new Error('Current password is incorrect');
    }

    // Validate new password
    if (newPassword.length < 8) {
      throw new Error('Password must be at least 8 characters');
    }

    // Hash new password
    const password_hash = await bcrypt.hash(newPassword, SALT_ROUNDS);

    await db.pool.query(
      `UPDATE users SET password_hash = ?, updated_at = NOW()
       WHERE id = ?`,
      [password_hash, id]
    );

    return true;
  }

  /**
   * Reset user password (admin function)
   */
  async resetPassword(id, newPassword) {
    const user = await this.getUserById(id);
    if (!user) {
      throw new Error('User not found');
    }

    // Validate new password
    if (newPassword.length < 8) {
      throw new Error('Password must be at least 8 characters');
    }

    // Hash new password
    const password_hash = await bcrypt.hash(newPassword, SALT_ROUNDS);

    await db.pool.query(
      `UPDATE users SET password_hash = ?, updated_at = NOW()
       WHERE id = ?`,
      [password_hash, id]
    );

    return true;
  }

  /**
   * Delete user
   */
  async deleteUser(id) {
    const user = await this.getUserById(id);
    if (!user) {
      throw new Error('User not found');
    }

    // Don't allow deleting the last admin
    if (user.role === 'admin') {
      const [admins] = await db.pool.query(
        `SELECT COUNT(*) as count FROM users WHERE role = 'admin' AND is_active = true`
      );
      if (admins[0].count <= 1) {
        throw new Error('Cannot delete the last admin user');
      }
    }

    await db.pool.query('DELETE FROM users WHERE id = ?', [id]);

    return true;
  }

  /**
   * Verify user credentials
   */
  async verifyCredentials(username, password) {
    const user = await this.getUserByUsername(username);
    if (!user) {
      return null;
    }

    if (!user.is_active) {
      throw new Error('User account is disabled');
    }

    const isValid = await bcrypt.compare(password, user.password_hash);
    if (!isValid) {
      return null;
    }

    return user;
  }

  /**
   * Update last login time
   */
  async updateLastLogin(userId) {
    await db.pool.query(
      `UPDATE users SET last_login_at = NOW() WHERE id = ?`,
      [userId]
    );
  }

  /**
   * Get user statistics
   */
  async getUserStats() {
    const [stats] = await db.pool.query(`
      SELECT 
        COUNT(*) as total_users,
        SUM(CASE WHEN is_active = true THEN 1 ELSE 0 END) as active_users,
        SUM(CASE WHEN role = 'admin' THEN 1 ELSE 0 END) as admin_users,
        SUM(CASE WHEN role = 'user' THEN 1 ELSE 0 END) as regular_users,
        SUM(CASE WHEN role = 'viewer' THEN 1 ELSE 0 END) as viewer_users
      FROM users
    `);

    return stats[0];
  }

  /**
   * Create default admin user if no users exist
   */
  async createDefaultAdminIfNeeded() {
    const [users] = await db.pool.query('SELECT COUNT(*) as count FROM users');
    
    if (users[0].count === 0) {
      console.log('No users found. Creating default admin user...');
      
      const defaultAdmin = await this.createUser({
        username: 'admin',
        email: 'admin@localhost',
        password: 'admin123',
        full_name: 'System Administrator',
        role: 'admin'
      });

      console.log('✓ Default admin user created');
      console.log('  Username: admin');
      console.log('  Password: admin123');
      console.log('  ⚠️  PLEASE CHANGE THE PASSWORD IMMEDIATELY!');

      return defaultAdmin;
    }

    return null;
  }
}

export default new UserService();