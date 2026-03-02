// core/routeManager.js
class RouteManager {
  constructor(app) {
    this.app = app;
    this.registeredRoutes = new Map();
  }

  /**
   * Register routes for all modules
   */
  registerModuleRoutes(modules) {
    if (!modules || modules.size === 0) {
      console.log('\x1b[91m   - No modules to register routes for \x1b[37m');
      return;
    }

    for (const [id, module] of modules) {
      try {
        // Check if module has API capability
        if (!module.manifest?.capabilities?.api) {
          continue;
        }

        // Check if routes are enabled
        if (module.manifest?.routes?.enabled === false) {
          console.log(`\x1b[93m   - Routes disabled: ${module.manifest.name} \x1b[37m`);
          continue;
        }

        // Check if module has routes
        if (!module.routes) {
          console.warn(`\x1b[91m   - Module ${id} has API capability but no routes exported \x1b[37m`);
          continue;
        }

        // Get route prefix
        const prefix = module.manifest?.routes?.prefix || `/api/${id}`;

        // Register routes
        console.log(`\x1b[37m   - Registering: ${prefix} (${module.manifest.name})`);
        this.app.use(prefix, module.routes);
        
        this.registeredRoutes.set(id, {
          prefix,
          module: module.manifest.name
        });
      } catch (error) {
        console.error(`\x1b[91m   - Failed to register routes for ${id}:`, error.message,'\x1b[37m');
      }
    }

    console.log(`\x1b[32m   • Registered ${this.registeredRoutes.size} route(s)  \x1b[37m`);
  }

  /**
   * Get all registered routes
   */
  getRegisteredRoutes() {
    return Array.from(this.registeredRoutes.entries()).map(([id, info]) => ({
      moduleId: id,
      prefix: info.prefix,
      moduleName: info.module
    }));
  }

  /**
   * Unregister routes for a module
   */
  unregisterModuleRoutes(moduleId) {
    // Note: Express doesn't provide a clean way to remove routes
    // This would require storing route references and manually removing them
    // For now, we just remove from our tracking
    this.registeredRoutes.delete(moduleId);
  }
}

export default RouteManager;