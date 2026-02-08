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
  async set(category, key, value, changedBy = 'system', reason = null) {
    try {
      // 1. Validatie tegen schema indien beschikbaar
      await this.validate(category, key, value);

      // 2. Controleer of het veld encrypted moet zijn op basis van manifest/schema
      const module = moduleLoader.getModule(category);
      const fieldSchema = module?.manifest?.settingsSchema?.properties?.[key];
      const shouldEncrypt = fieldSchema?.ui?.sensitive === true;

      // 3. Haal huidige info op voor historie
      const [current] = await db.pool.query(
        'SELECT id, setting_value FROM system_settings WHERE category = ? AND setting_key = ?',
        [category, key]
      );

      if (current.length === 0) {
        // Indien setting nog niet bestaat (bijv. nieuwe module velden), voeg toe
        const type = typeof value === 'number' ? 'number' : typeof value === 'boolean' ? 'boolean' : 'string';
        await db.pool.query(
          'INSERT INTO system_settings (category, setting_key, setting_value, value_type, is_encrypted) VALUES (?, ?, ?, ?, ?)',
          [category, key, null, type, shouldEncrypt ? 1 : 0]
        );
      }

      const oldValue = current[0]?.setting_value;
      let newValue = value !== null ? String(value) : null;

      if (shouldEncrypt && newValue) {
        newValue = this.encrypt(newValue);
      }

      // 4. Update
      await db.pool.query(
        'UPDATE system_settings SET setting_value = ?, updated_at = NOW() WHERE category = ? AND setting_key = ?',
        [newValue, category, key]
      );

      // 5. Historie loggen
      await db.pool.query(
        'INSERT INTO settings_history (category, setting_key, old_value, new_value, changed_by, change_reason) VALUES (?, ?, ?, ?, ?, ?)',
        [category, key, oldValue, newValue, changedBy, reason]
      );

      this.cache.delete(`${category}.${key}`);
      return true;
    } catch (error) {
      console.error(`Error setting ${category}.${key}:`, error.message);
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

    const schema = module.manifest.settingsSchema.properties?.[key];
    if (!schema) return true;

    // Type checking
    if (schema.type === 'integer' || schema.type === 'number') {
      const num = Number(value);
      if (isNaN(num)) throw new Error(`${key} moet een getal zijn`);
      if (schema.minimum !== undefined && num < schema.minimum) throw new Error(`${key} te klein (min ${schema.minimum})`);
      if (schema.maximum !== undefined && num > schema.maximum) throw new Error(`${key} te groot (max ${schema.maximum})`);
    }

    if (schema.pattern) {
      const regex = new RegExp(schema.pattern);
      if (!regex.test(String(value))) throw new Error(`${key} voldoet niet aan het patroon`);
    }

    return true;
  }

  /**
   * Initialiseer settings van alle modules (Vervangt initializeFromEnv)
   */
  async initializeModules() {
    console.log('🔄 Initializing all module settings...');
    const modules = moduleLoader.getAllModules();
    let count = 0;

    for (const mod of modules) {
      const schema = mod.manifest.settingsSchema;
      if (!schema || !schema.properties) continue;

      for (const [key, config] of Object.entries(schema.properties)) {
        const current = await this.get(mod.manifest.id, key);
        if (current === null && config.default !== undefined) {
          await this.set(mod.manifest.id, key, config.default, 'system', 'Default initialization');
          count++;
        }
      }
    }
    console.log(`✅ Initialized ${count} new default settings`);
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