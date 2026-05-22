// server/core/system/services/aggregatorService.js
//
// Volledig herschreven voor SQLite (better-sqlite3 via database.js shim).
//
// Wijzigingen t.o.v. de MySQL-versie:
//   DATE_FORMAT(ts, '%Y-%m-%d %H:%i:00')  →  strftime('%Y-%m-%d %H:%M:00', ts)
//   DATE_FORMAT(ts, '%Y-%m-%d %H:00:00')  →  strftime('%Y-%m-%d %H:00:00', ts)
//   DATE_FORMAT(date, '%Y-%m')            →  strftime('%Y-%m', date)
//   DATE(timestamp)                        →  date(timestamp)
//   YEAR(date)                             →  CAST(strftime('%Y', date) AS INTEGER)
//   MONTH(date)                            →  CAST(strftime('%m', date) AS INTEGER)
//   HOUR(timestamp)                        →  CAST(strftime('%H', timestamp) AS INTEGER)
//   CURDATE()                              →  date('now')
//   DATE_SUB(CURDATE(), INTERVAL N DAY)   →  date('now', '-N days')
//   CONCAT(a, b)                           →  a || b
//   LPAD(month, 2, '0')                   →  printf('%02d', month)
//   ON DUPLICATE KEY UPDATE col=VALUES()  →  ON CONFLICT(...) DO UPDATE SET col=excluded.col
//   JSON_MERGE_PATCH()                     →  lees → merge in JS → schrijf terug
//   SUBSTRING_INDEX(MAX(CONCAT(...)))     →  subquery met ORDER BY + LIMIT 1

import db from '../../database.js';
import capabilityRegistry from '../../capabilityRegistry.js';
import { padName } from '../../utils/logger.js';
const PREFIX = padName('Aggregator');

class AggregatorService {
  constructor() {
    this.isRunning              = false;
    this.aggregationInterval    = null;
    this.lastComparisonDate     = null;
    this.lastNightlyProfileDate = null;
  }

  _buildSourceMap() {
    const entries = capabilityRegistry.list();
    const find = (type) => entries.find(e => e.type === type)?.moduleId ?? null;
    return {
      solar:   find('solar:read'),
      battery: find('battery:read'),
      grid:    find('grid:read'),
      home:    find('home:read'),
    };
  }

  start() {
    if (this.isRunning) {
      console.log(`   - {${PREFIX}} already running`);
      return;
    }

    console.log(`   - {${PREFIX}} starting...`);
    this.isRunning = true;

    this.aggregate();

    this.aggregationInterval = setInterval(async () => {
      await this.aggregate();
    }, 60000);

    console.log(`   - {${PREFIX}} started (1 minute interval)`);
  }

  stop() {
    if (this.aggregationInterval) {
      clearInterval(this.aggregationInterval);
      this.aggregationInterval = null;
    }
    this.isRunning = false;
    console.log(`   - {${PREFIX}} stopped`);
  }

  async aggregate() {
    try {
      const sourceMap = this._buildSourceMap();

      await this.aggregateMinutes(sourceMap);
      await this.aggregateHours();
      await this.aggregateDaily(sourceMap);
      await this.aggregateMonthly();
      await this.aggregateDevices();

      const today = new Date().toISOString().split('T')[0];
      const hour  = new Date().getHours();

      // Forecast accuracy: eenmaal per dag, na uur 1
      if (this.lastComparisonDate !== today && hour >= 1) {
        await this.compareForecastWithActual();
        this.lastComparisonDate = today;
      }

      // Nachtprofiel: eenmaal per dag, na uur 2
      if (this.lastNightlyProfileDate !== today && hour >= 2) {
        await this.calculateNightlyProfile();
        this.lastNightlyProfileDate = today;
      }

    } catch (error) {
      console.error(`   - {${PREFIX}} error:`, error.message);
    }
  }

  // ── Minuut-aggregatie ───────────────────────────────────────────────────────

  async aggregateMinutes(sourceMap) {
    try {
      // Rolling 2-hour window instead of a cursor.
      // Reason: different source modules may use different clock offsets
      // (UTC vs local time), causing cursor-based MAX(timestamp) to drift
      // ahead and permanently skip rows from other sources.
      // ON CONFLICT(timestamp) DO UPDATE re-writes existing rows safely.
      //
      // CASE WHEN source = ? ensures each domain's values come only from the
      // authoritative module registered in capabilityRegistry.
      const [result] = await db.pool.query(`
        INSERT INTO energy_minutes (
          timestamp,
          battery_soc_avg, battery_soc_min, battery_soc_max,
          battery_power_avg, battery_temperature_avg,
          grid_power_avg, grid_power_min, grid_power_max,
          pv_power_avg, pv_power_max,
          load_power_avg, sample_count
        )
        SELECT
          strftime('%Y-%m-%d %H:%M:00', timestamp) AS minute_timestamp,
          AVG(CASE WHEN source = ? THEN battery_soc   END),
          MIN(CASE WHEN source = ? THEN battery_soc   END),
          MAX(CASE WHEN source = ? THEN battery_soc   END),
          AVG(CASE WHEN source = ? THEN battery_power END),
          AVG(CASE WHEN source = ? THEN battery_temp  END),
          AVG(CASE WHEN source = ? THEN grid_power    END),
          MIN(CASE WHEN source = ? THEN grid_power    END),
          MAX(CASE WHEN source = ? THEN grid_power    END),
          AVG(CASE WHEN source = ? THEN solar_power   END),
          MAX(CASE WHEN source = ? THEN solar_power   END),
          AVG(CASE WHEN source = ? THEN load_power    END),
          COUNT(*)
        FROM energy_snapshots
        WHERE timestamp >= datetime('now', '-2 hours')
          AND timestamp <  strftime('%Y-%m-%d %H:%M:00', datetime('now'))
        GROUP BY minute_timestamp
        ON CONFLICT(timestamp) DO UPDATE SET
          battery_soc_avg         = excluded.battery_soc_avg,
          battery_soc_min         = excluded.battery_soc_min,
          battery_soc_max         = excluded.battery_soc_max,
          battery_power_avg       = excluded.battery_power_avg,
          battery_temperature_avg = excluded.battery_temperature_avg,
          grid_power_avg          = excluded.grid_power_avg,
          grid_power_min          = excluded.grid_power_min,
          grid_power_max          = excluded.grid_power_max,
          pv_power_avg            = excluded.pv_power_avg,
          pv_power_max            = excluded.pv_power_max,
          load_power_avg          = excluded.load_power_avg,
          sample_count            = excluded.sample_count
      `, [
        sourceMap.battery, sourceMap.battery, sourceMap.battery,  // soc avg/min/max
        sourceMap.battery, sourceMap.battery,                      // power avg, temp avg
        sourceMap.grid,    sourceMap.grid,    sourceMap.grid,      // grid avg/min/max
        sourceMap.solar,   sourceMap.solar,                        // pv avg/max
        sourceMap.home,                                            // load avg
      ]);

      if (result.affectedRows > 0)
        console.log(`\x1b[37m   • ${PREFIX} - snapshots → minutes`);
    } catch (error) {
      console.error(`\x1b[91m   • ${PREFIX} - Minute aggregation failed:`, error.message, '\x1b[37m');
    }
  }

  // ── Uur-aggregatie ──────────────────────────────────────────────────────────

  async aggregateHours() {
    try {
      // Rolling 25-hour window to match the minute aggregation approach.
      //
      // Power flow model (AlphaESS: battery_power < 0 = charging):
      //   solar_to_load    = MIN(pv, load)
      //   battery_to_load  = MIN(MAX(load-pv,0), MAX(battery_power,0))
      //   grid_to_load     = MAX(load - pv - battery_discharge, 0)
      //   solar_to_battery = MIN(MAX(pv-load,0), MAX(-battery_power,0))  → stored negative
      //   solar_to_grid    = MAX(MAX(pv-load,0) - MAX(-battery_power,0), 0) → stored negative
      const [result] = await db.pool.query(`
        INSERT INTO energy_hours (
          timestamp,
          battery_soc_avg, battery_power_avg,
          pv_power_avg, grid_power_avg, load_power_avg,
          grid_import_kwh, grid_export_kwh,
          solar_to_load_kwh, battery_to_load_kwh, grid_to_load_kwh, solar_to_grid_kwh
        )
        SELECT
          strftime('%Y-%m-%d %H:00:00', timestamp)        AS hour_timestamp,
          AVG(battery_soc_avg),
          AVG(battery_power_avg),
          AVG(pv_power_avg),
          AVG(grid_power_avg),
          AVG(load_power_avg),

          -- raw grid import/export
          ROUND(MAX(COALESCE(AVG(grid_power_avg),    0), 0) / 1000.0, 3),
          ROUND(MIN(COALESCE(AVG(grid_power_avg),    0), 0) / 1000.0, 3),

          -- solar → home
          ROUND(MIN(
            COALESCE(AVG(pv_power_avg),   0),
            COALESCE(AVG(load_power_avg), 0)
          ) / 1000.0, 3),

          -- battery → home (discharging to cover load beyond solar)
          ROUND(MIN(
            MAX(COALESCE(AVG(load_power_avg), 0) - COALESCE(AVG(pv_power_avg), 0), 0),
            MAX(COALESCE(AVG(battery_power_avg), 0), 0)
          ) / 1000.0, 3),

          -- grid → home (remaining load after solar + battery)
          ROUND(MAX(
            COALESCE(AVG(load_power_avg), 0)
            - COALESCE(AVG(pv_power_avg), 0)
            - MAX(COALESCE(AVG(battery_power_avg), 0), 0),
            0
          ) / 1000.0, 3),

          -- solar → battery (surplus charging battery, stored negative for chart)
          ROUND(-MIN(
            MAX(COALESCE(AVG(pv_power_avg),   0) - COALESCE(AVG(load_power_avg), 0), 0),
            MAX(-COALESCE(AVG(battery_power_avg), 0), 0)
          ) / 1000.0, 3)

        FROM energy_minutes
        WHERE timestamp >= datetime('now', '-25 hours')
          AND timestamp <  strftime('%Y-%m-%d %H:00:00', datetime('now'))
        GROUP BY hour_timestamp
        ON CONFLICT(timestamp) DO UPDATE SET
          battery_soc_avg      = excluded.battery_soc_avg,
          battery_power_avg    = excluded.battery_power_avg,
          pv_power_avg         = excluded.pv_power_avg,
          grid_power_avg       = excluded.grid_power_avg,
          load_power_avg       = excluded.load_power_avg,
          grid_import_kwh      = excluded.grid_import_kwh,
          grid_export_kwh      = excluded.grid_export_kwh,
          solar_to_load_kwh    = excluded.solar_to_load_kwh,
          battery_to_load_kwh  = excluded.battery_to_load_kwh,
          grid_to_load_kwh     = excluded.grid_to_load_kwh,
          solar_to_grid_kwh    = excluded.solar_to_grid_kwh
      `, []);

      if (result.affectedRows > 0)
        console.log(`\x1b[37m   • ${PREFIX} - minutes → hours`);
    } catch (error) {
      console.error(`\x1b[91m   • ${PREFIX} - Hour aggregation failed:`, error.message, '\x1b[37m');
    }
  }

  // ── Dag-aggregatie ──────────────────────────────────────────────────────────

  async aggregateDaily(sourceMap) {
    try {
      // Rolling 2-day window: today and yesterday, re-aggregated on every cycle.
      // Covers midnight rollover and ensures today's running totals stay current.
      const [result] = await db.pool.query(`
        INSERT INTO energy_daily (
          date,
          pv_generation_kwh, load_consumption_kwh,
          grid_import_kwh,   grid_export_kwh,
          battery_charge_kwh, battery_discharge_kwh
        )
        SELECT
          date(timestamp)                  AS day,
          MAX(CASE WHEN source = ? THEN solar_energy_today         END),
          MAX(CASE WHEN source = ? THEN load_energy_today          END),
          MAX(CASE WHEN source = ? THEN grid_energy_import_today   END),
          MAX(CASE WHEN source = ? THEN grid_energy_export_today   END),
          MAX(CASE WHEN source = ? THEN battery_charge_today       END),
          MAX(CASE WHEN source = ? THEN battery_discharge_today    END)
        FROM energy_snapshots
        WHERE date(timestamp) >= date('now', '-1 days')
        GROUP BY day
        ON CONFLICT(date) DO UPDATE SET
          pv_generation_kwh     = excluded.pv_generation_kwh,
          load_consumption_kwh  = excluded.load_consumption_kwh,
          grid_import_kwh       = excluded.grid_import_kwh,
          grid_export_kwh       = excluded.grid_export_kwh,
          battery_charge_kwh    = excluded.battery_charge_kwh,
          battery_discharge_kwh = excluded.battery_discharge_kwh
      `, [
        sourceMap.solar,
        sourceMap.home,
        sourceMap.grid,
        sourceMap.grid,
        sourceMap.battery,
        sourceMap.battery,
      ]);

      if (result.affectedRows > 0)
        console.log(`\x1b[37m   • ${PREFIX} - snapshots → daily`);
    } catch (error) {
      console.error(`\x1b[91m   • ${PREFIX} - Daily aggregation failed:`, error.message, '\x1b[37m');
    }
  }

  // ── Maand-aggregatie ────────────────────────────────────────────────────────
  //
  // MySQL gebruikte YEAR(), MONTH() en LPAD() — allemaal vervangen door
  // SQLite strftime() en printf(). De uniekheidscheck gebruikt year||month
  // in plaats van CONCAT met LPAD.

  async aggregateMonthly() {
    try {
      const [lastAgg] = await db.pool.query(
        `SELECT MAX(year || '-' || printf('%02d', month)) AS last_month
         FROM energy_monthly`
      );
      const lastMonth = lastAgg[0]?.last_month || '1970-01';

      const [result] = await db.pool.query(`
        INSERT INTO energy_monthly (
          year, month,
          pv_generation_kwh, load_consumption_kwh,
          grid_import_kwh,   grid_export_kwh,
          battery_charge_kwh, battery_discharge_kwh
        )
        SELECT
          CAST(strftime('%Y', date) AS INTEGER) AS year,
          CAST(strftime('%m', date) AS INTEGER) AS month,
          SUM(pv_generation_kwh),
          SUM(load_consumption_kwh),
          SUM(grid_import_kwh),
          SUM(grid_export_kwh),
          SUM(battery_charge_kwh),
          SUM(battery_discharge_kwh)
        FROM energy_daily
        WHERE strftime('%Y-%m', date) > ?
        GROUP BY year, month
        ON CONFLICT(year, month) DO UPDATE SET
          pv_generation_kwh     = excluded.pv_generation_kwh,
          load_consumption_kwh  = excluded.load_consumption_kwh,
          grid_import_kwh       = excluded.grid_import_kwh,
          grid_export_kwh       = excluded.grid_export_kwh,
          battery_charge_kwh    = excluded.battery_charge_kwh,
          battery_discharge_kwh = excluded.battery_discharge_kwh
      `, [lastMonth]);

      if (result.affectedRows > 0)
        console.log(`\x1b[37m   • ${PREFIX} - daily → monthly`);
    } catch (error) {
      console.error(`\x1b[91m   • ${PREFIX} - Monthly aggregation failed:`, error.message, '\x1b[37m');
    }
  }

  // ── Device-aggregatie + 7-daagse purge ─────────────────────────────────────
  //
  // MySQL-versie gebruikte SUBSTRING_INDEX(MAX(CONCAT(timestamp,'|',energy_total)))
  // om de laatste waarde per apparaat op te halen — een MySQL-specifieke truc
  // die niet werkt in SQLite.
  //
  // SQLite-aanpak: subquery met ORDER BY timestamp DESC LIMIT 1.
  //
  // Uitgebreid met avg_power, max_power, avg_voltage en sample_count
  // zoals afgesproken (device_daily_usage tabel wordt uitgebreid via migratie).
  // De 7-daagse purge van ruwe metingen wordt na de aggregatie uitgevoerd.

  async aggregateDevices() {
    try {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const dateStr = yesterday.toISOString().split('T')[0];

      // 1. Aggregeer gisteren naar device_daily_usage
      //    usage_kwh = MAX(energy_today) — reset elke dag om middernacht en
      //    loopt op gedurende de dag, dus MAX is de dagopbrengst.
      //    Voor apparaten die energy_today niet ondersteunen (null):
      //    val back op MAX(energy_total) - MIN(energy_total).
      const [insertResult] = await db.pool.query(`
        INSERT INTO device_daily_usage (
          device_id, date, usage_kwh,
          avg_power, max_power, avg_voltage,
          sample_count, source, last_update
        )
        SELECT
          device_id,
          date(timestamp)                        AS date,
          CASE
            WHEN MAX(energy_today) IS NOT NULL
              THEN MAX(energy_today)
            ELSE MAX(energy_total) - MIN(energy_total)
          END                                    AS usage_kwh,
          AVG(power)                             AS avg_power,
          MAX(power)                             AS max_power,
          AVG(voltage)                           AS avg_voltage,
          COUNT(*)                               AS sample_count,
          source,
          datetime('now')                        AS last_update
        FROM device_measurements
        WHERE date(timestamp) = ?
        GROUP BY device_id, date(timestamp), source
        ON CONFLICT(device_id, date) DO UPDATE SET
          usage_kwh    = excluded.usage_kwh,
          avg_power    = excluded.avg_power,
          max_power    = excluded.max_power,
          avg_voltage  = excluded.avg_voltage,
          sample_count = excluded.sample_count,
          last_update  = excluded.last_update
      `, [dateStr]);

      // 2. Purge ruwe metingen ouder dan 7 dagen
      const [purgeResult] = await db.pool.query(
        `DELETE FROM device_measurements
         WHERE timestamp < datetime('now', '-7 days')`
      );

      if (insertResult.affectedRows > 0 || purgeResult.affectedRows > 0)
        console.log(
          `\x1b[37m   • ${PREFIX} - devices: aggregated ${dateStr}` +
          `, purged ${purgeResult.affectedRows} rows >7d`
        );
    } catch (error) {
      console.error(`\x1b[91m   • ${PREFIX} - Device aggregation failed:`, error.message, '\x1b[37m');
    }
  }

  // ── Forecast accuracy ───────────────────────────────────────────────────────
  //
  // Geen MySQL-specifieke syntax — werkt ongewijzigd met de SQLite shim.

  async compareForecastWithActual() {
    const modulePrefix = padName('Solar Forecast');
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const dateStr = yesterday.toISOString().split('T')[0];

    try {
      const [daily] = await db.pool.query(
        'SELECT pv_generation_kwh FROM energy_daily WHERE date = ?',
        [dateStr]
      );

      if (!daily[0]) {
        console.log(`\x1b[37m   • ${modulePrefix} - No energy_daily row for ${dateStr}, skipping`);
        return;
      }

      const actualKwh = parseFloat(daily[0].pv_generation_kwh) || 0;

      const [forecast] = await db.pool.query(
        'SELECT expected_kwh FROM solar_forecasts WHERE date = ?',
        [dateStr]
      );

      if (!forecast[0]) {
        console.log(`\x1b[37m   • ${modulePrefix} - No forecast row for ${dateStr}, skipping`);
        return;
      }

      const expectedKwh   = parseFloat(forecast[0].expected_kwh) || 0;
      const accuracyPct   = expectedKwh > 0
        ? Math.round((actualKwh / expectedKwh) * 100 * 10) / 10
        : 0;

      await db.pool.query(
        `UPDATE solar_forecasts
            SET actual_kwh          = ?,
                accuracy_percentage = ?
          WHERE date = ?`,
        [actualKwh, accuracyPct, dateStr]
      );

      console.log(
        `\x1b[37m   • ${modulePrefix} - Accuracy ${dateStr}: ${actualKwh} kWh actual / ${expectedKwh} kWh forecast = ${accuracyPct}%`
      );

    } catch (error) {
      console.error(`\x1b[91m   • ${modulePrefix} - comparison failed:`, error.message, '\x1b[37m');
    }
  }

  // ── Nachtprofiel ────────────────────────────────────────────────────────────
  //
  // Wijzigingen t.o.v. MySQL-versie:
  //   HOUR(timestamp)                      →  CAST(strftime('%H', timestamp) AS INTEGER)
  //   DATE_SUB(CURDATE(), INTERVAL 14 DAY) →  date('now', '-14 days')
  //   CURDATE()                            →  date('now')
  //   JSON_MERGE_PATCH()                   →  lees huidige config → merge in JS → schrijf terug
  //   ON DUPLICATE KEY UPDATE              →  ON CONFLICT(strategy_id) DO UPDATE SET

  async calculateNightlyProfile() {
    const modulePrefix = padName('Nightly Profile');
    console.log(`\x1b[37m   • ${modulePrefix} - Calculating morning energy profile...`);

    try {
      // 1. Gemiddeld uurlijks verbruiksprofiel over de laatste 14 dagen
      const [hourlyRows] = await db.pool.query(`
        SELECT
          CAST(strftime('%H', timestamp) AS INTEGER) AS hour_of_day,
          AVG(load_power_avg)                        AS avg_load_w,
          COUNT(*)                                   AS sample_count
        FROM energy_hours
        WHERE timestamp >= date('now', '-14 days')
          AND timestamp <  date('now')
          AND load_power_avg IS NOT NULL
          AND load_power_avg > 0
        GROUP BY hour_of_day
        ORDER BY hour_of_day
      `);

      const hourlyLoadProfile = Array(24).fill(0);
      for (const row of hourlyRows) {
        hourlyLoadProfile[row.hour_of_day] = Math.round(row.avg_load_w);
      }

      // 2. Gemiddeld dagverbruik (14 dagen)
      const [dailyRows] = await db.pool.query(`
        SELECT AVG(load_consumption_kwh) AS avg_load_kwh
        FROM energy_daily
        WHERE date >= date('now', '-14 days')
          AND date <  date('now')
          AND load_consumption_kwh > 0
      `);
      const dailyAvgLoadKwh = parseFloat(dailyRows[0]?.avg_load_kwh) || 5.0;

      // 3. Zonneprognose voor morgen
      const tomorrow    = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const tomorrowStr = tomorrow.toISOString().split('T')[0];

      const [forecastRows] = await db.pool.query(`
        SELECT CAST(strftime('%H', slot_datetime) AS INTEGER) AS hour_of_day,
               hourly_wh
        FROM solar_forecast_hourly
        WHERE date = ?
        ORDER BY hour_of_day
      `, [tomorrowStr]);

      const SOLAR_START_THRESHOLD_WH = 200;
      let solarStartHour = 9;
      let solarTotalKwh  = 0;

      for (const row of forecastRows) {
        solarTotalKwh += (row.hourly_wh / 1000);
        if (row.hourly_wh >= SOLAR_START_THRESHOLD_WH && row.hour_of_day < solarStartHour) {
          solarStartHour = row.hour_of_day;
        }
      }

      // Fallback naar vandaag als morgen nog geen prognose heeft
      if (forecastRows.length === 0) {
        const todayStr = new Date().toISOString().split('T')[0];
        const [todayForecast] = await db.pool.query(
          'SELECT expected_kwh FROM solar_forecasts WHERE date = ?',
          [todayStr]
        );
        solarTotalKwh = parseFloat(todayForecast[0]?.expected_kwh) || 0;
      }

      // 4. Ochtend-kWh (middernacht → solar_start_hour)
      let morningKwhNeeded = 0;
      for (let h = 0; h < solarStartHour; h++) {
        morningKwhNeeded += hourlyLoadProfile[h] / 1000;
      }
      morningKwhNeeded = Math.round(morningKwhNeeded * 100) / 100;

      // 5. Prognose-nauwkeurigheidsfactor (laatste 14 dagen)
      const [accuracyRows] = await db.pool.query(`
        SELECT AVG(accuracy_percentage) AS avg_accuracy
        FROM solar_forecasts
        WHERE date >= date('now', '-14 days')
          AND date <  date('now')
          AND actual_kwh  IS NOT NULL
          AND actual_kwh   > 0
          AND expected_kwh > 0
      `);
      const rawAccuracy          = parseFloat(accuracyRows[0]?.avg_accuracy);
      const forecastAccuracyFactor = isNaN(rawAccuracy)
        ? 0.7
        : Math.min(1.0, rawAccuracy / 100);

      // 6. Profiel opbouwen
      const profile = {
        calculatedAt:            new Date().toISOString(),
        dailyAvgLoadKwh:         Math.round(dailyAvgLoadKwh * 100) / 100,
        morningKwhNeeded,
        solarStartHour,
        solarTotalKwh:           Math.round(solarTotalKwh * 100) / 100,
        forecastAccuracyFactor:  Math.round(forecastAccuracyFactor * 1000) / 1000,
        hourlyLoadProfile,
      };

      // 7. Profiel opslaan in strategy_config
      //
      // MySQL had JSON_MERGE_PATCH() — niet beschikbaar in SQLite.
      // Oplossing: lees de huidige config, merge in JavaScript, schrijf terug.
      // Dit garandeert dat andere sleutels in de config bewaard blijven.

      const [existing] = await db.pool.query(
        'SELECT config FROM strategy_config WHERE strategy_id = ?',
        ['smart-eco']
      );

      const currentConfig = existing[0]?.config
        ? JSON.parse(existing[0].config)
        : {};

      const mergedConfig = { ...currentConfig, nightlyProfile: profile };

      await db.pool.query(`
        INSERT INTO strategy_config (strategy_id, config)
        VALUES (?, ?)
        ON CONFLICT(strategy_id) DO UPDATE SET
          config = excluded.config
      `, ['smart-eco', JSON.stringify(mergedConfig)]);

      console.log(
        `\x1b[37m   • ${modulePrefix} - Done: morning=${morningKwhNeeded} kWh, ` +
        `solarStart=h${solarStartHour}, solarForecast=${solarTotalKwh} kWh, ` +
        `accuracy=${Math.round(forecastAccuracyFactor * 100)}%`
      );

    } catch (error) {
      console.error(`\x1b[91m   • ${modulePrefix} - Failed:`, error.message, '\x1b[37m');
    }
  }
}

export default new AggregatorService();