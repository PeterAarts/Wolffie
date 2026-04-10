// server/core/system/services/systemConfigService.js
// Service to manage system configuration

import db from '../../database.js';
import fs from 'fs/promises';        // Missing: Required for getSchemaByModule
import path from 'path';              // Missing: Required for getSchemaByModule
import { fileURLToPath } from 'url'; // Required for ES Modules __dirname

const __dirname = path.dirname(fileURLToPath(import.meta.url));


class SystemConfigService {
  constructor() {
    this.cache = new Map();
  }

  /**
   * Get a configuration value
   */
  async get(key) {
    try {
      // Check cache
      if (this.cache.has(key)) {
        return this.cache.get(key);
      }

      // Use db.pool.query (not db.query)
      const [rows] = await db.pool.query(
        'SELECT config_value, value_type FROM system_configuration WHERE config_key = ?',
        [key]
      );

      if (rows.length === 0) {
        return null;
      }

      const config = rows[0];
      let value = config.config_value;

      // Convert to appropriate type
      switch (config.value_type) {
        case 'number':
          value = value ? Number(value) : null;
          break;
        case 'boolean':
          value = value === 'true' || value === '1';
          break;
        case 'json':
          value = value ? JSON.parse(value) : null;
          break;
      }

      // Cache it
      this.cache.set(key, value);

      return value;
    } catch (error) {
      console.error(`Error getting config ${key}:`, error.message);
      return null;
    }
  }

  /**
   * Set a configuration value
   */
  async set(key, value) {
    try {
      // Derive value_type from the JS type so get() can convert back correctly
      let valueType = 'string';
      if (typeof value === 'boolean') valueType = 'boolean';
      else if (typeof value === 'number') valueType = 'number';
      else if (typeof value === 'object' && value !== null) valueType = 'json';

      const stringValue = value !== null ? String(value) : null;

      await db.pool.query(
        `INSERT INTO system_configuration (config_key, config_value, value_type, updated_at)
         VALUES (?, ?, ?, datetime('now'))
         ON CONFLICT(config_key) DO UPDATE SET
           config_value = excluded.config_value,
           value_type   = excluded.value_type,
           updated_at   = excluded.updated_at`,
        [key, stringValue, valueType]
      );

      // Update cache
      this.cache.set(key, value);

      return true;
    } catch (error) {
      console.error(`Error setting config ${key}:`, error.message);
      throw error;
    }
  }

  /**
   * Get all configuration in a category
   */
  async getCategory(category) {
    try {
      const [rows] = await db.pool.query(
        'SELECT config_key, config_value, value_type FROM system_configuration WHERE category = ?',
        [category]
      );

      const config = {};
      rows.forEach(row => {
        let value = row.config_value;

        switch (row.value_type) {
          case 'number':
            value = value ? Number(value) : null;
            break;
          case 'boolean':
            value = value === 'true' || value === '1';
            break;
          case 'json':
            value = value ? JSON.parse(value) : null;
            break;
        }

        config[row.config_key] = value;
      });

      return config;
    } catch (error) {
      console.error(`Error getting category ${category}:`, error.message);
      return {};
    }
  }

  /**
   * Get selected inverter model
   */
  async getSelectedModel() {
    const modelId = await this.get('modbus_selected_model_id');
    
    if (!modelId) {
      return null;
    }

    try {
      const [rows] = await db.pool.query(
        'SELECT * FROM inverter_models WHERE id = ?',
        [modelId]
      );

      return rows.length > 0 ? rows[0] : null;
    } catch (error) {
      console.error('Error getting selected model:', error.message);
      return null;
    }
  }

  /**
   * Set selected inverter model
   */
  async setSelectedModel(modelId) {
    try {
      // Verify model exists
      const [models] = await db.pool.query(
        'SELECT manufacturer, model_name FROM inverter_models WHERE id = ?',
        [modelId]
      );

      if (models.length === 0) {
        throw new Error(`Model ID ${modelId} not found`);
      }

      const model = models[0];

      // Update configuration
      await this.set('modbus_selected_model_id', modelId);
      await this.set('modbus_manufacturer', model.manufacturer);
      await this.set('modbus_model_name', model.model_name);

      console.log(`✅ Selected inverter model: ${model.manufacturer} ${model.model_name}`);
      return true;
    } catch (error) {
      console.error('Error setting selected model:', error.message);
      throw error;
    }
  }

  /**
   * Check if setup is completed
   */
  async isSetupCompleted() {
    return await this.get('setup_completed');
  }

  /**
   * Mark setup as completed
   */
  async completeSetup() {
    await this.set('setup_completed', true);
    await this.set('setup_step', 5);
    console.log('✅ Setup completed');
  }

  /**
   * Clear cache
   */
  clearCache() {
    this.cache.clear();
  }
  /**
   * Get the device schema for a specific module.
   */
  async getSchemaByModule(moduleName) {
    try {
      // Look for either name used in your modules
      const schemaFiles = ['device_schema.json'];
      const projectRoot = path.resolve(__dirname, '../../../../');
      
      // 2. Build the path: [ProjectRoot] / server / modules / [moduleName] / config
      const moduleConfigPath = path.join(projectRoot, 'server', 'modules', moduleName, 'config');  
      for (const fileName of schemaFiles) {
        const fullPath = path.join(moduleConfigPath, fileName);
        try {
          const content = await fs.readFile(fullPath, 'utf8');
          return JSON.parse(content);
        } catch (err) {
          // File not found, check next possible filename
          continue;
        }
      }
      return null;
    } catch (error) {
      // This is where the "path is not defined" error was being caught
      console.error(`❌ Error reading schema for ${moduleName} in /core/system/services/systemconfigservice.js`, error.message);
      return null;
    }
  }

}

export default new SystemConfigService();