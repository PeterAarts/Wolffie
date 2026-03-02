// core/auth/middleware/session.js - Session Configuration
import session from 'express-session';
import MySQLStore from 'express-mysql-session';
import db from '../../database.js';

/**
 * Create and configure session middleware with MySQL store
 * Sessions persist across server restarts and browser refreshes
 */
export function createSessionMiddleware() {
  const MySQLStoreClass = MySQLStore(session);
  
  // Create MySQL session store
  const sessionStore = new MySQLStoreClass({
    // Reuse existing database connection pool
    clearExpired: true,
    checkExpirationInterval: 900000, // Clean up expired sessions every 15 minutes
    expiration: 1000 * 60 * 60 * 8, // Sessions expire after 8 hours
    createDatabaseTable: true, // Auto-create sessions table
    schema: {
      tableName: 'sessions',
      columnNames: {
        session_id: 'session_id',
        expires: 'expires',
        data: 'data'
      }
    }
  }, db.pool);

  // Handle store errors
  sessionStore.on('error', (error) => {
    console.error('❌ Session store error:', error);
  });

  // Configure session middleware
  return session({
    key: 'wattson_session_id',
    secret: process.env.SESSION_SECRET || 'wattson-energy-monitor-change-in-production',
    store: sessionStore,
    resave: false, // Don't save session if unmodified
    saveUninitialized: false, // Don't create session until something stored
    rolling: true, // Reset expiration on each request
    cookie: {
      maxAge: 1000 * 60 * 60 * 8, // 8 hours
      httpOnly: true, // Prevent XSS attacks
      secure: process.env.NODE_ENV === 'production', // HTTPS only in production
      sameSite: 'lax', // CSRF protection
      path: '/'
    }
  });
}

/**
 * Middleware to attach session info to response (for debugging)
 */
export function attachSessionInfo(req, res, next) {
  // Add session info to response headers for debugging
  if (req.session) {
    res.setHeader('X-Session-ID', req.session.id || 'none');
    res.setHeader('X-Authenticated', req.session.authenticated ? 'true' : 'false');
  }
  next();
}

/**
 * Session cleanup utility
 * Can be called periodically to remove expired sessions
 */
export async function cleanupExpiredSessions() {
  try {
    const result = await db.query(
      'DELETE FROM sessions WHERE expires < ?',
      [Math.floor(Date.now() / 1000)]
    );
    console.log(`🗑️  Cleaned up ${result[0].affectedRows} expired sessions`);
  } catch (error) {
    console.error('Error cleaning up sessions:', error);
  }
}