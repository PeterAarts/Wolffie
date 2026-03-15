// core/moduleLoader.js
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import db from './database.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class ModuleLoader {
  constructor() {
    this.modules = new Map();
    // Path naar de modules map (één niveau omhoog vanaf core/)
    this.modulesPath = path.resolve(__dirname, '..', 'modules');
  }

  /**
   * Check if a module is enabled in the database
   * @param {string} moduleId - The module ID to check
   * @returns {Promise<boolean>} - True if enabled, false otherwise
   */
  async isModuleEnabled(moduleId) {
    try {
      const [rows] = await db.pool.query(
        `SELECT setting_value FROM system_settings 
         WHERE module_id = ? AND setting_key = 'enabled' 
         LIMIT 1`,
        [moduleId]
      );

      if (rows.length > 0) {
        const value = rows[0].setting_value;
        // Handle both string 'true'/'false' and boolean values
        return value === true || value === 'true' || value === '1' || value === 1;
      }

      // If no setting found, module is disabled by default for safety
      return false;
    } catch (error) {
      console.warn(`   ⚠️  Failed to check enabled status for ${moduleId}:`, error.message);
      // On error, assume disabled for safety
      return false;
    }
  }

  /**
   * Ontdekt alle modules en laadt hun manifest en instellingen-schema
   */
  async discoverModules() {
    console.log(' - loading modules (discovery)');

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
          console.log(`   ✓ Loaded: ${module.manifest.name} v${module.manifest.version}`);
        }
      } catch (error) {
        console.error(`   ✗ Failed to load module ${dir.name}:`, error.message);
      }
    }

    console.log(`   ---------------------------------------------------`);
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

      // 2. Sync manifest fields → module_registry
      await this.syncManifestToRegistry(manifest);

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

        } catch (schemaErr) {
          console.warn(`    ⚠️ Failed to parse schema for ${moduleName}:`, schemaErr.message);
        }
      }

      // Koppel manifest en pad aan de instantie
      moduleInstance.manifest = manifest;
      moduleInstance.modulePath = modulePath;  // Needed by settings route to load locales/
      return moduleInstance;
    } catch (error) {
      throw new Error(`Load error: ${error.message}`);
    }
  }

  /**
   * Syncs all manifest.json fields into module_registry.
   * Uses INSERT … ON DUPLICATE KEY UPDATE so:
   *  - New modules get a full row inserted (enabled = 0 by default)
   *  - Existing rows get version, author, description, type etc. refreshed
   *    without touching enabled / discovered_at
   */
  async syncManifestToRegistry(manifest) {
    const {
      id,
      name              = '',
      version           = '0.0.0',
      type              = 'unknown',
      description       = '',
      author            = null,
      documentation_url = null,
      capabilities      = {},
      collector         = {},
      routes            = {},
      settings          = {},
    } = manifest;

    const has_collector = (capabilities.dataCollection || !!collector.enabled) ? 1 : 0;
    const has_api       = capabilities.api ? 1 : 0;
    const has_ui        = capabilities.ui  ? 1 : 0;
    const api_prefix    = routes.prefix      ?? null;
    const interval      = collector.interval ?? null;
    const priority      = collector.priority ?? null;
    const component     = settings.component ?? null;
    const has_schema    = fs.existsSync(
      path.join(this.modulesPath, id, 'config', 'settings_schema.json')
    ) ? 1 : 0;

    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');

    try {
      await db.pool.query(`
        INSERT INTO module_registry (
          module_id, module_name, module_version, module_type,
          description, author, documentation_url,
          has_collector, has_api, has_ui, has_schema,
          api_prefix, collector_interval, collector_priority,
          settings_component,
          enabled, installed,
          discovered_at, installed_at, updated_at, last_seen_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 1, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          module_name        = VALUES(module_name),
          module_version     = VALUES(module_version),
          module_type        = VALUES(module_type),
          description        = VALUES(description),
          author             = VALUES(author),
          documentation_url  = VALUES(documentation_url),
          has_collector      = VALUES(has_collector),
          has_api            = VALUES(has_api),
          has_ui             = VALUES(has_ui),
          has_schema         = VALUES(has_schema),
          api_prefix         = VALUES(api_prefix),
          collector_interval = VALUES(collector_interval),
          collector_priority = VALUES(collector_priority),
          settings_component = VALUES(settings_component),
          installed          = 1,
          updated_at         = VALUES(updated_at),
          last_seen_at       = VALUES(last_seen_at)
      `, [
        id, name, version, type,
        description, author, documentation_url,
        has_collector, has_api, has_ui, has_schema,
        api_prefix, interval, priority,
        component,
        now, now, now, now,  // discovered_at, installed_at, updated_at, last_seen_at
      ]);
    } catch (error) {
      // Non-fatal — log and continue so a DB hiccup never prevents module load
      console.warn(`   ⚠️  syncManifestToRegistry failed for ${id}:`, error.message);
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
   * Filtert op alleen ingeschakelde modules (checks database)
   */
  async getEnabledModules() {
    const enabledModules = [];
    
    for (const module of this.getAllModules()) {
      const isEnabled = await this.isModuleEnabled(module.manifest.id);
      if (isEnabled) {
        enabledModules.push(module);
      }
    }
    
    return enabledModules;
  }
}

export default new ModuleLoader();