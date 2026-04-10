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
    this.modulesPath = path.resolve(__dirname, '..', 'modules');
  }

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
        return value === true || value === 'true' || value === '1' || value === 1;
      }

      return false;
    } catch (error) {
      console.warn(`   ⚠️  Failed to check enabled status for ${moduleId}:`, error.message);
      return false;
    }
  }

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

  async loadModule(moduleName) {
    const modulePath  = path.join(this.modulesPath, moduleName);
    const indexPath   = path.join(modulePath, 'index.js');
    const manifestPath = path.join(modulePath, 'manifest.json');
    const schemaPath  = path.join(modulePath, 'config', 'settings_schema.json');

    if (!fs.existsSync(indexPath))    throw new Error(`Missing index.js`);
    if (!fs.existsSync(manifestPath)) throw new Error(`Missing manifest.json`);

    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

      await this.syncManifestToRegistry(manifest);

      const moduleUrl    = `file://${indexPath}`;
      const moduleExport = await import(moduleUrl);
      const moduleInstance = moduleExport.default;

      if (!moduleInstance) throw new Error(`Module exports no default object`);

      if (fs.existsSync(schemaPath)) {
        try {
          manifest.settingsSchema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
        } catch (schemaErr) {
          console.warn(`    ⚠️ Failed to parse schema for ${moduleName}:`, schemaErr.message);
        }
      }

      moduleInstance.manifest   = manifest;
      moduleInstance.modulePath = modulePath;
      return moduleInstance;
    } catch (error) {
      throw new Error(`Load error: ${error.message}`);
    }
  }

  /**
   * Synct manifest.json velden naar module_registry.
   *
   * Wijziging t.o.v. MySQL-versie:
   *   ON DUPLICATE KEY UPDATE ... = VALUES(...)
   *   → ON CONFLICT(module_id) DO UPDATE SET ... = excluded....
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
        ON CONFLICT(module_id) DO UPDATE SET
          module_name        = excluded.module_name,
          module_version     = excluded.module_version,
          module_type        = excluded.module_type,
          description        = excluded.description,
          author             = excluded.author,
          documentation_url  = excluded.documentation_url,
          has_collector      = excluded.has_collector,
          has_api            = excluded.has_api,
          has_ui             = excluded.has_ui,
          has_schema         = excluded.has_schema,
          api_prefix         = excluded.api_prefix,
          collector_interval = excluded.collector_interval,
          collector_priority = excluded.collector_priority,
          settings_component = excluded.settings_component,
          installed          = 1,
          updated_at         = excluded.updated_at,
          last_seen_at       = excluded.last_seen_at
      `, [
        id, name, version, type,
        description, author, documentation_url,
        has_collector, has_api, has_ui, has_schema,
        api_prefix, interval, priority,
        component,
        now, now, now, now,
      ]);
    } catch (error) {
      console.warn(`   ⚠️  syncManifestToRegistry failed for ${id}:`, error.message);
    }
  }

  getModule(moduleId) {
    return this.modules.get(moduleId);
  }

  getAllModules() {
    return Array.from(this.modules.values());
  }

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