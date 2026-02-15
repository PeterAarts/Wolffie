import tokenService from '../services/tokenService.js';

/**
 * Authenticate middleware with session support
 * Checks both JWT token (from Authorization header) and session
 * This allows seamless browser refresh handling
 */
export function authenticate(req, res, next) {
  try {
    // Strategy 1: Check for JWT token in Authorization header (current behavior)
    const authHeader = req.headers.authorization;
    
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      
      try {
        const decoded = tokenService.verifyAccessToken(token);
        
        // Attach user to request
        req.user = {
          id: decoded.userId,
          username: decoded.username,
          email: decoded.email,
          role: decoded.role
        };
        
        // Store user in session for future requests
        if (req.session) {
          req.session.user = req.user;
          req.session.authenticated = true;
        }
        
        return next();
      } catch (tokenError) {
        // Token invalid/expired, fall through to check session
        console.log('JWT verification failed, checking session...');
      }
    }
    
    // Strategy 2: Check for session (for browser refresh)
    if (req.session && req.session.authenticated && req.session.user) {
      // User is authenticated via session
      req.user = req.session.user;
      return next();
    }
    
    // No valid token or session
    return res.status(401).json({
      success: false,
      error: 'No token provided',
      code: 'NO_TOKEN'
    });

  } catch (error) {
    return res.status(401).json({
      success: false,
      error: 'Authentication failed',
      code: 'AUTH_FAILED'
    });
  }
}

/**
 * Optional authenticate middleware
 * Attaches user if token or session is present but doesn't fail if missing
 */
export function optionalAuthenticate(req, res, next) {
  try {
    // Check JWT token first
    const authHeader = req.headers.authorization;
    
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      
      try {
        const decoded = tokenService.verifyAccessToken(token);
        
        req.user = {
          id: decoded.userId,
          username: decoded.username,
          email: decoded.email,
          role: decoded.role
        };
        
        // Store in session
        if (req.session) {
          req.session.user = req.user;
          req.session.authenticated = true;
        }
        
        return next();
      } catch (tokenError) {
        // Token invalid, check session
      }
    }
    
    // Check session
    if (req.session && req.session.authenticated && req.session.user) {
      req.user = req.session.user;
      return next();
    }
    
    // No authentication
    req.user = null;
    next();
    
  } catch (error) {
    req.user = null;
    next();
  }
}

/**
 * Refresh token endpoint helper
 * Call this when JWT expires to get new token while maintaining session
 */
export function refreshTokenFromSession(req, res) {
  try {
    // Check if user has valid session
    if (!req.session || !req.session.authenticated || !req.session.user) {
      return res.status(401).json({
        success: false,
        error: 'No active session',
        code: 'NO_SESSION'
      });
    }
    
    // Generate new JWT token from session data
    const newToken = tokenService.generateAccessToken({
      userId: req.session.user.id,
      username: req.session.user.username,
      email: req.session.user.email,
      role: req.session.user.role
    });
    
    return res.json({
      success: true,
      token: newToken,
      user: req.session.user
    });
    
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: 'Failed to refresh token',
      code: 'REFRESH_FAILED'
    });
  }
}