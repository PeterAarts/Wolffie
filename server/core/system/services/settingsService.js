// src/services/settingsService.js
import crypto from 'crypto';
import db from '../../../config/database.js'; 
import moduleLoader from '../../moduleLoader.js'; // Nodig voor schema-validatie

// Encryptie configuratie
const ENCRYPTION_KEY = process.env.SETTINGS_ENCRYPTION_KEY || 'change-this-to-a-secure-32-char-key!!';
const ALGORITHM = 'aes-256-cbc';

class SettingsService {
  constructor() {
    this.cache = new Map();
    this.cacheExpiry = 60000; // Cache voor 1 minuut
  }

  /**
   * Encrypt sensitive setting value
   */
  encrypt(text) {
    const key = crypto.scryptSync(ENCRYPTION_KEY, 'salt', 32);
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    
    let encrypted = cipher.update(String(text), 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    return iv.toString('hex') + ':' + encrypted;
  }

  /**
   * Decrypt sensitive setting value
   */
  decrypt(text) {
    try {
      const key = crypto.scryptSync(ENCRYPTION_KEY, 'salt', 32);
      const parts = text.split(':');
      if (parts.length !== 2) return text;

      const iv = Buffer.from(parts[0], 'hex');
      const encrypted = parts[1];
      
      const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
      let decrypted = decipher.update(encrypted, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      
      return decrypted;
    } catch (err) {
      console.error('Decryption failed:', err.message);
      return null;
    }
  }

  /**
   * Get a single setting
   */
  async get(category, key, useCache = true) {
    const cacheKey = `${category}.${key}`;

    if (useCache && this.cache.has(cacheKey)) {
      const cached = this.cache.get(cacheKey);
      if (Date.now() - cached.timestamp < this.cacheExpiry) {
        return cached.value;
      }
    }

    try {
      const [rows] = await db.pool.query(
        'SELECT setting_value, value_type, is_encrypted FROM system_settings WHERE category = ? AND setting_key = ?',
        [category, key]
      );

      if (rows.length === 0) return null;

      const setting = rows[0];
      let value = setting.setting_value;

      if (setting.is_encrypted && value) {
        value = this.decrypt(value);
      }

      value = this._convertType(value, setting.value_type);
      this.cache.set(cacheKey, { value, timestamp: Date.now() });

      return value;
    } catch (error) {
      console.error(`Error getting setting ${category}.${key}:`, error.message);
      return null;
    }
  }

  /**
   * Get all settings in a category (module)
   */
  async getCategory(category) {
    try {
      const [rows] = await db.pool.query(
        'SELECT setting_key, setting_value, value_type, is_encrypted FROM system_settings WHERE category = ?',
        [category]
      );

      const settings = {};
      for (const row of rows) {
        let value = row.setting_value;
        if (row.is_encrypted && value) {
          value = this.decrypt(value);
        }
        settings[row.setting_key] = this._convertType(value, row.value_type);
      }
      return settings;
    } catch (error) {
      console.error(`Error getting category ${category}:`, error.message);
      return {};
    }
  }

  /**
   * Set a single setting met automatische schema-gebaseerde encryptie en validatie
   */
  async set(moduleId, key, value, changedBy = 'system', reason = null) {
    try {
      // 1. Check of de instelling al bestaat
      const [current] = await db.pool.query(
        'SELECT id, setting_value, is_encrypted, value_type FROM system_settings WHERE module_id = ? AND setting_key = ?',
        [moduleId, key]
      );

      let newValue = value !== null ? String(value) : null;
      let isEncrypted = 0;
      let settingId =0;
      let oldValue=null;
      let valueType = typeof value === 'number' ? 'number' : (typeof value === 'boolean' ? 'boolean' : 'string');

      if (current.length > 0) {
        isEncrypted = current[0].is_encrypted;
        valueType = current[0].value_type;
        settingId = current[0].id;
      }

      // Encryptie afhandelen
      if (isEncrypted && newValue) {
        newValue = this.encrypt(newValue);
      }

      if (current.length === 0) {
        // 2a. INSERT: Als de instelling nog niet bestaat
        const [result] = await db.pool.query(
          `INSERT INTO system_settings 
          (module_id, category, setting_key, setting_value, value_type, is_module, enabled, created_at, updated_at) 
          VALUES (?, ?, ?, ?, ?, 1, 1, NOW(), NOW())`,
          [moduleId, moduleId, key, newValue, valueType]
        );
        console.log(`     - Setting inserted: ${moduleId}.${key} = ${value}`);
      } else {
        // 2b. UPDATE: Als de instelling al bestaat
        await db.pool.query(
          'UPDATE system_settings SET setting_value = ?, updated_at = NOW() WHERE id = ?',
          [newValue, current[0].id]
        );
      }
      // 5. Historie loggen
      await db.pool.query(
        'INSERT INTO settings_history (setting_id, category, setting_key, old_value, new_value, changed_by, change_reason) VALUES (?,?, ?, ?, ?, ?, ?)',
        [settingId, moduleId, key, oldValue, newValue, changedBy, reason]
      );

      this.cache.delete(`${moduleId}.${key}`);
      return true;
    } catch (error) {
      console.error(`Error setting ${moduleId}.${key}:`, error.message);
      throw error;
    }
  }

  /**
   * Set multiple settings
   */
  async setCategory(category, settings, changedBy = 'system', reason = null) {
    for (const [key, value] of Object.entries(settings)) {
      await this.set(category, key, value, changedBy, reason);
    }
    return true;
  }

  /**
   * Dynamische validatie op basis van settings_schema.json
   */
async validate(category, key, value) {
  const module = moduleLoader.getModule(category);
  if (!module || !module.manifest.settingsSchema) return true;

  // Zoek het veld op in de geneste structuur
  let field = null;
  module.manifest.settingsSchema.groups?.forEach(g => {
    g.sections?.forEach(s => {
      const found = s.fields?.find(f => f.key === key);
      if (found) field = found;
    });
  });

  if (!field) return true;

  // Validatie op basis van component type
  if (field.component === 'number') {
    const num = Number(value);
    if (isNaN(num)) throw new Error(`${key} moet een getal zijn`);
  }
  
  if (field.required && (value === null || value === '')) {
    throw new Error(`${key} is verplicht`);
  }

  return true;
}

/**
   * Alias for getCategory to support module-specific fetching
   */
  async getModuleSettings(moduleId) {
    return this.getCategory(moduleId);
  }

  /**
   * Generic service to initialize module settings from its schema file
   * Reads: server/modules/{moduleId}/config/settings-schema.json
   */
  /**
  * Initialiseer settings van alle modules op basis van de UI-schema structuur
  */
  async initializeModules() {
    console.log('   - reading schema`s...');
    const modules = moduleLoader.getAllModules();
    let count = 0;

    for (const mod of modules) {
      const schema = mod.manifest.settingsSchema;
      // Controleer of het schema de verwachte 'groups' structuur heeft
      if (!schema || !schema.groups) continue;

      const moduleId = mod.manifest.id;

      for (const group of schema.groups) {
        if (!group.sections) continue;

        for (const section of group.sections) {
          if (!section.fields) continue;

          for (const field of section.fields) {
            const { key, default: defaultValue, component } = field;
            
            // Overslaan als er geen key is (bijv. info-panels)
            if (!key) continue;

            // Controleer of de setting al bestaat in de database
            const current = await this.get(moduleId, key);
            
            if (current === null) {
              // Map component naar database type
              const type = component === 'switch' ? 'boolean' : 
                          component === 'number' ? 'number' : 'string';
              
              // Gebruik de default waarde uit het schema of null
              const valueToSet = defaultValue !== undefined ? defaultValue : null;
              
              console.log(`     - ${moduleId} => Creating missing setting:  ${key} (type: ${type})`);
              await this.set(moduleId, key, valueToSet, 'system', 'Schema-based initialization');
              count++;
            }
          }
        }
      }
    }
    console.log(`   - Initialized ${count} new default settings from module schemas`);
  }

  
  _convertType(value, type) {
    if (value === null || value === undefined) return null;
    switch (type) {
      case 'number': return Number(value);
      case 'boolean': return value === 'true' || value === '1' || value === 1 || value === true;
      case 'json': try { return JSON.parse(value); } catch { return value; }
      default: return String(value);
    }
  }
}

export default new SettingsService();