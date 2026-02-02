/**
 * Authorization middleware
 * Checks if authenticated user has required role
 * 
 * Must be used AFTER authenticate middleware
 */

/**
 * Create authorization middleware for specific roles
 * @param {...string} allowedRoles - Roles that are allowed
 * @returns {Function} Express middleware
 */
export function authorize(...allowedRoles) {
  return (req, res, next) => {
    // Check if user is authenticated
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required',
        code: 'AUTH_REQUIRED'
      });
    }

    // Check if user role is allowed
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        error: 'Insufficient permissions',
        code: 'INSUFFICIENT_PERMISSIONS',
        required: allowedRoles,
        current: req.user.role
      });
    }

    next();
  };
}

/**
 * Require admin role
 */
export function requireAdmin(req, res, next) {
  return authorize('admin')(req, res, next);
}

/**
 * Require admin or user role
 */
export function requireUser(req, res, next) {
  return authorize('admin', 'user')(req, res, next);
}

/**
 * Check if user owns resource or is admin
 */
export function requireOwnerOrAdmin(getUserIdFromRequest) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required',
        code: 'AUTH_REQUIRED'
      });
    }

    const resourceUserId = getUserIdFromRequest(req);
    
    // Allow if admin or owner
    if (req.user.role === 'admin' || req.user.id === resourceUserId) {
      return next();
    }

    return res.status(403).json({
      success: false,
      error: 'Insufficient permissions',
      code: 'INSUFFICIENT_PERMISSIONS'
    });
  };
}

/**
 * Role hierarchy
 * admin > user > viewer
 */
const roleHierarchy = {
  'admin': 3,
  'user': 2,
  'viewer': 1
};

/**
 * Check if user has minimum role level
 */
export function requireMinimumRole(minimumRole) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required',
        code: 'AUTH_REQUIRED'
      });
    }

    const userLevel = roleHierarchy[req.user.role] || 0;
    const requiredLevel = roleHierarchy[minimumRole] || 0;

    if (userLevel < requiredLevel) {
      return res.status(403).json({
        success: false,
        error: 'Insufficient permissions',
        code: 'INSUFFICIENT_PERMISSIONS',
        required: minimumRole,
        current: req.user.role
      });
    }

    next();
  };
}