// server/core/system/routes/settings.js
import express from 'express';
import settingsService from '../services/settingsService.js';
import moduleLoader from '../../moduleLoader.js'; // Zorg voor het juiste pad naar je loader
import { authorize } from '../../auth/middleware/authorize.js';
import userService from '../../auth/services/userService.js';

const router = express.Router();

/**
 * GET /api/settings/modules
 * Geeft een lijst van alle ontdekte modules inclusief hun status
 */
router.get('/modules', authorize('admin'), async (req, res) => {
  const modules = moduleLoader.getAllModules().map(m => ({
    module_id: m.manifest.id, // De frontend verwacht 'module_id'
    module_name: m.manifest.name,
    enabled: m.manifest.enabled !== false,
    has_schema: !!m.manifest.settingsSchema // Controleer of dit klopt met je Loader
  }));
  res.json({ success: true, modules });
});
/**
 * GET /api/settings/module/:moduleId
 * Haalt het JSON-schema en de huidige database-waarden op.
 * Speciale handling voor 'core' om systeem-brede instellingen te groeperen.
 */
router.get('/module/:moduleId', authorize('admin'), async (req, res) => {
  try {
    const { moduleId } = req.params;
    let schema = null;
    let values = {};

    // Reguliere module handling via moduleLoader
    const module = moduleLoader.getModule(moduleId);
    if (!module) {
      return res.status(404).json({ success: false, error: 'Module niet gevonden' });
    }
    schema = module.manifest.settingsSchema || null;
    values = await settingsService.getCategory(moduleId);


    res.json({ 
      success: true,
      schema,
      values
    });
  } catch (error) {
    console.error(`Error fetching settings for ${req.params.moduleId}:`, error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/settings/module/:moduleId
 * Slaat instellingen op. Bij 'core' moeten we de velden terugsturen naar hun originele categorie.
 */
router.post('/module/:moduleId', authorize('admin'), async (req, res) => {
  try {
    const { moduleId } = req.params;
    const settings = req.body;

     await settingsService.setCategory(moduleId, settings, req.user.username, 'Module update');

    
    res.json({ success: true, message: 'Instellingen succesvol bijgewerkt' });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message, moduleId});
  }
});

/**
 * ==========================================
 * SYSTEM (CORE) SETTINGS
 * ==========================================
 */
/**
 * GET /api/settings/core
 * Haalt alle systeem-brede categorieën op en bouwt een volledig schema.
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
        groups: [
          {
            title: 'Systeem & Locatie',
            sections: [{
              fields: [
                { key: 'system_name', component: 'text', label: 'Systeem Naam', column: 2, editable: true, },
                { key: 'location', component: 'text', label: 'Locatie', column: 2 , editable: true,},
                { key: 'timezone', component: 'text', label: 'Tijdzone', column: 2 , editable: true,}
              ]
            }]
          },
          {
            title: 'Data Collectie',
            sections: [{
              fields: [
                { key: 'primary_source', component: 'dropdown', label: 'Primaire Bron', column: 2, editable: true, options: [
                  { label: 'Cloud API', value: 'cloud' },
                  { label: 'ModBus TCP', value: 'modbus' }
                ]},
                { key: 'enable_failover', component: 'switch', label: 'Automatische Failover', column: 2, editable: true, },
                { key: 'cache_timeout', component: 'number', label: 'Cache Timeout (ms)', column: 2, editable: true, suffix: 'ms' },
                { key: 'failover_threshold', component: 'number', label: 'Failover Drempel', column: 2, editable: true, }
              ]
            }]
          },
          {
            title: 'Notificaties',
            sections: [{
              fields: [
                { key: 'email_enabled', component: 'switch', label: 'E-mail Notificaties', column: 2 , editable: true,},
                { key: 'email_address', component: 'text', label: 'Ontvanger E-mail', column: 2, placeholder: 'voorbeeld@domein.nl', editable: true, }
              ]
            }]
          },
          {
            title: 'Data Retentie (Dagen)',
            sections: [{
              fields: [
                { key: 'snapshots_days', component: 'number', label: 'Snapshots', column: 3, editable: true,},
                { key: 'minutes_days', component: 'number', label: 'Minuut Data', column: 3, editable: true, },
                { key: 'hours_days', component: 'number', label: 'Uur Data', column: 3, editable: true, }
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
      system_name: 'system', location: 'system', timezone: 'system',
      primary_source: 'data_collection', enable_failover: 'data_collection', 
      cache_timeout: 'data_collection', failover_threshold: 'data_collection',
      email_enabled: 'notifications', email_address: 'notifications',
      snapshots_days: 'retention', minutes_days: 'retention', hours_days: 'retention'
    };

    for (const [key, value] of Object.entries(updates)) {
      const category = categoryMapping[key];
      if (category) {
        await settingsService.set(category, key, value, req.user.username, 'Core Systeem Update');
      }
    }
    res.json({ success: true, message: 'Systeeminstellingen succesvol bijgewerkt' });
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
        title: 'Gebruikersbeheer',
        sections: [{
          component: 'table',
          data: {
            endpoint: '/settings/users/list',
            columns: [
              { field: 'username', header: 'Gebruikersnaam', sortable: true },
              { field: 'email', header: 'E-mail', sortable: true },
              { field: 'role', header: 'Rol' }
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
                confirmMessage: 'Weet je zeker dat je gebruiker {username} wilt verwijderen?'
              }
            ]
          }
        }]
      }],
      globalActions: [
        { label: 'Gebruiker Aanmaken', icon: 'pi-user-plus', type: 'drawer', endpoint: '/settings/users/create', method: 'POST' }
      ]
    }
  });
});

/**
 * Hulproutes voor Gebruikers
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