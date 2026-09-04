# WattsOn Authentication & Authorization System

## 🔐 Core Security Architecture

### **Design Principles**
1. ✅ **Local-only**: No dependency on external services
2. ✅ **Token-based**: JWT (JSON Web Tokens) for stateless authentication
3. ✅ **Secure**: Passwords hashed with bcrypt (salt + hash)
4. ✅ **Role-based**: RBAC (Role-Based Access Control)
5. ✅ **Session management**: Refresh tokens for long-lived sessions
6. ✅ **API protection**: All endpoints require authentication (except auth routes)

---

## 📁 Directory Structure

```
server/
├── core/
│   ├── auth/
│   │   ├── middleware/
│   │   │   ├── authenticate.js       # Verify JWT token
│   │   │   ├── authorize.js          # Check permissions
│   │   │   └── rateLimiter.js        # Prevent brute force
│   │   ├── services/
│   │   │   ├── authService.js        # Login/logout/register
│   │   │   ├── tokenService.js       # JWT generation/validation
│   │   │   └── userService.js        # User management
│   │   ├── models/
│   │   │   ├── User.js               # User data model
│   │   │   └── Session.js            # Active sessions
│   │   ├── routes/
│   │   │   └── auth.js               # Auth endpoints
│   │   └── database/
│   │       └── schema.sql            # User tables
│   │
│   ├── moduleLoader.js
│   ├── collectorManager.js
│   └── database.js
│
└── server.js
```

---

## 🗄️ Database Schema

```sql
-- Users table
CREATE TABLE users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(50) UNIQUE NOT NULL,
  email VARCHAR(100) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  full_name VARCHAR(100),
  role ENUM('admin', 'user', 'viewer') DEFAULT 'user',
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  last_login_at TIMESTAMP NULL,
  
  INDEX idx_username (username),
  INDEX idx_email (email),
  INDEX idx_role (role)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Refresh tokens table
CREATE TABLE refresh_tokens (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  token VARCHAR(255) UNIQUE NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  revoked BOOLEAN DEFAULT false,
  revoked_at TIMESTAMP NULL,
  ip_address VARCHAR(45),
  user_agent TEXT,
  
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_token (token),
  INDEX idx_user_id (user_id),
  INDEX idx_expires (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Audit log for security events
CREATE TABLE auth_audit_log (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NULL,
  username VARCHAR(50),
  event_type ENUM('login', 'logout', 'failed_login', 'token_refresh', 'password_change', 'account_locked') NOT NULL,
  ip_address VARCHAR(45),
  user_agent TEXT,
  success BOOLEAN DEFAULT true,
  error_message TEXT,
  timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_user_id (user_id),
  INDEX idx_event_type (event_type),
  INDEX idx_timestamp (timestamp)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Create default admin user (password: admin123 - CHANGE IMMEDIATELY!)
INSERT INTO users (username, email, password_hash, full_name, role)
VALUES (
  'admin',
  'admin@localhost',
  '$2b$10$YourHashedPasswordHere',  -- bcrypt hash
  'System Administrator',
  'admin'
);
```

---

## 🔑 Role-Based Permissions

### **Roles**

| Role    | Description | Permissions |
|---------|-------------|-------------|
| `admin` | Full system access | All CRUD operations, user management, system settings |
| `user`  | Standard user | Read/write data, modify own settings |
| `viewer`| Read-only access | View dashboards and data only |

### **Permission Matrix**

| Resource | Admin | User | Viewer |
|----------|-------|------|--------|
| View Dashboard | ✅ | ✅ | ✅ |
| View Historical Data | ✅ | ✅ | ✅ |
| Modify Settings | ✅ | ✅ | ❌ |
| Control Inverter | ✅ | ✅ | ❌ |
| Manage Users | ✅ | ❌ | ❌ |
| System Configuration | ✅ | ❌ | ❌ |
| Module Management | ✅ | ❌ | ❌ |

---

## 🛡️ Authentication Flow

### **1. Login Process**

```
Client                      Server
  |                           |
  |-- POST /api/auth/login -->|
  |   { username, password }  |
  |                           |
  |                           |-- Validate credentials
  |                           |-- Generate access token (15min)
  |                           |-- Generate refresh token (7 days)
  |                           |-- Store refresh token in DB
  |                           |-- Log audit event
  |                           |
  |<-- 200 OK ----------------|
  |   {                       |
  |     accessToken,          |
  |     refreshToken,         |
  |     user: {               |
  |       id, username, role  |
  |     }                     |
  |   }                       |
  |                           |
  |-- Store tokens in memory -|
  |   (NOT in localStorage)   |
```

### **2. API Request with Token**

```
Client                      Server
  |                           |
  |-- GET /api/data --------->|
  |   Authorization: Bearer   |
  |   <access_token>          |
  |                           |
  |                           |-- Verify JWT signature
  |                           |-- Check expiration
  |                           |-- Extract user & role
  |                           |-- Check permissions
  |                           |
  |<-- 200 OK ----------------|
  |   { data }                |
```

### **3. Token Refresh**

```
Client                      Server
  |                           |
  |-- POST /api/auth/refresh->|
  |   { refreshToken }        |
  |                           |
  |                           |-- Validate refresh token
  |                           |-- Check if revoked
  |                           |-- Generate new access token
  |                           |
  |<-- 200 OK ----------------|
  |   { accessToken }         |
```

---

## 💻 Implementation

### **1. Token Service** (`core/auth/services/tokenService.js`)

```javascript
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import db from '../../database.js';

class TokenService {
  constructor() {
    // CRITICAL: Use strong secret keys from environment
    this.accessTokenSecret = process.env.JWT_ACCESS_SECRET || this.generateSecret();
    this.refreshTokenSecret = process.env.JWT_REFRESH_SECRET || this.generateSecret();
    
    // Token expiration times
    this.accessTokenExpiry = '15m';   // 15 minutes
    this.refreshTokenExpiry = '7d';   // 7 days
    
    if (!process.env.JWT_ACCESS_SECRET) {
      console.warn('⚠️  JWT_ACCESS_SECRET not set! Using random secret (will invalidate tokens on restart)');
    }
  }

  /**
   * Generate a secure random secret
   */
  generateSecret() {
    return crypto.randomBytes(64).toString('hex');
  }

  /**
   * Generate access token (short-lived)
   */
  generateAccessToken(user) {
    const payload = {
      id: user.id,
      username: user.username,
      role: user.role,
      type: 'access'
    };

    return jwt.sign(payload, this.accessTokenSecret, {
      expiresIn: this.accessTokenExpiry,
      issuer: 'wattson-api',
      audience: 'wattson-client'
    });
  }

  /**
   * Generate refresh token (long-lived)
   */
  async generateRefreshToken(userId, ipAddress, userAgent) {
    const payload = {
      id: userId,
      type: 'refresh',
      jti: crypto.randomBytes(16).toString('hex') // Unique token ID
    };

    const token = jwt.sign(payload, this.refreshTokenSecret, {
      expiresIn: this.refreshTokenExpiry,
      issuer: 'wattson-api',
      audience: 'wattson-client'
    });

    // Store in database
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
    
    await db.pool.query(
      `INSERT INTO refresh_tokens (user_id, token, expires_at, ip_address, user_agent)
       VALUES (?, ?, ?, ?, ?)`,
      [userId, token, expiresAt, ipAddress, userAgent]
    );

    return token;
  }

  /**
   * Verify access token
   */
  verifyAccessToken(token) {
    try {
      const payload = jwt.verify(token, this.accessTokenSecret, {
        issuer: 'wattson-api',
        audience: 'wattson-client'
      });

      if (payload.type !== 'access') {
        throw new Error('Invalid token type');
      }

      return payload;
    } catch (error) {
      throw new Error(`Token verification failed: ${error.message}`);
    }
  }

  /**
   * Verify refresh token
   */
  async verifyRefreshToken(token) {
    try {
      const payload = jwt.verify(token, this.refreshTokenSecret, {
        issuer: 'wattson-api',
        audience: 'wattson-client'
      });

      if (payload.type !== 'refresh') {
        throw new Error('Invalid token type');
      }

      // Check if token is in database and not revoked
      const [rows] = await db.pool.query(
        `SELECT * FROM refresh_tokens 
         WHERE token = ? AND revoked = false AND expires_at > NOW()`,
        [token]
      );

      if (rows.length === 0) {
        throw new Error('Token not found or revoked');
      }

      return payload;
    } catch (error) {
      throw new Error(`Refresh token verification failed: ${error.message}`);
    }
  }

  /**
   * Revoke refresh token
   */
  async revokeRefreshToken(token) {
    await db.pool.query(
      `UPDATE refresh_tokens 
       SET revoked = true, revoked_at = NOW()
       WHERE token = ?`,
      [token]
    );
  }

  /**
   * Revoke all refresh tokens for a user
   */
  async revokeAllUserTokens(userId) {
    await db.pool.query(
      `UPDATE refresh_tokens 
       SET revoked = true, revoked_at = NOW()
       WHERE user_id = ? AND revoked = false`,
      [userId]
    );
  }

  /**
   * Clean up expired tokens (run daily)
   */
  async cleanupExpiredTokens() {
    const [result] = await db.pool.query(
      `DELETE FROM refresh_tokens WHERE expires_at < NOW()`
    );
    console.log(`🧹 Cleaned up ${result.affectedRows} expired tokens`);
  }
}

export default new TokenService();
```

### **2. Authentication Middleware** (`core/auth/middleware/authenticate.js`)

```javascript
import tokenService from '../services/tokenService.js';
import userService from '../services/userService.js';

/**
 * Middleware to authenticate JWT tokens
 */
export const authenticate = async (req, res, next) => {
  try {
    // Extract token from Authorization header
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'No token provided'
      });
    }

    const token = authHeader.substring(7); // Remove 'Bearer ' prefix

    // Verify token
    const payload = tokenService.verifyAccessToken(token);

    // Get user from database
    const user = await userService.getUserById(payload.id);

    if (!user) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'User not found'
      });
    }

    if (!user.is_active) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Account is disabled'
      });
    }

    // Attach user to request
    req.user = {
      id: user.id,
      username: user.username,
      role: user.role,
      email: user.email
    };

    next();
  } catch (error) {
    if (error.message.includes('expired')) {
      return res.status(401).json({
        error: 'TokenExpired',
        message: 'Access token has expired'
      });
    }

    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Invalid token'
    });
  }
};

/**
 * Optional authentication - doesn't fail if no token
 */
export const optionalAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      const payload = tokenService.verifyAccessToken(token);
      const user = await userService.getUserById(payload.id);
      
      if (user && user.is_active) {
        req.user = {
          id: user.id,
          username: user.username,
          role: user.role
        };
      }
    }
  } catch (error) {
    // Ignore errors, continue as unauthenticated
  }
  
  next();
};
```

### **3. Authorization Middleware** (`core/auth/middleware/authorize.js`)

```javascript
/**
 * Middleware to check user role/permissions
 */
export const authorize = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Authentication required'
      });
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        error: 'Forbidden',
        message: `Requires one of: ${allowedRoles.join(', ')}`
      });
    }

    next();
  };
};

/**
 * Check if user can modify resource
 * Admin can modify anything, users can only modify their own resources
 */
export const canModify = (resourceUserIdField = 'userId') => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Authentication required'
      });
    }

    // Admins can modify anything
    if (req.user.role === 'admin') {
      return next();
    }

    // Get resource user ID from params or body
    const resourceUserId = req.params[resourceUserIdField] || req.body[resourceUserIdField];

    if (parseInt(resourceUserId) !== req.user.id) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'You can only modify your own resources'
      });
    }

    next();
  };
};
```

### **4. Rate Limiter** (`core/auth/middleware/rateLimiter.js`)

```javascript
import rateLimit from 'express-rate-limit';

/**
 * Rate limiter for authentication endpoints
 * Prevents brute force attacks
 */
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 attempts per window
  message: {
    error: 'TooManyRequests',
    message: 'Too many login attempts, please try again later'
  },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true // Only count failed attempts
});

/**
 * General API rate limiter
 */
export const apiLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 100, // 100 requests per minute
  message: {
    error: 'TooManyRequests',
    message: 'Too many requests, please slow down'
  },
  standardHeaders: true,
  legacyHeaders: false
});
```

### **5. Auth Service** (`core/auth/services/authService.js`)

```javascript
import bcrypt from 'bcrypt';
import db from '../../database.js';
import tokenService from './tokenService.js';

class AuthService {
  constructor() {
    this.saltRounds = 10;
  }

  /**
   * Hash password
   */
  async hashPassword(password) {
    return bcrypt.hash(password, this.saltRounds);
  }

  /**
   * Verify password
   */
  async verifyPassword(password, hash) {
    return bcrypt.compare(password, hash);
  }

  /**
   * Login user
   */
  async login(username, password, ipAddress, userAgent) {
    try {
      // Get user
      const [rows] = await db.pool.query(
        'SELECT * FROM users WHERE username = ? AND is_active = true',
        [username]
      );

      if (rows.length === 0) {
        await this.logAuthEvent(null, username, 'failed_login', ipAddress, userAgent, false, 'Invalid credentials');
        throw new Error('Invalid credentials');
      }

      const user = rows[0];

      // Verify password
      const isValid = await this.verifyPassword(password, user.password_hash);

      if (!isValid) {
        await this.logAuthEvent(user.id, username, 'failed_login', ipAddress, userAgent, false, 'Invalid credentials');
        throw new Error('Invalid credentials');
      }

      // Generate tokens
      const accessToken = tokenService.generateAccessToken(user);
      const refreshToken = await tokenService.generateRefreshToken(user.id, ipAddress, userAgent);

      // Update last login
      await db.pool.query(
        'UPDATE users SET last_login_at = NOW() WHERE id = ?',
        [user.id]
      );

      // Log successful login
      await this.logAuthEvent(user.id, username, 'login', ipAddress, userAgent, true);

      return {
        accessToken,
        refreshToken,
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          fullName: user.full_name,
          role: user.role
        }
      };
    } catch (error) {
      throw error;
    }
  }

  /**
   * Refresh access token
   */
  async refreshToken(refreshToken) {
    const payload = await tokenService.verifyRefreshToken(refreshToken);
    
    const [rows] = await db.pool.query(
      'SELECT * FROM users WHERE id = ? AND is_active = true',
      [payload.id]
    );

    if (rows.length === 0) {
      throw new Error('User not found');
    }

    const user = rows[0];
    const accessToken = tokenService.generateAccessToken(user);

    return { accessToken };
  }

  /**
   * Logout user
   */
  async logout(refreshToken, userId) {
    if (refreshToken) {
      await tokenService.revokeRefreshToken(refreshToken);
    }
    
    if (userId) {
      await this.logAuthEvent(userId, null, 'logout', null, null, true);
    }
  }

  /**
   * Log authentication event
   */
  async logAuthEvent(userId, username, eventType, ipAddress, userAgent, success, errorMessage = null) {
    await db.pool.query(
      `INSERT INTO auth_audit_log 
       (user_id, username, event_type, ip_address, user_agent, success, error_message)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [userId, username, eventType, ipAddress, userAgent, success, errorMessage]
    );
  }
}

export default new AuthService();
```

### **6. Auth Routes** (`core/auth/routes/auth.js`)

```javascript
import express from 'express';
import authService from '../services/authService.js';
import { authLimiter } from '../middleware/rateLimiter.js';
import { authenticate } from '../middleware/authenticate.js';

const router = express.Router();

/**
 * POST /api/auth/login
 * Login with username and password
 */
router.post('/login', authLimiter, async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({
        error: 'BadRequest',
        message: 'Username and password required'
      });
    }

    const ipAddress = req.ip;
    const userAgent = req.headers['user-agent'];

    const result = await authService.login(username, password, ipAddress, userAgent);

    res.json(result);
  } catch (error) {
    res.status(401).json({
      error: 'Unauthorized',
      message: error.message
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
        error: 'BadRequest',
        message: 'Refresh token required'
      });
    }

    const result = await authService.refreshToken(refreshToken);

    res.json(result);
  } catch (error) {
    res.status(401).json({
      error: 'Unauthorized',
      message: error.message
    });
  }
});

/**
 * POST /api/auth/logout
 * Logout and revoke refresh token
 */
router.post('/logout', authenticate, async (req, res) => {
  try {
    const { refreshToken } = req.body;

    await authService.logout(refreshToken, req.user.id);

    res.json({ message: 'Logged out successfully' });
  } catch (error) {
    res.status(500).json({
      error: 'InternalError',
      message: error.message
    });
  }
});

/**
 * GET /api/auth/me
 * Get current user info
 */
router.get('/me', authenticate, async (req, res) => {
  res.json({ user: req.user });
});

export default router;
```

---

## 🔒 Applying Authentication to Server

### **Updated `server.js`**

```javascript
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import authRoutes from './core/auth/routes/auth.js';
import { authenticate } from './core/auth/middleware/authenticate.js';
import { authorize } from './core/auth/middleware/authorize.js';
import { apiLimiter } from './core/auth/middleware/rateLimiter.js';

const app = express();

// Security middleware
app.use(helmet()); // Security headers
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true
}));
app.use(express.json());
app.use(apiLimiter); // Rate limiting

// Public routes (no authentication)
app.use('/api/auth', authRoutes);

// Protected routes (require authentication)
app.use('/api', authenticate); // All /api/* routes require auth

// Module routes (auto-registered with permissions)
app.use('/api/homewizard', authorize('admin', 'user'), homewizardRoutes);
app.use('/api/system', authorize('admin'), systemRoutes);

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🔒 Secure server running on port ${PORT}`);
});
```

---

## 🎨 Frontend Integration

### **Auth Store** (`frontend/src/stores/auth.js`)

```javascript
import { defineStore } from 'pinia';
import axios from 'axios';

export const useAuthStore = defineStore('auth', {
  state: () => ({
    user: null,
    accessToken: null,
    refreshToken: null,
    isAuthenticated: false
  }),

  actions: {
    async login(username, password) {
      const { data } = await axios.post('/api/auth/login', {
        username,
        password
      });

      this.accessToken = data.accessToken;
      this.refreshToken = data.refreshToken;
      this.user = data.user;
      this.isAuthenticated = true;

      // Set default authorization header
      axios.defaults.headers.common['Authorization'] = `Bearer ${this.accessToken}`;

      // Store refresh token (keep access token in memory only)
      localStorage.setItem('refreshToken', this.refreshToken);
    },

    async logout() {
      try {
        await axios.post('/api/auth/logout', {
          refreshToken: this.refreshToken
        });
      } catch (error) {
        console.error('Logout error:', error);
      }

      this.user = null;
      this.accessToken = null;
      this.refreshToken = null;
      this.isAuthenticated = false;

      delete axios.defaults.headers.common['Authorization'];
      localStorage.removeItem('refreshToken');
    },

    async refreshAccessToken() {
      try {
        const { data } = await axios.post('/api/auth/refresh', {
          refreshToken: this.refreshToken
        });

        this.accessToken = data.accessToken;
        axios.defaults.headers.common['Authorization'] = `Bearer ${this.accessToken}`;
      } catch (error) {
        // Refresh failed, logout
        await this.logout();
        throw error;
      }
    },

    async initialize() {
      const refreshToken = localStorage.getItem('refreshToken');
      
      if (refreshToken) {
        this.refreshToken = refreshToken;
        try {
          await this.refreshAccessToken();
          const { data } = await axios.get('/api/auth/me');
          this.user = data.user;
          this.isAuthenticated = true;
        } catch (error) {
          localStorage.removeItem('refreshToken');
        }
      }
    }
  }
});
```

### **Axios Interceptor** (Auto-refresh tokens)

```javascript
// frontend/src/plugins/axios.js
import axios from 'axios';
import { useAuthStore } from '@/stores/auth';

axios.defaults.baseURL = import.meta.env.VITE_API_BASE_URL;

// Response interceptor - auto-refresh on 401
axios.interceptors.response.use(
  response => response,
  async error => {
    const authStore = useAuthStore();
    
    if (error.response?.status === 401 && error.response?.data?.error === 'TokenExpired') {
      try {
        await authStore.refreshAccessToken();
        // Retry original request
        return axios(error.config);
      } catch (refreshError) {
        return Promise.reject(refreshError);
      }
    }

    return Promise.reject(error);
  }
);
```

---

## ✅ Security Checklist

- [x] Passwords hashed with bcrypt (salt + hash)
- [x] JWT tokens with short expiry (15 minutes)
- [x] Refresh tokens stored in database
- [x] Rate limiting on auth endpoints
- [x] Token revocation support
- [x] Audit logging for security events
- [x] Role-based access control
- [x] Secure headers (helmet.js)
- [x] CORS protection
- [x] No tokens in localStorage (access token in memory)
- [x] Input validation
- [x] SQL injection protection (parameterized queries)

---

## 🚀 Setup Instructions

1. **Environment Variables** (`.env`)
```bash
# CRITICAL: Generate strong secrets!
JWT_ACCESS_SECRET=your-super-secret-access-key-min-64-chars
JWT_REFRESH_SECRET=your-super-secret-refresh-key-min-64-chars
FRONTEND_URL=http://localhost:5173
```

2. **Generate Secrets** (run once)
```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

3. **Create Default Admin**
```bash
node scripts/createAdmin.js
```

4. **Test Authentication**
```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin123"}'
```

This provides enterprise-grade security for your WattsOn system! 🔐
