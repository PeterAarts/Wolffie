import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import authRoutes from './core/auth/routes/auth.js';
import { authenticate } from './core/auth/middleware/authenticate.js';
import { authorize } from './core/auth/middleware/authorize.js';
import { apiLimiter } from './core/auth/middleware/rateLimiter.js';
import userService from './core/auth/services/userService.js';
import moduleLoader from './core/moduleLoader.js';
import collectorManager from './core/collectorManager.js';
import RouteManager from './core/routeManager.js';
import setupRoutes from './core/system/routes/setup.js';
import settingsRoutes from './core/system/routes/settings.js';
import configRoutes from './core/system/routes/config.js';
import dataRoutes from './core/system/routes/data.js';


const app = express();
const routeManager = new RouteManager(app);
export const authenticateToken = authenticate;

// Security middleware
app.use(helmet()); // Security headers
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true
}));
app.use(express.json());

// Apply rate limiting to all routes
app.use(apiLimiter);

// ============================================================================
// PUBLIC ROUTES (No authentication required)
// ============================================================================
// IMPORTANT: These must come BEFORE the authenticateToken middleware
app.use('/api/auth', authRoutes);

// ============================================================================
// PROTECTED ROUTES (Authentication required for everything below)
// ============================================================================
// Apply authentication to all /api/* routes (except /api/auth which is above)
app.use('/api', authenticateToken);

app.use('/api/setup', setupRoutes);           // Backward compatible
app.use('/api/settings', settingsRoutes);     // Backward compatible
app.use('/api/system/config', configRoutes);  // New endpoint

  app.use('/api/system', dataRoutes);
  app.use('/api/history', dataRoutes);

// Core routes (non-modular) - these will require authentication
// TODO: Create systemRoutes when needed
// app.use('/api/system', systemRoutes);

// Initialize modular system
async function initializeModules() {
  try {
    console.log('🔍 Discovering modules...');
    
    // 1. Discover all modules
    const modules = await moduleLoader.discoverModules();
    console.log(`✓ Found ${modules.size} modules`);
    
    // 2. Initialize modules + register collectors
    console.log('📦 Initializing modules...');
    for (const [id, module] of modules) {
      if (module.initialize) {
        console.log(`  Initializing: ${module.manifest.name}`);
        await module.initialize();
      }
      // register() is a no-op for modules without dataCollection capability —
      // safe to call unconditionally on every module
      collectorManager.register(module);
    }
    
    // 3. Register routes - ALL module routes will be under /api/* 
    //    so they'll automatically require authentication
    console.log('📡 Registering module routes...');
    routeManager.registerModuleRoutes(modules);
    
    // 4. Start collectors (all modules already registered above)
    console.log('🚀 Starting collectors...');
    await collectorManager.start();
    
    console.log('✅ All modules initialized');
  } catch (error) {
    console.error('❌ Module initialization failed:', error);
    console.error(error.stack);
  }
}

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  console.log(`🚀 Server running on port ${PORT}`);
  
  // Create default admin user if needed
  console.log('👤 Checking for default admin user...');
  await userService.createDefaultAdminIfNeeded();
  
  // Initialize modules
  await initializeModules();
});

// Graceful shutdown
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