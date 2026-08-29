// modules/push-notifications/index.js
import { readFileSync, existsSync } from 'fs';
import { fileURLToPath, pathToFileURL } from 'url';
import { dirname, join } from 'path';
import webpush from 'web-push';
import settingsService from '../../core/system/services/settingsService.js';
import alertService from '../../core/system/services/alertService.js';
import sender from './services/sender.js';
import { padName } from '../../core/utils/logger.js';

const PREFIX = padName('Push Notifications');
const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);
const manifest = JSON.parse(readFileSync(join(__dirname, 'manifest.json'), 'utf-8'));

const MODULE_ID = 'push-notifications';
const SEVERITY_LEVELS = { debug: 0, info: 1, notice: 2, warning: 3, error: 4, critical: 5 };

class PushNotificationsModule {
  constructor() {
    this.manifest    = manifest;
    this.initialized = false;
    this.config      = null;
    this._onAlert    = this._onAlert.bind(this);
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  async initialize() {
    if (this.initialized) return;

    try {
      console.log(`   - \x1b[93m${PREFIX} \x1b[37m`);
      this.config = await settingsService.getCategory(MODULE_ID);

      if (!this.config || this.config.enabled === false) {
        console.log(`     - ${PREFIX}: disabled in settings`);
        return;
      }

      // Generate VAPID keypair on first run — persisted so it survives restarts.
      if (!this.config.vapid_public_key || !this.config.vapid_private_key) {
        const keys = webpush.generateVAPIDKeys();
        await settingsService.setCategory(MODULE_ID, {
          ...this.config,
          vapid_public_key:  keys.publicKey,
          vapid_private_key: keys.privateKey,
        });
        this.config.vapid_public_key  = keys.publicKey;
        this.config.vapid_private_key = keys.privateKey;
        console.log(`     - ${PREFIX}: generated new VAPID keypair`);
      }

      webpush.setVapidDetails(
        this.config.vapid_subject || 'mailto:peter.m.aarts@gmail.com',
        this.config.vapid_public_key,
        this.config.vapid_private_key
      );

      await sender.ensureTable();
      sender.configure(webpush);

      this._minSeverityLevel = SEVERITY_LEVELS[this.config.min_severity] ?? SEVERITY_LEVELS.info;

      alertService.on('alert', this._onAlert);

      this.routes = await this._loadRoutes();
      this.initialized = true;
      console.log(`     - ${PREFIX}: listening for alerts >= '${this.config.min_severity || 'info'}' \x1b[32m✓\x1b[37m`);

    } catch (error) {
      console.error(`\x1b[91m     - ${PREFIX}: initialize failed:`, error.message, '\x1b[37m');
      throw error;
    }
  }

  // ── Alert listener ───────────────────────────────────────────────────────────

  _onAlert(alert) {
    const level = SEVERITY_LEVELS[alert.severity] ?? SEVERITY_LEVELS.info;
    if (level < this._minSeverityLevel) return;

    sender.sendToAll({
      title: this._titleFor(alert.severity),
      body:  this._bodyFor(alert),
      data:  { alertId: alert.id, source: alert.source, type: alert.type },
    }).catch(err => {
      console.error(`   - ${PREFIX}: send failed — ${err.message}`);
    });
  }

    _bodyFor(alert) {
    const text = alert.summary || alert.message || '';
    const MAX = 180; // backstop for sources that never set summary
    return text.length > MAX ? text.slice(0, MAX - 1) + '…' : text;
  }
  
  _titleFor(severity) {
    const map = {
      info: 'Wolffie', notice: 'Wolffie',
      warning: 'Wolffie ⚠️', error: 'Wolffie ⚠️', critical: 'Wolffie 🔴',
    };
    return map[severity] || 'Wolffie';
  }

  // ── Status / routes ───────────────────────────────────────────────────────────

  getStatus() {
    return {
      initialized: this.initialized,
      enabled:     this.config?.enabled ?? false,
      hasConfig:   !!this.config,
    };
  }

  getRoutes() {
    return this.routes ?? null;
  }

  async _loadRoutes() {
    try {
      const routesPath = join(__dirname, 'routes', 'index.js');
      if (existsSync(routesPath)) {
        const m = await import(pathToFileURL(routesPath).href);
        return m.default;
      }
    } catch (e) {
      console.warn(`     - ${PREFIX}: route loading failed:`, e.message);
    }
    return null;
  }

  async reinitialize() {
    console.log(`   - ${PREFIX}: reinitializing with fresh settings`);
    if (this.initialized) alertService.off('alert', this._onAlert);
    this.initialized = false;
    await this.initialize();
  }
}

export default new PushNotificationsModule();