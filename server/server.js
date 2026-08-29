import './systemLogger.js'; 
import dotenv           from 'dotenv';
dotenv.config();  
import express          from 'express';
import cors             from 'cors';
import helmet           from 'helmet';
import path             from 'path';
import { fileURLToPath } from 'url';
import { createSessionMiddleware, attachSessionInfo } from './core/auth/middleware/session.js';
import authRoutes       from './core/auth/routes/auth.js';
import { authenticate } from './core/auth/middleware/authenticate.js';
import { authorize }    from './core/auth/middleware/authorize.js';
import { 
  apiLimiter, 
  authLimiter, 
  settingsLimiter }     from './core/auth/middleware/rateLimiter.js';
import userService      from './core/auth/services/userService.js';
import settingsService  from './core/system/services/settingsService.js'
import moduleLoader     from './core/moduleLoader.js';
import collectorManager from './core/collectorManager.js';
import RouteManager     from './core/routeManager.js';
import setupRoutes      from './core/system/routes/setup.js';
import settingsRoutes   from './core/system/routes/settings.js';
import configRoutes     from './core/system/routes/config.js';
import dataRoutes       from './core/system/routes/data.js';
import historyRoutes    from './core/system/routes/history.js';
import strategyManager  from './core/strategyManager.js';
import strategyRoutes   from './core/system/routes/strategies.js';
import alertRoutes      from './core/system/routes/alerts.js';
import capabilityRouter from './core/system/routes/capability.js';
import collectorRoutes  from './core/system/routes/collectors.js';
import eventRoutes      from './core/system/routes/events.js';
import eventLogService  from './core/system/services/eventLogService.js';
import modulesRoutes    from './core/system/routes/modules.js';
import logsRoutes from './core/system/routes/logs.js';
import aggregatorService from './core/system/services/aggregatorService.js';

// __dirname equivalent voor ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const app = express();
app.set('trust proxy', 1);
const routeManager = new RouteManager(app);
export const authenticateToken = authenticate;

// ============================================================================
// MIDDLEWARE - ORDER MATTERS!
// ============================================================================

// 1. Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc:  ["'self'"],
      styleSrc:   ["'self'", "'unsafe-inline'"],  // Tailwind needs this
      connectSrc: ["'self'"],
      imgSrc:     ["'self'", "data:"],
    }
  }
}));

// 2. CORS — in productie (Docker) serveert Express de frontend zelf,
// dus browser en API hebben dezelfde origin en CORS speelt geen rol.
// In ontwikkeling (Vite dev server op :5173) blijft CORS nodig.
app.use(cors({
  origin: [
    process.env.FRONTEND_URL || 'http://localhost:5173',
    'http://localhost:5173',
    'http://192.168.1.160:88',
    'https://wolffie.nl'
  ],
  credentials: true
}));

// 3. Body parsing
app.use(express.json());

// 4. Session middleware
app.use(createSessionMiddleware());

// 5. Debug headers (alleen in development)
if (process.env.NODE_ENV !== 'production') {
  app.use(attachSessionInfo);
}

// ============================================================================
// STATIC FRONTEND — Vue dist bestanden serveren
// ============================================================================
// In Docker: dist zit in /app/public (gekopieerd door Dockerfile)
// In development: deze map bestaat niet, en Vite dev server draait apart
const publicDir = path.join(__dirname, '..', 'public');
app.use(express.static(publicDir));

// ============================================================================
// PUBLIC ROUTES (No authentication required)
// ============================================================================

app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok',
    timestamp: new Date().toISOString(),
  });
});
// app.use('/api/auth', authLimiter); 
app.use('/api/auth', authRoutes);

// ============================================================================
// PROTECTED ROUTES
// ============================================================================
app.use('/api/auth', authLimiter); 
app.use('/api', authenticate);
app.use('/api/setup', setupRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/system/config', configRoutes);
app.use('/api/history', historyRoutes);
app.use('/api/collectors', collectorRoutes);
app.use('/api/modules', authorize('admin'), modulesRoutes);
app.use('/api/system', dataRoutes);
app.use('/api/events', eventRoutes);
app.use('/api/capability', capabilityRouter);
app.use('/api/capabilities', (req, res) => res.redirect(307, '/api/capability'));
app.use('/api/strategies', strategyRoutes);
app.use('/api/alerts', alertRoutes);
app.use('/api/logs', logsRoutes);
// ============================================================================
// SPA FALLBACK — alle niet-API routes sturen index.html terug
// Hierdoor werkt Vue Router (history mode) correct in productie
// ============================================================================
app.get('/{*path}', (req, res, next) => {
  // API-routes niet onderscheppen
  if (req.path.startsWith('/api')) return next();
  const indexFile = path.join(publicDir, 'index.html');
  res.sendFile(indexFile, err => {
    if (err) next(); // index.html niet gevonden (development mode)
  });
});

// ============================================================================
// MODULE INITIALIZATION
// ============================================================================

async function initializeModules() {
  try {
    console.log('');
    console.log(` - \x1b[32mDiscovering available modules... ${new Date().toLocaleString()} \x1b[37m`);
    console.log('   -------------------------------------------');
    const allModules = await moduleLoader.discoverModules();
    console.log(`   ✓ Found ${allModules.size} modules`);
    
    console.log(' ');
    console.log(` - \x1b[32mSyncing settings schemas... ${new Date().toLocaleString()} \x1b[37m`);
    console.log('   -------------------------------------------'); 
    await settingsService.initializeModules();
    await eventLogService.initialize();
    
    console.log(' ');
    console.log(` - \x1b[32mInitializing active modules... ${new Date().toLocaleString()} \x1b[37m`);
    console.log('   -------------------------------------------\x1b[37m');
    const enabledModules = await moduleLoader.getEnabledModules();
    console.log(`   \x1b[32m✓\x1b[37m ${enabledModules.length} modules enabled`);

    for (const module of enabledModules) {
      if (module.initialize) {
        await module.initialize();
      }
      collectorManager.register(module);
    }
    
    console.log(' ');    
    console.log(` - \x1b[32mRegistering module routes... ${new Date().toLocaleString()} \x1b[37m`);
    console.log('   -------------------------------------------');
    const enabledModulesMap = new Map(
      enabledModules.map(m => [m.manifest.id, m])
    );
    routeManager.registerModuleRoutes(enabledModulesMap);
    
    console.log(' ');    
    console.log(` - \x1b[32mStarting collectors... ${new Date().toLocaleString()} \x1b[37m`);
    console.log('   -------------------------------------------');
    await collectorManager.start();

    console.log(' ');    
    console.log(` - \x1b[32mStarting data aggregator... ${new Date().toLocaleString()} \x1b[37m`);
    console.log('   -------------------------------------------');
    aggregatorService.start();

    console.log(' ');
    console.log(` - \x1b[32mStarting strategy manager... ${new Date().toLocaleString()} \x1b[37m`);
    console.log('   -------------------------------------------');
    await strategyManager.start();
    await strategyManager.regenerateDayPlan();
    
    console.log(` - \x1b[32mAll modules initialized... ${new Date().toLocaleString()} \x1b[37m`);
    console.log('   -------------------------------------------');
    console.log('');
    await eventLogService.log('core:system', 'system', 'startup_complete','info', `Wolffie started — ${enabledModules.length} modules active`);
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
  console.log(` - NODE_ENV: ${process.env.NODE_ENV || 'development'}`);
  console.log('   -------------------------------------------');
  
  await userService.createDefaultAdminIfNeeded();
  await initializeModules();
});

// ============================================================================
// GRACEFUL SHUTDOWN
// ============================================================================

process.on('SIGTERM', async () => {
  console.log('\x1b[91m  -------------------------------------------');
  console.log(' - Shutting down gracefully...\x1b[37m');
  await eventLogService.log('core:system', 'system', 'shutdown','info', 'Graceful shutdown initiated');
  strategyManager.stop();
  await collectorManager.stop();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('\x1b[91m  -------------------------------------------');
  console.log('- Shutting down gracefully...\x1b[37m');
  await eventLogService.log('core:system', 'system', 'shutdown','info', 'Graceful shutdown initiated');
  strategyManager.stop();
  await collectorManager.stop();
  process.exit(0);
});

process.on('unhandledRejection', (reason) => {
  console.error('\x1b[91m ⚠ Unhandled promise rejection (process kept alive):\x1b[37m', reason?.message ?? reason);
});

process.on('uncaughtException', (err) => {
  console.error('\x1b[91m ⚠ Uncaught exception (process kept alive):\x1b[37m', err.message);
  // Fire-and-forget — no await in non-async handler, and process may be dying
  eventLogService.log('core:system', 'system', 'uncaught_exception', 'error', `Uncaught exception: ${err.message}`);
});