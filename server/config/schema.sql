-- ============================================================================
-- Wolffie — SQLite Schema
-- Automatisch uitgevoerd bij eerste opstart als de database leeg is.
-- ============================================================================

CREATE TABLE IF NOT EXISTS app_alert_dismissals (
  id           INTEGER PRIMARY KEY,
  alert_id     INTEGER NOT NULL,
  user_id      INTEGER NOT NULL,
  dismissed_at TEXT    DEFAULT (datetime('now')),
  UNIQUE (alert_id, user_id),
  FOREIGN KEY (alert_id) REFERENCES app_alerts(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS app_alerts (
  id            INTEGER PRIMARY KEY,
  source        TEXT    NOT NULL,
  source_id     TEXT    DEFAULT NULL,
  type          TEXT    NOT NULL,
  severity      TEXT    DEFAULT 'info',
  message       TEXT    NOT NULL,
  action        TEXT    NOT NULL,
  suggestion    TEXT    DEFAULT NULL,
  auto_resolved INTEGER DEFAULT 0,
  resolved_at   TEXT    DEFAULT NULL,
  created_at    TEXT    DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS auth_audit_log (
  id            INTEGER PRIMARY KEY,
  user_id       INTEGER DEFAULT NULL,
  username      TEXT    DEFAULT NULL,
  event_type    TEXT    NOT NULL,
  ip_address    TEXT    DEFAULT NULL,
  user_agent    TEXT    DEFAULT NULL,
  success       INTEGER DEFAULT 1,
  error_message TEXT    DEFAULT NULL,
  timestamp     TEXT    DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS collector_runs (
  id                 INTEGER PRIMARY KEY,
  collector_name     TEXT    NOT NULL,
  run_start          TEXT    DEFAULT (datetime('now')),
  run_end            TEXT    DEFAULT NULL,
  status             TEXT    DEFAULT 'running',
  records_collected  INTEGER DEFAULT 0,
  error_message      TEXT    DEFAULT NULL,
  execution_time_ms  INTEGER DEFAULT NULL
);

CREATE TABLE IF NOT EXISTS collector_settings (
  id             INTEGER PRIMARY KEY,
  collector_name TEXT    NOT NULL,
  enabled        INTEGER DEFAULT 1,
  schedule_cron  TEXT    DEFAULT '0 6 * * *',
  last_run       TEXT    DEFAULT NULL,
  next_run       TEXT    DEFAULT NULL,
  config         TEXT    DEFAULT NULL,
  created_at     TEXT    DEFAULT (datetime('now')),
  updated_at     TEXT    DEFAULT (datetime('now')),
  UNIQUE (collector_name)
);

CREATE TABLE IF NOT EXISTS day_ahead_prices (
  id                INTEGER PRIMARY KEY,
  datetime          TEXT    NOT NULL,
  price_eur_per_mwh REAL    NOT NULL,
  price_eur_per_kwh REAL    NOT NULL,
  country_code      TEXT    DEFAULT 'NL',
  bidding_zone      TEXT    DEFAULT 'NL',
  data_source       TEXT    DEFAULT 'entsoe',
  created_at        TEXT    DEFAULT (datetime('now')),
  updated_at        TEXT    DEFAULT (datetime('now')),
  UNIQUE (datetime, bidding_zone)
);

CREATE TABLE IF NOT EXISTS device_daily_usage (
  id           INTEGER PRIMARY KEY,
  device_id    TEXT    NOT NULL,
  date         TEXT    NOT NULL,
  usage_kwh    REAL    NOT NULL DEFAULT 0,
  last_update  TEXT    DEFAULT NULL,
  avg_power    REAL    DEFAULT NULL,
  max_power    REAL    DEFAULT NULL,
  avg_voltage  REAL    DEFAULT NULL,
  sample_count INTEGER DEFAULT 0,
  source       TEXT    DEFAULT NULL,
  UNIQUE (device_id, date)
);

CREATE TABLE IF NOT EXISTS device_measurements (
  id            INTEGER PRIMARY KEY,
  timestamp     TEXT    NOT NULL,
  device_id     TEXT    NOT NULL,
  device_type   TEXT    NOT NULL,
  device_name   TEXT    DEFAULT NULL,
  source        TEXT    NOT NULL,
  power         REAL    DEFAULT 0,
  voltage       REAL    DEFAULT 0,
  current       REAL    DEFAULT 0,
  energy_today  REAL    DEFAULT 0,
  energy_total  REAL    DEFAULT 0,
  extra_metrics TEXT    DEFAULT NULL
);

CREATE TABLE IF NOT EXISTS device_settings (
  id            INTEGER PRIMARY KEY,
  name          TEXT    NOT NULL,
  ip_address    TEXT    NOT NULL,
  port          INTEGER DEFAULT 80,
  product_type  TEXT    DEFAULT 'HWE-P1',
  module        TEXT    DEFAULT NULL,
  product_name  TEXT    DEFAULT NULL,
  serial        TEXT    DEFAULT NULL,
  firmware_version TEXT DEFAULT NULL,
  enabled       INTEGER DEFAULT 1,
  poll_interval INTEGER DEFAULT 10,
  switch_lock   INTEGER DEFAULT 0,
  power_on      INTEGER DEFAULT 1,
  brightness    INTEGER DEFAULT 150,
  priority      INTEGER DEFAULT 3,
  created_at    TEXT    DEFAULT (datetime('now')),
  updated_at    TEXT    DEFAULT (datetime('now')),
  UNIQUE (ip_address, port)
);

CREATE TABLE IF NOT EXISTS electricity_tariffs (
  id           INTEGER PRIMARY KEY,
  name         TEXT    NOT NULL,
  start_time   TEXT    NOT NULL,
  end_time     TEXT    NOT NULL,
  import_rate  REAL    DEFAULT NULL,
  export_rate  REAL    DEFAULT NULL,
  days_of_week TEXT    DEFAULT NULL,
  active       INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS energy_daily (
  id                    INTEGER PRIMARY KEY,
  date                  TEXT    NOT NULL,
  pv_generation_kwh     REAL    DEFAULT NULL,
  grid_import_kwh       REAL    DEFAULT NULL,
  grid_export_kwh       REAL    DEFAULT NULL,
  battery_charge_kwh    REAL    DEFAULT NULL,
  battery_discharge_kwh REAL    DEFAULT NULL,
  load_consumption_kwh  REAL    DEFAULT NULL,
  self_consumption_rate REAL    DEFAULT NULL,
  self_sufficiency_rate REAL    DEFAULT NULL,
  battery_soc_min       INTEGER DEFAULT NULL,
  battery_soc_max       INTEGER DEFAULT NULL,
  battery_soc_avg       REAL    DEFAULT NULL,
  battery_cycles        REAL    DEFAULT NULL,
  pv_peak_power         INTEGER DEFAULT NULL,
  pv_hours              REAL    DEFAULT NULL,
  cost_grid_import      REAL    DEFAULT NULL,
  revenue_grid_export   REAL    DEFAULT NULL,
  savings               REAL    DEFAULT NULL,
  UNIQUE (date)
);

CREATE TABLE IF NOT EXISTS energy_hours (
  id                   INTEGER PRIMARY KEY,
  timestamp            TEXT    NOT NULL,
  battery_soc_avg      REAL    DEFAULT NULL,
  battery_power_avg    INTEGER DEFAULT NULL,
  grid_power_avg       INTEGER DEFAULT NULL,
  pv_power_avg         INTEGER DEFAULT NULL,
  load_power_avg       INTEGER DEFAULT NULL,
  pv_energy_wh         INTEGER DEFAULT NULL,
  grid_import_wh       INTEGER DEFAULT NULL,
  grid_export_wh       INTEGER DEFAULT NULL,
  battery_charge_wh    INTEGER DEFAULT NULL,
  battery_discharge_wh INTEGER DEFAULT NULL,
  load_consumption_wh  INTEGER DEFAULT NULL,
  UNIQUE (timestamp)
);

CREATE TABLE IF NOT EXISTS energy_minutes (
  id                      INTEGER PRIMARY KEY,
  timestamp               TEXT    NOT NULL,
  battery_soc_avg         REAL    DEFAULT NULL,
  battery_power_avg       INTEGER DEFAULT NULL,
  battery_charge_wh       REAL    DEFAULT 0,
  battery_discharge_wh    REAL    DEFAULT 0,
  battery_temperature_avg REAL    DEFAULT NULL,
  grid_power_avg          INTEGER DEFAULT NULL,
  pv_power_avg            INTEGER DEFAULT NULL,
  pv_energy_wh            REAL    DEFAULT 0,
  load_power_avg          INTEGER DEFAULT NULL,
  load_energy_wh          REAL    DEFAULT 0,
  battery_soc_min         INTEGER DEFAULT NULL,
  battery_soc_max         INTEGER DEFAULT NULL,
  pv_power_max            INTEGER DEFAULT NULL,
  grid_power_min          INTEGER DEFAULT NULL,
  grid_power_max          INTEGER DEFAULT NULL,
  grid_import_wh          REAL    DEFAULT 0,
  grid_export_wh          REAL    DEFAULT 0,
  sample_count            INTEGER DEFAULT 0,
  UNIQUE (timestamp)
);

CREATE TABLE IF NOT EXISTS energy_monthly (
  id                    INTEGER PRIMARY KEY,
  year                  INTEGER NOT NULL,
  month                 INTEGER NOT NULL,
  pv_generation_kwh     REAL    DEFAULT NULL,
  grid_import_kwh       REAL    DEFAULT NULL,
  grid_export_kwh       REAL    DEFAULT NULL,
  battery_charge_kwh    REAL    DEFAULT NULL,
  battery_discharge_kwh REAL    DEFAULT NULL,
  load_consumption_kwh  REAL    DEFAULT NULL,
  self_consumption_rate REAL    DEFAULT NULL,
  self_sufficiency_rate REAL    DEFAULT NULL,
  cost_grid_import      REAL    DEFAULT NULL,
  revenue_grid_export   REAL    DEFAULT NULL,
  savings               REAL    DEFAULT NULL,
  UNIQUE (year, month)
);

CREATE TABLE IF NOT EXISTS energy_snapshots (
  id                        INTEGER PRIMARY KEY,
  timestamp                 TEXT    NOT NULL,
  source                    TEXT    NOT NULL,
  device_id                 TEXT    DEFAULT NULL,
  solar_power               INTEGER DEFAULT 0,
  solar_energy_today        REAL    DEFAULT 0,
  battery_power             INTEGER DEFAULT 0,
  battery_soc               INTEGER DEFAULT 0,
  battery_voltage           REAL    DEFAULT 0,
  battery_current           REAL    DEFAULT 0,
  battery_temp              REAL    DEFAULT 0,
  grid_power                INTEGER DEFAULT 0,
  grid_voltage_l1           REAL    DEFAULT 0,
  grid_voltage_l2           REAL    DEFAULT 0,
  grid_voltage_l3           REAL    DEFAULT 0,
  grid_current_l1           REAL    DEFAULT 0,
  grid_current_l2           REAL    DEFAULT 0,
  grid_current_l3           REAL    DEFAULT 0,
  grid_frequency            REAL    DEFAULT 50,
  grid_energy_import_today  REAL    DEFAULT 0,
  grid_energy_export_today  REAL    DEFAULT 0,
  load_power                INTEGER DEFAULT 0,
  load_energy_today         REAL    DEFAULT 0,
  inverter_temp             REAL    DEFAULT 0,
  inverter_power            INTEGER DEFAULT 0,
  created_at                TEXT    DEFAULT (datetime('now')),
  battery_charge_today      REAL    DEFAULT 0,
  battery_discharge_today   REAL    DEFAULT 0,
  trees_equivalent          REAL    DEFAULT 0,
  co2_offset_kg             REAL    DEFAULT 0
);

CREATE TABLE IF NOT EXISTS energy_usage_profiles (
  id                 INTEGER PRIMARY KEY,
  day_type           TEXT    NOT NULL,
  hour               INTEGER NOT NULL CHECK (hour BETWEEN 0 AND 23),
  avg_load_kwh       REAL    DEFAULT 0,
  avg_solar_kwh      REAL    DEFAULT 0,
  sample_count       INTEGER DEFAULT 0,
  standard_deviation REAL    DEFAULT 0,
  last_updated       TEXT    DEFAULT (datetime('now')),
  UNIQUE (day_type, hour)
);

CREATE TABLE IF NOT EXISTS events (
  id        INTEGER PRIMARY KEY,
  timestamp TEXT    NOT NULL,
  category  TEXT    NOT NULL,
  action    TEXT    NOT NULL,
  source    TEXT    NOT NULL,
  details   TEXT    NOT NULL DEFAULT '{}',
  status    TEXT    NOT NULL DEFAULT '',
  userId    INTEGER DEFAULT NULL
);

CREATE TABLE IF NOT EXISTS inverter_models (
  id                     INTEGER PRIMARY KEY,
  manufacturer           TEXT    NOT NULL,
  model_name             TEXT    NOT NULL,
  model_series           TEXT    DEFAULT NULL,
  description            TEXT    DEFAULT NULL,
  battery_capacity_kwh   REAL    DEFAULT NULL,
  max_pv_input_kw        REAL    DEFAULT NULL,
  mppt_inputs            INTEGER DEFAULT NULL,
  grid_type              TEXT    DEFAULT 'single_phase',
  communication_protocol TEXT    DEFAULT 'ModBus TCP',
  default_slave_id       INTEGER DEFAULT 85,
  is_active              INTEGER DEFAULT 1,
  created_at             TEXT    DEFAULT (datetime('now')),
  updated_at             TEXT    DEFAULT (datetime('now')),
  UNIQUE (manufacturer, model_name)
);

CREATE TABLE IF NOT EXISTS modbus_registers (
  id                        INTEGER PRIMARY KEY,
  model_id                  INTEGER NOT NULL,
  category_id               INTEGER NOT NULL,
  register_key              TEXT    NOT NULL,
  register_name             TEXT    NOT NULL,
  description               TEXT    DEFAULT NULL,
  address                   INTEGER NOT NULL,
  length                    INTEGER DEFAULT 1,
  register_type             TEXT    DEFAULT 'input',
  data_type                 TEXT    DEFAULT 'uint16',
  scale_factor              REAL    DEFAULT 1,
  offset_value              REAL    DEFAULT 0,
  unit                      TEXT    DEFAULT NULL,
  min_value                 REAL    DEFAULT NULL,
  max_value                 REAL    DEFAULT NULL,
  decimal_places            INTEGER DEFAULT 1,
  is_signed                 INTEGER DEFAULT 0,
  is_available              INTEGER DEFAULT 1,
  is_writable               INTEGER DEFAULT 0,
  requires_firmware_version TEXT    DEFAULT NULL,
  notes                     TEXT    DEFAULT NULL,
  last_tested_date          TEXT    DEFAULT NULL,
  created_at                TEXT    DEFAULT (datetime('now')),
  updated_at                TEXT    DEFAULT (datetime('now')),
  UNIQUE (model_id, register_key),
  FOREIGN KEY (model_id)    REFERENCES inverter_models(id)     ON DELETE CASCADE,
  FOREIGN KEY (category_id) REFERENCES register_categories(id)
);

CREATE TABLE IF NOT EXISTS module_registry (
  id                  INTEGER PRIMARY KEY,
  module_id           TEXT    NOT NULL,
  module_name         TEXT    NOT NULL,
  module_version      TEXT    NOT NULL,
  module_type         TEXT    NOT NULL,
  enabled             INTEGER DEFAULT 1,
  installed           INTEGER DEFAULT 0,
  has_collector       INTEGER DEFAULT 0,
  has_schema          INTEGER DEFAULT 0,
  has_api             INTEGER DEFAULT 0,
  has_ui              INTEGER DEFAULT 0,
  api_prefix          TEXT    DEFAULT NULL,
  settings_component  TEXT    DEFAULT NULL,
  collector_interval  INTEGER DEFAULT 10000,
  collector_priority  INTEGER DEFAULT 5,
  description         TEXT    DEFAULT NULL,
  author              TEXT    DEFAULT NULL,
  documentation_url   TEXT    DEFAULT NULL,
  discovered_at       TEXT    DEFAULT (datetime('now')),
  installed_at        TEXT    DEFAULT NULL,
  updated_at          TEXT    DEFAULT (datetime('now')),
  last_seen_at        TEXT    DEFAULT NULL,
  UNIQUE (module_id)
);

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id         INTEGER PRIMARY KEY,
  user_id    INTEGER NOT NULL,
  token      TEXT    NOT NULL,
  expires_at TEXT    NOT NULL,
  created_at TEXT    DEFAULT (datetime('now')),
  revoked    INTEGER DEFAULT 0,
  revoked_at TEXT    DEFAULT NULL,
  ip_address TEXT    DEFAULT NULL,
  user_agent TEXT    DEFAULT NULL,
  UNIQUE (token),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS register_aliases (
  id               INTEGER PRIMARY KEY,
  register_id      INTEGER NOT NULL,
  alias_address    INTEGER NOT NULL,
  alias_length     INTEGER DEFAULT 1,
  firmware_version TEXT    DEFAULT NULL,
  notes            TEXT    DEFAULT NULL,
  FOREIGN KEY (register_id) REFERENCES modbus_registers(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS register_categories (
  id            INTEGER PRIMARY KEY,
  category_key  TEXT    NOT NULL,
  category_name TEXT    NOT NULL,
  description   TEXT    DEFAULT NULL,
  display_order INTEGER DEFAULT 0,
  UNIQUE (category_key)
);

CREATE TABLE IF NOT EXISTS scheduled_dispatch (
  id           INTEGER PRIMARY KEY,
  name         TEXT    NOT NULL,
  enabled      INTEGER DEFAULT 1,
  mode         TEXT    NOT NULL,
  start_time   TEXT    NOT NULL,
  end_time     TEXT    DEFAULT NULL,
  duration     INTEGER DEFAULT NULL,
  target_power INTEGER DEFAULT NULL,
  target_soc   INTEGER DEFAULT NULL,
  days_of_week TEXT    DEFAULT NULL,
  conditions   TEXT    DEFAULT NULL,
  created_at   TEXT    DEFAULT (datetime('now')),
  updated_at   TEXT    DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  session_id TEXT    NOT NULL PRIMARY KEY,
  expires    INTEGER NOT NULL,
  data       TEXT    DEFAULT NULL
);

CREATE TABLE IF NOT EXISTS settings_history (
  id            INTEGER PRIMARY KEY,
  setting_id    INTEGER NOT NULL,
  category      TEXT    NOT NULL,
  setting_key   TEXT    NOT NULL,
  old_value     TEXT    DEFAULT NULL,
  new_value     TEXT    DEFAULT NULL,
  changed_by    TEXT    DEFAULT 'system',
  change_reason TEXT    DEFAULT NULL,
  changed_at    TEXT    DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS solar_forecast_hourly (
  id            INTEGER PRIMARY KEY,
  date          TEXT    NOT NULL,
  slot_datetime TEXT    NOT NULL,
  hourly_wh     REAL    NOT NULL DEFAULT 0,
  cumulative_wh REAL    NOT NULL DEFAULT 0,
  data_source   TEXT    DEFAULT 'forecast.solar',
  created_at    TEXT    DEFAULT (datetime('now')),
  updated_at    TEXT    DEFAULT (datetime('now')),
  UNIQUE (slot_datetime)
);

CREATE TABLE IF NOT EXISTS solar_forecasts (
  id                  INTEGER PRIMARY KEY,
  date                TEXT    NOT NULL,
  expected_kwh        REAL    NOT NULL,
  actual_kwh          REAL    DEFAULT NULL,
  accuracy_percentage REAL    DEFAULT NULL,
  data_source         TEXT    DEFAULT 'forecast.solar',
  created_at          TEXT    DEFAULT (datetime('now')),
  updated_at          TEXT    DEFAULT (datetime('now')),
  UNIQUE (date)
);

CREATE TABLE IF NOT EXISTS strategy_alert_dismissals (
  id           INTEGER PRIMARY KEY,
  alert_id     INTEGER NOT NULL,
  user_id      INTEGER NOT NULL,
  dismissed_at TEXT    DEFAULT (datetime('now')),
  UNIQUE (alert_id, user_id)
);

CREATE TABLE IF NOT EXISTS strategy_config (
  id          INTEGER PRIMARY KEY,
  strategy_id TEXT    NOT NULL,
  config      TEXT    NOT NULL DEFAULT '{}',
  updated_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_by  TEXT    NOT NULL DEFAULT 'system',
  UNIQUE (strategy_id)
);

CREATE TABLE IF NOT EXISTS strategy_day_plan (
  id           INTEGER PRIMARY KEY,
  plan_date    TEXT    NOT NULL,
  strategy_id  TEXT    NOT NULL,
  generated_at TEXT    NOT NULL DEFAULT (datetime('now')),
  plan         TEXT    NOT NULL DEFAULT '{}',
  window_hours INTEGER NOT NULL DEFAULT 24,
  window_start TEXT    DEFAULT NULL,
  UNIQUE (plan_date, strategy_id)
);

CREATE TABLE IF NOT EXISTS strategy_decisions (
  id           INTEGER PRIMARY KEY,
  evaluated_at TEXT    NOT NULL DEFAULT (datetime('now')),
  strategy_id  TEXT    NOT NULL,
  action       TEXT    NOT NULL,
  reason       TEXT    NOT NULL,
  executed     INTEGER NOT NULL DEFAULT 0,
  context      TEXT    DEFAULT NULL,
  result       TEXT    DEFAULT NULL
);

CREATE TABLE IF NOT EXISTS system_components (
  id             INTEGER PRIMARY KEY,
  component_key  TEXT    NOT NULL,
  name           TEXT    NOT NULL,
  type           TEXT    NOT NULL,
  category       TEXT    DEFAULT NULL,
  parent_id      INTEGER DEFAULT NULL,
  display_order  INTEGER DEFAULT 0,
  level_depth    INTEGER NOT NULL DEFAULT 1,
  location_type  TEXT    DEFAULT NULL,
  location_label TEXT    DEFAULT NULL,
  icon           TEXT    DEFAULT NULL,
  color          TEXT    DEFAULT NULL,
  data_source    TEXT    DEFAULT NULL,
  specs          TEXT    DEFAULT NULL,
  is_optional    INTEGER DEFAULT 0,
  is_visible     INTEGER DEFAULT 1,
  is_active      INTEGER DEFAULT 1,
  description    TEXT    DEFAULT NULL,
  created_at     TEXT    DEFAULT (datetime('now')),
  updated_at     TEXT    DEFAULT (datetime('now')),
  UNIQUE (component_key),
  FOREIGN KEY (parent_id) REFERENCES system_components(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS system_configuration (
  id           INTEGER PRIMARY KEY,
  config_key   TEXT    NOT NULL,
  config_value TEXT    DEFAULT NULL,
  value_type   TEXT    DEFAULT 'string',
  description  TEXT    DEFAULT NULL,
  category     TEXT    DEFAULT NULL,
  is_required  INTEGER DEFAULT 0,
  created_at   TEXT    DEFAULT (datetime('now')),
  updated_at   TEXT    DEFAULT (datetime('now')),
  UNIQUE (config_key)
);

CREATE TABLE IF NOT EXISTS system_events (
  id          INTEGER PRIMARY KEY,
  timestamp   TEXT    NOT NULL,
  event_type  TEXT    NOT NULL,
  description TEXT    DEFAULT NULL,
  severity    TEXT    DEFAULT 'info',
  data        TEXT    DEFAULT NULL
);

CREATE TABLE IF NOT EXISTS system_settings (
  id               INTEGER PRIMARY KEY,
  category         TEXT    NOT NULL,
  setting_key      TEXT    NOT NULL,
  setting_value    TEXT    DEFAULT NULL,
  value_type       TEXT    DEFAULT 'string',
  is_module        INTEGER DEFAULT 0,
  module_id        TEXT    DEFAULT NULL,
  module_version   TEXT    DEFAULT NULL,
  is_encrypted     INTEGER DEFAULT 0,
  editable         INTEGER DEFAULT 1,
  visible          INTEGER DEFAULT 1,
  display_order    INTEGER DEFAULT 0,
  display_name     TEXT    DEFAULT NULL,
  required         INTEGER DEFAULT 0,
  validation_rules TEXT    DEFAULT NULL,
  options          TEXT    DEFAULT NULL,
  enabled          INTEGER DEFAULT 1,
  description      TEXT    DEFAULT NULL,
  created_at       TEXT    DEFAULT (datetime('now')),
  updated_at       TEXT    DEFAULT (datetime('now')),
  UNIQUE (category, setting_key)
);

CREATE TABLE IF NOT EXISTS users (
  id                   INTEGER PRIMARY KEY,
  username             TEXT    NOT NULL,
  email                TEXT    NOT NULL,
  password_hash        TEXT    NOT NULL,
  full_name            TEXT    DEFAULT NULL,
  role                 TEXT    DEFAULT 'user',
  is_active            INTEGER DEFAULT 1,
  last_password_update TEXT    DEFAULT NULL,
  created_at           TEXT    DEFAULT (datetime('now')),
  updated_at           TEXT    DEFAULT (datetime('now')),
  last_login_at        TEXT    DEFAULT NULL,
  UNIQUE (username),
  UNIQUE (email)
);

-- ── Seed: default system_settings ────────────────────────────────────────────
INSERT OR IGNORE INTO system_settings
  (category, setting_key, setting_value, value_type, is_module, is_encrypted,
   editable, visible, display_order, required, enabled, description)
VALUES
  ('day-ahead-chart', 'green_below', '30',    'number', 0, 0, 1, 1, 0, 0, 1,
   'Price percentile below which bars are shown green (cheap). 0=min price, 100=max price of the day.'),
  ('day-ahead-chart', 'red_above',   '86',    'number', 0, 0, 1, 1, 0, 0, 1,
   'Price percentile above which bars are shown red (expensive). 0=min price, 100=max price of the day.'),
  ('system',          'theme',       'green', 'string', 0, 0, 1, 1, 0, 0, 1,
   'ID of the selected theme');