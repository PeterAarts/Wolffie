import './systemLogger.js'; 
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { createSessionMiddleware, attachSessionInfo } from './core/auth/middleware/session.js';
import authRoutes from './core/auth/routes/auth.js';
import { authenticate } from './core/auth/middleware/authenticate.js';
import { authorize } from './core/auth/middleware/authorize.js';
import { 
  apiLimiter, 
  authLimiter, 
  settingsLimiter 
} from './core/auth/middleware/rateLimiter.js';
import userService from './core/auth/services/userService.js';
import settingsService from './core/system/services/settingsService.js'
import moduleLoader from './core/moduleLoader.js';
import collectorManager from './core/collectorManager.js';
import RouteManager from './core/routeManager.js';
import setupRoutes from './core/system/routes/setup.js';
import settingsRoutes from './core/system/routes/settings.js';
import configRoutes from './core/system/routes/config.js';
import dataRoutes from './core/system/routes/data.js';
import historyRoutes from './core/system/routes/history.js';
import strategyManager  from './core/strategyManager.js';
import strategyRoutes   from './core/system/routes/strategies.js';
import alertRoutes      from './core/system/routes/alerts.js';
import capabilityRouter from './core/system/routes/capability.js';
import collectorRoutes from './core/system/routes/collectors.js';
import modulesRoutes from './core/system/routes/modules.js';
import aggregatorService from './core/system/services/aggregatorService.js';


const app = express();
app.set('trust proxy', 1);
const routeManager = new RouteManager(app);
export const authenticateToken = authenticate;

// ============================================================================
// MIDDLEWARE - ORDER MATTERS!
// ============================================================================

// 1. Security middleware
app.use(helmet({
  contentSecurityPolicy: false  // Apache handles CSP
}));

// 2. CORS - MUST include credentials: true for sessions to work
app.use(cors({
  origin: [
    process.env.FRONTEND_URL || 'http://localhost:5173',
    'http://localhost:5173',        // Voor lokale ontwikkeling
    'http://192.168.1.160:88',      // Je nieuwe Apache adres
    'https://wolffie.nl'            // Je servernaam
  ],
  credentials: true  // CRITICAL: Required for cookies/sessions to work
}));

// 3. Body parsing
app.use(express.json());


// 4. Session middleware - MUST come before routes
// This creates req.session which stores user data across requests
app.use(createSessionMiddleware());

// 5. Optional: Attach session info to response headers (debugging)
if (process.env.NODE_ENV !== 'production') {
  app.use(attachSessionInfo);
}

// 6. Rate limiting
//app.use(apiLimiter);
//app.use(authLimiter);
//app.use(settingsLimiter);

// ============================================================================
// PUBLIC ROUTES (No authentication required)
// ============================================================================
// IMPORTANT: These must come BEFORE the authenticateToken middleware

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok',
    timestamp: new Date().toISOString(),
  });
});

// Auth routes (login, logout, status, etc.)
app.use('/api/auth', authRoutes);

// ============================================================================
// PROTECTED ROUTES (Authentication required for everything below)
// ============================================================================
// Apply authentication to all /api/* routes (except /api/auth which is above)
// The enhanced authenticate middleware checks BOTH JWT token AND session
app.use('/api', apiLimiter);   
app.use('/api', authenticate);
app.use('/api/setup', setupRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/system/config', configRoutes);
app.use('/api/history', historyRoutes);
app.use('/api/collectors', collectorRoutes);
app.use('/api/modules', authorize('admin'), modulesRoutes);
app.use('/api/system', dataRoutes);

// Capability router — transport-agnostic endpoints delegating to registry
// GET /api/capabilities        lists all currently registered service types
// /api/capability/battery/*    battery read + dispatch actions
// /api/capability/solar/*      solar read + forecast
// /api/capability/grid/*       grid read + pricing
// /api/capability/home/*       home load read
// /api/capability/devices/*    device control
app.use('/api/capability', capabilityRouter);
app.use('/api/capabilities', (req, res) => res.redirect(307, '/api/capability'));

// Strategy routes — strategy selection, day plan, decision log
app.use('/api/strategies', strategyRoutes);

// Generic alert routes — app-wide alerts with per-user dismissal
app.use('/api/alerts', alertRoutes);

// ============================================================================
// MODULE INITIALIZATION
// ============================================================================

async function initializeModules() {
  try {
    console.log('');
    console.log(' - \x1b[32mDiscovering available modules...\x1b[37m');
    console.log('   -------------------------------------------');
    // 1. Discover all modules (loads from filesystem)
    const allModules = await moduleLoader.discoverModules();
    console.log(`   ✓ Found ${allModules.size} modules`);
    
    // 2. Sync settings schemas (needed to populate database with enabled flags)
    console.log(' ');
    console.log(' - \x1b[32mSyncing settings schemas...\x1b[37m');
    console.log('   -------------------------------------------'); 
    await settingsService.initializeModules();
    
    // 3. Filter to only enabled modules from database
    console.log(' ');
    console.log(' - \x1b[32mInitializing active modules...');
    console.log('   -------------------------------------------\x1b[37m');
    const enabledModules = await moduleLoader.getEnabledModules();
    console.log(`   \x1b[32m✓\x1b[37m ${enabledModules.length} modules enabled`);

    // 4. Initialize only enabled modules
    for (const module of enabledModules) {
      if (module.initialize) {
        await module.initialize();
      }
      // Register collectors (only for enabled modules)
      collectorManager.register(module);
    }
    
    // 5. Register routes - only for enabled modules
    console.log(' ');    
    console.log(' - \x1b[32mRegistering module routes...\x1b[37m');
    console.log('   -------------------------------------------');
    // Convert array to Map for routeManager
    const enabledModulesMap = new Map(
      enabledModules.map(m => [m.manifest.id, m])
    );
    routeManager.registerModuleRoutes(enabledModulesMap);
    
    // 6. Start collectors (will check database again for safety)
    console.log(' ');    
    console.log(' - \x1b[32mStarting collectors...\x1b[37m');
    console.log('   -------------------------------------------');
    await collectorManager.start();

    // 7. Start data aggregation
    console.log(' ');    
    console.log(' - \x1b[32mStarting data aggregator...\x1b[37m');
    console.log('   -------------------------------------------');
    aggregatorService.start();

    // 8. Start strategy manager
    // Must run AFTER collectors start so capability registry is populated
    console.log(' ');
    console.log(' - \x1b[32mStarting strategy manager...\x1b[37m');
    console.log('   -------------------------------------------');
    await strategyManager.start();

    // Generate today's day plan if not already present
    await strategyManager.regenerateDayPlan();
    
    console.log('\x1b[32m - All modules initialized\x1b[37m');
    console.log('   -------------------------------------------');
    console.log('');
    console.log('\x1b[93m - logging  \x1b[37m');
  } catch (error) {
    console.error('\x1b[91m - Module initialization failed:', error, '\x1b[37m');
    console.error(error.stack);
  }
}

// ============================================================================
// START SERVER
// ============================================================================

const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  console.log('   -------------------------------------------');
  console.log(` - \x1b[92mWolffie API-Collector Server\x1b[37m`);
  console.log(` - Server running on port \x1b[32m${PORT}\x1b[37m`);
  console.log(` - Session-based authentication enabled`);
  console.log('   -------------------------------------------');
  
  // Create default admin user if needed
  console.log(' - Checking for default admin user... \x1b[92m✓\x1b[37m ');
  await userService.createDefaultAdminIfNeeded();
  
  // Initialize modules (includes strategy manager start)
  await initializeModules();
});

// ============================================================================
// GRACEFUL SHUTDOWN
// ============================================================================

process.on('SIGTERM', async () => {
  console.log('\x1b[91m  -------------------------------------------');
  console.log(' - Shutting down gracefully...\x1b[37m');
  strategyManager.stop();
  await collectorManager.stop();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('\x1b[91m  -------------------------------------------');
  console.log('- Shutting down gracefully...\x1b[37m');
  strategyManager.stop();
  await collectorManager.stop();
  process.exit(0);
});

// ============================================================================
// PROCESS-LEVEL ERROR GUARDS
// ============================================================================
// modbus-serial emits TCP errors (ETIMEDOUT, ECONNREFUSED, ECONNRESET) via its
// internal socket EventEmitter. When these fire outside an active await chain
// Node.js escalates them — first to unhandledRejection, then (via
// triggerUncaughtException fromPromise) to uncaughtException — which by default
// kills the process. These handlers log and absorb both event types so a
// temporary inverter network blip can never crash the server.

process.on('unhandledRejection', (reason) => {
  console.error('\x1b[91m ⚠ Unhandled promise rejection (process kept alive):\x1b[37m', reason?.message ?? reason);
});

process.on('uncaughtException', (err) => {
  console.error('\x1b[91m ⚠ Uncaught exception (process kept alive):\x1b[37m', err.message);
});