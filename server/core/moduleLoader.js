// core/moduleLoader.js
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class ModuleLoader {
  constructor() {
    this.modules = new Map();
    // Path naar de modules map (één niveau omhoog vanaf core/)
    this.modulesPath = path.resolve(__dirname, '..', 'modules');
  }

  /**
   * Ontdekt alle modules en laadt hun manifest en instellingen-schema
   */
  async discoverModules() {
    console.log('🔍 Scanning for modules...');

    if (!fs.existsSync(this.modulesPath)) {
      console.log(`⚠️ Modules directory niet gevonden: ${this.modulesPath}`);
      fs.mkdirSync(this.modulesPath, { recursive: true });
      return this.modules;
    }

    const entries = fs.readdirSync(this.modulesPath, { withFileTypes: true });
    const moduleDirs = entries.filter(entry => entry.isDirectory());

    for (const dir of moduleDirs) {
      try {
        const module = await this.loadModule(dir.name);
        if (module) {
          this.modules.set(module.manifest.id, module);
          console.log(`  ✓ Loaded: ${module.manifest.name} v${module.manifest.version}`);
        }
      } catch (error) {
        console.error(`  ✗ Failed to load module ${dir.name}:`, error.message);
      }
    }

    console.log(`✅ Discovered ${this.modules.size} module(s)`);
    return this.modules;
  }

  /**
   * Laadt een specifieke module inclusief index.js, manifest en schema
   */
  async loadModule(moduleName) {
    const modulePath = path.join(this.modulesPath, moduleName);
    const indexPath = path.join(modulePath, 'index.js');
    const manifestPath = path.join(modulePath, 'manifest.json');
    const schemaPath = path.join(modulePath, 'config', 'settings_schema.json'); // Standaard locatie voor schema

    // Basis checks
    if (!fs.existsSync(indexPath)) throw new Error(`Missing index.js`);
    if (!fs.existsSync(manifestPath)) throw new Error(`Missing manifest.json`);

    try {
      // 1. Lees en parse manifest
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

      // 2. Importeer de module logica
      const moduleUrl = `file://${indexPath}`;
      const moduleExport = await import(moduleUrl);
      const moduleInstance = moduleExport.default;

      if (!moduleInstance) throw new Error(`Module exports no default object`);

      // 3. LAAD SCHEMA (Nieuwe suggestie)
      // Controleer of er een settings_schema.json aanwezig is voor dynamische UI/validatie
      if (fs.existsSync(schemaPath)) {
        try {
          const schemaContent = fs.readFileSync(schemaPath, 'utf8');
          manifest.settingsSchema = JSON.parse(schemaContent);
          console.log(`    ℹ️ Schema found for ${manifest.id}`);
        } catch (schemaErr) {
          console.warn(`    ⚠️ Failed to parse schema for ${moduleName}:`, schemaErr.message);
        }
      }

      // Koppel manifest aan de instantie
      moduleInstance.manifest = manifest;
      return moduleInstance;
    } catch (error) {
      throw new Error(`Load error: ${error.message}`);
    }
  }

  /**
   * Haalt een specifieke module op via ID (gebruikt door settingsService)
   */
  getModule(moduleId) {
    return this.modules.get(moduleId);
  }

  /**
   * Geeft alle ontdekte modules terug
   */
  getAllModules() {
    return Array.from(this.modules.values());
  }

  /**
   * Filtert op alleen ingeschakelde modules
   */
  getEnabledModules() {
    return this.getAllModules().filter(m => m.manifest.enabled !== false);
  }
}

export default new ModuleLoader();