// server/core/system/routes/settings.js
import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import settingsService from '../services/settingsService.js';
import moduleLoader from '../../moduleLoader.js'; // Adjust path to your loader as needed
import { authorize } from '../../auth/middleware/authorize.js';
import userService from '../../auth/services/userService.js';
import collectorManager from '../../collectorManager.js';

/**
 * Load all locale files from a module's locales/ directory.
 * Accepts either a full path string or a module object from moduleLoader.
 * The module object may expose its path as module.path, module.dir,
 * module.manifest.path, or module.manifest.dir — we try all of them.
 * Returns an object keyed by language code: { en: {...}, nl: {...}, ... }
 * Returns empty object if no locales directory can be found.
 */
const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

function loadModuleMessages(moduleOrPath) {
  // Resolve the base directory from whatever we were given
  let modulePath = null;
  if (typeof moduleOrPath === 'string') {
    modulePath = moduleOrPath;
  } else if (moduleOrPath) {
    modulePath =
      moduleOrPath.modulePath ||   // set by moduleLoader.loadModule()
      moduleOrPath.path       ||
      moduleOrPath.dir        ||
      moduleOrPath.manifest?.path ||
      moduleOrPath.manifest?.dir  ||
      null;
  }
  if (!modulePath) return {};

  const localesDir = path.join(modulePath, 'locales');
  if (!fs.existsSync(localesDir)) return {};

  const messages = {};
  try {
    const files = fs.readdirSync(localesDir).filter(f => f.endsWith('.json'));
    for (const file of files) {
      const lang = path.basename(file, '.json');
      const content = fs.readFileSync(path.join(localesDir, file), 'utf-8');
      messages[lang] = JSON.parse(content);
    }
  } catch (err) {
    console.warn(`Warning: could not load module locales from ${localesDir}:`, err.message);
  }
  return messages;
}

const router = express.Router();

/**
 * GET /api/settings/modules
 * Returns a list of all discovered modules including their status
 */
router.get('/modules', authorize('admin'), async (req, res) => {
  const modules = moduleLoader.getAllModules().map(m => ({
    module_id: m.manifest.id, // Frontend expects 'module_id'
    module_name: m.manifest.name,
    enabled: m.manifest.enabled !== false,
    has_schema: !!m.manifest.settingsSchema // Verify this matches your Loader
  }));
  res.json({ success: true, modules });
});
/**
 * GET /api/settings/module/:moduleId
 * Fetches the JSON schema and current database values.
 * Special handling for 'core' to group system-wide settings.
 */
router.get('/module/:moduleId', authorize('admin'), async (req, res) => {
  try {
    const { moduleId } = req.params;

    const module = moduleLoader.getModule(moduleId);
    if (!module) {
      return res.status(404).json({ success: false, error: 'Module not found' });
    }

    const schema   = module.manifest.settingsSchema || null;
    const values   = await settingsService.getCategory(moduleId);
    // Load translations from the module's own locales/ folder.
    // The frontend merges these into vue-i18n at runtime — no frontend
    // changes needed when a new module is added.
    // Pass the whole module object — loadModuleMessages tries all known path properties
    const messages = loadModuleMessages(module);

    res.json({ success: true, schema, values, messages });
  } catch (error) {
    console.error(`Error fetching settings for ${req.params.moduleId}:`, error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/settings/module/:moduleId
 * Saves settings. Notifies collectorManager if enabled flag changed.
 */

router.post('/module/:moduleId', authorize('admin'), async (req, res) => {
  try {
    const { moduleId } = req.params;
    const settings = req.body;

    // 1. Persist to DB
    await settingsService.setCategory(moduleId, settings, req.user.username, 'Module update');

    // 2. Let the module re-read its own fresh config
    const module = moduleLoader.getModule(moduleId);
    if (module && typeof module.reinitialize === 'function') {
      try {
        await module.reinitialize();
      } catch (e) {
        console.warn(`   ⚠️  reinitialize() failed for '${moduleId}': ${e.message}`);
      }
    }

    // 3. Notify collectorManager if enabled changed
    if ('enabled' in settings) {
      const isEnabled = settings.enabled === true
        || settings.enabled === 'true'
        || settings.enabled === '1'
        || settings.enabled === 1;

      try {
        await collectorManager.setEnabled(moduleId, isEnabled);
        console.log(`   ${isEnabled ? '▶' : '⏹'} collectorManager.setEnabled('${moduleId}', ${isEnabled})`);
      } catch (e) {
        console.warn(`   ⚠️  setEnabled skipped for '${moduleId}': ${e.message}`);
      }
    }

    res.json({ success: true, message: 'Settings updated successfully' });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message, moduleId });
  }
});
/**
 * ==========================================
 * SYSTEM (CORE) SETTINGS
 * ==========================================
 */
/**
 * GET /api/settings/core
 * Fetches all system-wide categories and builds a complete schema.
 */
router.get('/core', authorize('admin'), async (req, res) => {
  try {
    const coreCategories = ['system', 'data_collection', 'retention', 'notifications'];
    let values = {};

    for (const cat of coreCategories) {
      const catValues = await settingsService.getCategory(cat);
      values = { ...values, ...catValues };
    }

    res.json({
      success: true,
      schema: {
        i18nKeys: true,
        groups: [
          {
            title: 'settings.core.groups.system.title',
            sections: [{
              fields: [
                { key: 'system_name', component: 'text', label: 'settings.core.fields.system_name', column: 2, editable: true },
                { key: 'location',    component: 'text', label: 'settings.core.fields.location',    column: 2, editable: true },
                { key: 'timezone',    component: 'text', label: 'settings.core.fields.timezone',    column: 2, editable: true }
              ]
            }]
          },
          {
            title: 'settings.core.groups.dataCollection.title',
            sections: [{
              fields: [
                { key: 'primary_source', component: 'dropdown', label: 'settings.core.fields.primary_source', column: 2, editable: true, options: [
                  { label: 'Cloud API', value: 'cloud' },
                  { label: 'ModBus TCP', value: 'modbus' }
                ]},
                { key: 'enable_failover',    component: 'switch', label: 'settings.core.fields.enable_failover',    column: 2, editable: true },
                { key: 'cache_timeout',      component: 'number', label: 'settings.core.fields.cache_timeout',      column: 2, editable: true, suffix: 'ms' },
                { key: 'failover_threshold', component: 'number', label: 'settings.core.fields.failover_threshold', column: 2, editable: true }
              ]
            }]
          },
          {
            title: 'settings.core.groups.notifications.title',
            sections: [{
              fields: [
                { key: 'email_enabled', component: 'switch', label: 'settings.core.fields.email_enabled', column: 2, editable: true },
                { key: 'email_address', component: 'text',   label: 'settings.core.fields.email_address', column: 2, editable: true,
                  placeholder: 'settings.core.fields.email_address_placeholder' }
              ]
            }]
          },
          {
            title: 'settings.core.groups.retention.title',
            sections: [{
              fields: [
                { key: 'snapshots_days', component: 'number', label: 'settings.core.fields.snapshots_days', column: 3, editable: true },
                { key: 'minutes_days',   component: 'number', label: 'settings.core.fields.minutes_days',   column: 3, editable: true },
                { key: 'hours_days',     component: 'number', label: 'settings.core.fields.hours_days',     column: 3, editable: true }
              ]
            }]
          }
        ]
      },
      values
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/settings/core
 */
router.post('/core', authorize('admin'), async (req, res) => {
  try {
    const updates = req.body;
    const categoryMapping = {
      system_name: 'system', location: 'system', timezone: 'system', theme: 'system',
      primary_source: 'data_collection', enable_failover: 'data_collection',
      cache_timeout: 'data_collection', failover_threshold: 'data_collection',
      email_enabled: 'notifications', email_address: 'notifications',
      snapshots_days: 'retention', minutes_days: 'retention', hours_days: 'retention'
    };

    for (const [key, value] of Object.entries(updates)) {
      const category = categoryMapping[key];
      if (category) {
        await settingsService.upsert(category, key, value, {
          changedBy: req.user.username,
          reason: 'Core system update',
        });
      }
    }
    res.json({ success: true, message: 'System settings updated successfully' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/settings/users
 */
router.get('/users', authorize('admin'), async (req, res) => {
  res.json({
    success: true,
    schema: {
      groups: [{
        title: 'settings.users.groups.management.title',
        sections: [{
          component: 'table',
          data: {
            endpoint: '/settings/users/list',
            columns: [
              { field: 'username', header: 'settings.users.columns.username', sortable: true },
              { field: 'email', header: 'settings.users.columns.email', sortable: true },
              { field: 'role', header: 'settings.users.columns.role' }
            ],
            rowActions: [
              { 
                label: 'edit', 
                icon: 'pi-pencil', 
                action: 'edit', 
                type: 'drawer', // Tells frontend to use AppDrawer
                endpoint: '/settings/users/{id}', // Template for saving
                method: 'PUT'
              },
              { 
                label: 'delete', 
                icon: 'pi-trash', 
                action: 'delete', 
                type: 'modal', // Tells frontend to use AppModal
                severity: 'danger',
                endpoint: '/settings/users/{id}',
                method: 'DELETE',
                confirmMessage: 'settings.users.confirmDelete'
              }
            ]
          }
        }]
      }],
      globalActions: [
        { label: 'settings.users.actions.create', icon: 'pi-user-plus', type: 'drawer', endpoint: '/settings/users/create', method: 'POST' }
      ]
    }
  });
});

/**
 * Helper routes for Users
 */
router.get('/users/list', authorize('admin'), async (req, res) => {
  try {
    const users = await userService.getAllUsers();
    res.json({ success: true, data: users });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/users/create', authorize('admin'), async (req, res) => {
  try {
    const { new_username, new_password, new_email, new_role } = req.body;
    await userService.createUser({
      username: new_username,
      password: new_password,
      email: new_email,
      role: new_role
    });
    res.json({ success: true, message: 'user created' });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

router.post('/users/update', authorize('admin'), async (req, res) => {
  try {
    const { user_id, new_username, new_password, new_email, new_role } = req.body;
    await userService.updateUser(user_id, {
      username: new_username,
      password: new_password,
      email: new_email,
      role: new_role  
    });
    res.json({ success: true, message: 'user update' });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});
router.post('/users/delete', authorize('admin'), async (req, res) => {
  try {
    const { user_id } = req.body;
    await userService.deleteUser(user_id);
    res.json({ success: true, message: 'user deleted' });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  } 
});

// ============================================================================
// DAY-AHEAD CHART SETTINGS — price threshold persistence
// ============================================================================

/**
 * GET /api/settings/day-ahead-chart
 * Returns { green_below: number, red_above: number }
 * No admin required — any authenticated user can read/write their chart prefs
 */
router.get('/day-ahead-chart', async (req, res) => {
  try {
    const settings = await settingsService.getCategory('day-ahead-chart');
    res.json({
      success    : true,
      green_below: settings.green_below ?? 30,
      red_above  : settings.red_above   ?? 70,
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * PUT /api/settings/day-ahead-chart
 * Body: { green_below: number, red_above: number }
 * Upserts rows — works even if rows don't exist yet
 */
router.put('/day-ahead-chart', async (req, res) => {
  try {
    const { green_below, red_above } = req.body;
    const gb = Number(green_below);
    const ra = Number(red_above);

    if (isNaN(gb) || isNaN(ra))  return res.status(400).json({ success: false, error: 'Values must be numbers' });
    if (gb < 0 || gb > 100)      return res.status(400).json({ success: false, error: 'green_below must be 0–100' });
    if (ra < 0 || ra > 100)      return res.status(400).json({ success: false, error: 'red_above must be 0–100' });
    if (gb >= ra)                 return res.status(400).json({ success: false, error: 'green_below must be less than red_above' });

    const changedBy = req.user?.username ?? 'ui';
    const meta      = { changedBy, reason: 'User adjusted price thresholds', valueType: 'number', editable: 1, visible: 1 };

    await settingsService.upsert('day-ahead-chart', 'green_below', gb, {
      ...meta, description: 'Price percentile below which bars show green (cheap). 0=day-min, 100=day-max.'
    });
    await settingsService.upsert('day-ahead-chart', 'red_above', ra, {
      ...meta, description: 'Price percentile above which bars show red (expensive). 0=day-min, 100=day-max.'
    });

    res.json({ success: true, green_below: gb, red_above: ra });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;