import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { createSessionMiddleware, attachSessionInfo } from './core/auth/middleware/session.js';
import authRoutes from './core/auth/routes/auth.js';
import { authenticate } from './core/auth/middleware/authenticate.js';
import { authorize } from './core/auth/middleware/authorize.js';
import { apiLimiter } from './core/auth/middleware/rateLimiter.js';
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
import strategyManager from './core/strategyManager.js';
import aggregatorService from './core/system/services/aggregatorService.js';


const app = express();
const routeManager = new RouteManager(app);
export const authenticateToken = authenticate;

// ============================================================================
// MIDDLEWARE - ORDER MATTERS!
// ============================================================================

// 1. Security middleware
app.use(helmet()); // Security headers

// 2. CORS - MUST include credentials: true for sessions to work
app.use(cors({
  origin: [
    process.env.FRONTEND_URL || 'http://localhost:5173',
    'http://localhost:5173',        // Voor lokale ontwikkeling
    'http://192.168.1.155:88',      // Je nieuwe Apache adres
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
app.use(apiLimiter);

// ============================================================================
// PUBLIC ROUTES (No authentication required)
// ============================================================================
// IMPORTANT: These must come BEFORE the authenticateToken middleware

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok',
    timestamp: new Date().toISOString(),
    session: req.session?.id ? 'active' : 'none'
  });
});

// Auth routes (login, logout, status, etc.)
app.use('/api/auth', authRoutes);

// ============================================================================
// PROTECTED ROUTES (Authentication required for everything below)
// ============================================================================
// Apply authentication to all /api/* routes (except /api/auth which is above)
// The enhanced authenticate middleware checks BOTH JWT token AND session
app.use('/api', authenticate);
app.use('/api/setup', setupRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/system/config', configRoutes);
app.use('/api/history', historyRoutes);
app.use('/api/system', dataRoutes);

// ============================================================================
// MODULE INITIALIZATION
// ============================================================================

async function initializeModules() {
  try {
    console.log('');
    console.log(' - \x1b[32mDiscovering modules...\x1b[37m');
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
    console.log(' - \x1b[32mInitializing modules...');
    console.log('   -------------------------------------------\x1b[37m');
    const enabledModules = await moduleLoader.getEnabledModules();
    console.log(`   \x1b[32m✓\x1b[37m ${enabledModules.length} modules enabled`);

     // 4. Initialize only enabled modules
    for (const module of enabledModules) {
      if (module.initialize) {
        //console.log(`  Initializing: ${module.manifest.name}`);
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
    
    console.log('✅ \x1b[32mAll modules initialized\x1b[37m');
    console.log('   -------------------------------------------');
    console.log('');
    console.log('');
  } catch (error) {
    console.error('❌ Module initialization failed:', error);
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
  console.log(' - Checking for default admin user... \x1b[32m✓\x1b[37m ');
  await userService.createDefaultAdminIfNeeded();
  
  // Initialize modules
  await initializeModules();

  // Start strategy engine every 5 minutes
  setInterval(() => { 
    strategyManager.run();  
  }, 5 * 60 * 1000);
});

// ============================================================================
// GRACEFUL SHUTDOWN
// ============================================================================

process.on('SIGTERM', async () => {
  console.log('🛑 Shutting down gracefully...');
  await collectorManager.stop();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('🛑 Shutting down gracefully...');
  await collectorManager.stop();
  process.exit(0);
});