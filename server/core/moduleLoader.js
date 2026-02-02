// core/moduleLoader.js
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class ModuleLoader {
  constructor() {
    this.modules = new Map();
    this.modulesPath = path.resolve(__dirname, '..', 'modules');
  }

  /**
   * Discover all modules in the modules directory
   */
  async discoverModules() {
    console.log('🔍 Scanning for modules...');
    console.log(`    __dirname:    ${__dirname}`);
    console.log(`    modulesPath:  ${this.modulesPath}`);

    // Check if modules directory exists
    if (!fs.existsSync(this.modulesPath)) {
      console.log(`⚠️  Modules directory does not exist: ${this.modulesPath}`);
      console.log('    Creating it now...');
      fs.mkdirSync(this.modulesPath, { recursive: true });
      return this.modules;
    }

    const entries = fs.readdirSync(this.modulesPath, { withFileTypes: true });
    console.log(`    Contents of ${this.modulesPath}:`);
    entries.forEach(e => console.log(`      ${e.isDirectory() ? '[DIR] ' : '[FILE]'} ${e.name}`));

    const moduleDirs = entries.filter(entry => entry.isDirectory());

    if (moduleDirs.length === 0) {
      console.log('ℹ️  No module directories found');
      return this.modules;
    }

    for (const dir of moduleDirs) {
      const moduleName = dir.name;
      console.log(`  📦 Found: ${moduleName}`);

      try {
        const module = await this.loadModule(moduleName);
        if (module) {
          this.modules.set(module.manifest.id, module);
          console.log(`  ✓ Loaded: ${module.manifest.name} v${module.manifest.version}`);
        }
      } catch (error) {
        console.error(`  ✗ Failed to load ${moduleName}:`, error.message);
      }
    }

    console.log(`✓ Discovered ${this.modules.size} module(s)`);
    return this.modules;
  }

  /**
   * Load a single module
   */
  async loadModule(moduleName) {
    const modulePath = path.join(this.modulesPath, moduleName);
    const indexPath = path.join(modulePath, 'index.js');
    const manifestPath = path.join(modulePath, 'manifest.json');

    // Check if index.js exists
    if (!fs.existsSync(indexPath)) {
      throw new Error(`Missing index.js in ${modulePath}`);
    }

    // Check if manifest.json exists
    if (!fs.existsSync(manifestPath)) {
      throw new Error(`Missing manifest.json in ${modulePath}`);
    }

    try {
      // Read manifest
      const manifestContent = fs.readFileSync(manifestPath, 'utf8');
      const manifest = JSON.parse(manifestContent);

      // Import module
      const moduleUrl = `file://${indexPath}`;
      const moduleExport = await import(moduleUrl);

      // Validate module structure
      if (!moduleExport.default) {
        throw new Error(`${moduleName} does not export a default object`);
      }

      // Attach manifest
      moduleExport.default.manifest = manifest;

      return moduleExport.default;
    } catch (error) {
      throw new Error(`Failed to load ${moduleName}: ${error.message}`);
    }
  }

  /**
   * Get a specific module
   */
  getModule(moduleId) {
    return this.modules.get(moduleId);
  }

  /**
   * Get all modules
   */
  getAllModules() {
    return Array.from(this.modules.values());
  }

  /**
   * Get enabled modules
   */
  getEnabledModules() {
    return this.getAllModules().filter(m => m.manifest.enabled !== false);
  }
}

export default new ModuleLoader();