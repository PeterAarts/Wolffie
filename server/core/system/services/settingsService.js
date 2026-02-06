// src/services/settingsService.js - FIXED FOR YOUR DATABASE
import crypto from 'crypto';
import db from '../../../config/database.js';  // FIXED: Use your db config

// Encryption key for sensitive settings (use a strong key from env)
const ENCRYPTION_KEY = process.env.SETTINGS_ENCRYPTION_KEY || 'change-this-to-a-secure-32-char-key!!';
const ALGORITHM = 'aes-256-cbc';

class SettingsService {
  constructor() {
    this.cache = new Map();
    this.cacheExpiry = 60000; // Cache for 1 minute
    this.lastCacheUpdate = 0;
  }

  /**
   * Encrypt sensitive setting value
   */
  encrypt(text) {
    const key = crypto.scryptSync(ENCRYPTION_KEY, 'salt', 32);
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    return iv.toString('hex') + ':' + encrypted;
  }

  /**
   * Decrypt sensitive setting value
   */
  decrypt(text) {
    const key = crypto.scryptSync(ENCRYPTION_KEY, 'salt', 32);
    const parts = text.split(':');
    const iv = Buffer.from(parts[0], 'hex');
    const encrypted = parts[1];
    
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
  }

  /**
   * Get a single setting by category and key
   */
  async get(category, key, useCache = true) {
    const cacheKey = `${category}.${key}`;

    // Check cache
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

      if (rows.length === 0) {
        return null;
      }

      const setting = rows[0];
      let value = setting.setting_value;

      // Decrypt if needed
      if (setting.is_encrypted && value) {
        try {
          value = this.decrypt(value);
        } catch (err) {
          console.error('Failed to decrypt setting:', err.message);
          return null;
        }
      }

      // Convert to appropriate type
      value = this._convertType(value, setting.value_type);

      // Cache the result
      this.cache.set(cacheKey, { value, timestamp: Date.now() });

      return value;
    } catch (error) {
      console.error(`Error getting setting ${category}.${key}:`, error.message);
      return null;
    }
  }

  /**
   * Get all settings in a category
   */
  async getCategory(category, useCache = true) {
    try {
      const [rows] = await db.pool.query(
        'SELECT setting_key, setting_value, value_type, is_encrypted FROM system_settings WHERE category = ?',
        [category]
      );

      const settings = {};
      for (const row of rows) {
        let value = row.setting_value;

        // Decrypt if needed
        if (row.is_encrypted && value) {
          try {
            value = this.decrypt(value);
          } catch (err) {
            console.error(`Failed to decrypt ${row.setting_key}:`, err.message);
            value = null;
          }
        }

        // Convert to appropriate type
        value = this._convertType(value, row.value_type);

        settings[row.setting_key] = value;
      }

      return settings;
    } catch (error) {
      console.error(`Error getting category ${category}:`, error.message);
      return {};
    }
  }

  /**
   * Get all settings grouped by category
   */
  async getAll(includeSensitive = false) {
    try {
      const [rows] = await db.pool.query(
        'SELECT category, setting_key, setting_value, value_type, is_encrypted, description FROM system_settings ORDER BY category, setting_key'
      );

      const settings = {};
      for (const row of rows) {
        if (!settings[row.category]) {
          settings[row.category] = {};
        }

        let value = row.setting_value;

        // Decrypt if needed and requested
        if (row.is_encrypted) {
          if (includeSensitive && value) {
            try {
              value = this.decrypt(value);
            } catch (err) {
              console.error(`Failed to decrypt ${row.setting_key}:`, err.message);
              value = null;
            }
          } else {
            value = value ? '***ENCRYPTED***' : null;
          }
        }

        // Convert to appropriate type
        if (includeSensitive || !row.is_encrypted) {
          value = this._convertType(value, row.value_type);
        }

        settings[row.category][row.setting_key] = {
          value: value,
          type: row.value_type,
          encrypted: row.is_encrypted,
          description: row.description
        };
      }

      return settings;
    } catch (error) {
      console.error('Error getting all settings:', error.message);
      return {};
    }
  }

  /**
   * Set a single setting
   */
  async set(category, key, value, changedBy = 'system', reason = null) {
    try {
      // Get current value for history
      const [current] = await db.pool.query(
        'SELECT id, setting_value, is_encrypted FROM system_settings WHERE category = ? AND setting_key = ?',
        [category, key]
      );

      if (current.length === 0) {
        throw new Error(`Setting ${category}.${key} not found`);
      }

      const setting = current[0];
      const oldValue = setting.setting_value;

      // Encrypt if needed
      let newValue = value !== null ? String(value) : null;
      if (setting.is_encrypted && newValue) {
        newValue = this.encrypt(newValue);
      }

      // Update setting
      await db.pool.query(
        'UPDATE system_settings SET setting_value = ?, updated_at = NOW() WHERE category = ? AND setting_key = ?',
        [newValue, category, key]
      );

      // Log to history
      await db.pool.query(
        'INSERT INTO settings_history (setting_id, category, setting_key, old_value, new_value, changed_by, change_reason) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [setting.id, category, key, oldValue, newValue, changedBy, reason]
      );

      // Clear cache
      this.cache.delete(`${category}.${key}`);

      console.log(`âœ… Setting updated: ${category}.${key} by ${changedBy}`);

      return true;
    } catch (error) {
      console.error(`Error setting ${category}.${key}:`, error.message);
      throw error;
    }
  }

  /**
   * Set multiple settings in a category
   */
  async setCategory(category, settings, changedBy = 'system', reason = null) {
    try {
      for (const [key, value] of Object.entries(settings)) {
        await this.set(category, key, value, changedBy, reason);
      }
      return true;
    } catch (error) {
      console.error(`Error setting category ${category}:`, error.message);
      throw error;
    }
  }

  /**
   * Reset a setting to its default value
   */
  async reset(category, key, changedBy = 'system') {
    try {
      await this.set(category, key, null, changedBy, 'Reset to default');
      return true;
    } catch (error) {
      console.error(`Error resetting ${category}.${key}:`, error.message);
      throw error;
    }
  }

  /**
   * Get setting history
   */
  async getHistory(category = null, key = null, limit = 50) {
    try {
      let query = 'SELECT * FROM settings_history';
      const params = [];

      if (category) {
        query += ' WHERE category = ?';
        params.push(category);
        
        if (key) {
          query += ' AND setting_key = ?';
          params.push(key);
        }
      }

      query += ' ORDER BY changed_at DESC LIMIT ?';
      params.push(limit);

      const [rows] = await db.pool.query(query, params);
      return rows;
    } catch (error) {
      console.error('Error getting settings history:', error.message);
      return [];
    }
  }

  /**
   * Initialize settings from .env (migration helper)
   */
  async initializeFromEnv() {
    console.log('ðŸ”„ Initializing settings from .env...');

    const updates = [];

    // Cloud API settings
    if (process.env.ALPHAESS_APP_ID) {
      updates.push(this.set('cloud_api', 'app_id', process.env.ALPHAESS_APP_ID, 'system', 'Initialized from .env'));
    }
    if (process.env.ALPHAESS_APP_SECRET) {
      updates.push(this.set('cloud_api', 'app_secret', process.env.ALPHAESS_APP_SECRET, 'system', 'Initialized from .env'));
    }
    if (process.env.ALPHAESS_SYSTEM_SN) {
      updates.push(this.set('cloud_api', 'system_sn', process.env.ALPHAESS_SYSTEM_SN, 'system', 'Initialized from .env'));
    }
    if (process.env.CLOUD_POLL_INTERVAL) {
      updates.push(this.set('cloud_api', 'poll_interval', process.env.CLOUD_POLL_INTERVAL, 'system', 'Initialized from .env'));
    }

    // ModBus settings
    if (process.env.ALPHA_ESS_IP) {
      updates.push(this.set('modbus', 'ip_address', process.env.ALPHA_ESS_IP, 'system', 'Initialized from .env'));
    }
    if (process.env.MODBUS_PORT) {
      updates.push(this.set('modbus', 'port', process.env.MODBUS_PORT, 'system', 'Initialized from .env'));
    }
    if (process.env.MODBUS_SLAVE_ID) {
      updates.push(this.set('modbus', 'slave_id', process.env.MODBUS_SLAVE_ID, 'system', 'Initialized from .env'));
    }

    // Primary source
    if (process.env.PRIMARY_DATA_SOURCE) {
      updates.push(this.set('data_collection', 'primary_source', process.env.PRIMARY_DATA_SOURCE, 'system', 'Initialized from .env'));
    }

    await Promise.all(updates);

    console.log(`âœ… Initialized ${updates.length} settings from .env`);
  }

  /**
   * Clear cache
   */
  clearCache() {
    this.cache.clear();
    this.lastCacheUpdate = 0;
  }

  /**
   * Convert string value to appropriate type
   */
  _convertType(value, type) {
    if (value === null || value === undefined) {
      return null;
    }

    switch (type) {
      case 'number':
        return Number(value);
      case 'boolean':
        return value === 'true' || value === '1' || value === 1 || value === true;
      case 'json':
        try {
          return JSON.parse(value);
        } catch {
          return value;
        }
      case 'string':
      default:
        return String(value);
    }
  }

  /**
   * Validate settings before saving
   */
  async validate(category, key, value) {
    // Add validation rules as needed
    const rules = {
      'modbus.port': (v) => v >= 1 && v <= 65535,
      'modbus.slave_id': (v) => v >= 1 && v <= 247,
      'cloud_api.poll_interval': (v) => v >= 10000,
      'modbus.poll_interval': (v) => v >= 1000,
      'data_collection.primary_source': (v) => ['cloud', 'modbus'].includes(v)
    };

    const ruleKey = `${category}.${key}`;
    if (rules[ruleKey]) {
      if (!rules[ruleKey](value)) {
        throw new Error(`Invalid value for ${category}.${key}: ${value}`);
      }
    }

    return true;
  }
}

export default new SettingsService();