// core/capabilitySchemas.js
//
// Canonical output shapes for all capability types.
//
// Every module handler MUST return an object that conforms to the schema
// for its capability type. The dispatch() function in capability.js merges
// handler output onto the schema so that:
//   - Missing fields are always present as null (never undefined)
//   - Consumers can rely on a stable shape regardless of which module provides it
//
// Conventions:
//   power       W   positive = import/charging/consuming, negative = export/discharging/producing
//   energy_*    kWh
//   voltage_*   V
//   current_*   A
//   temp        °C
//   frequency   Hz
//   soc         %   0–100

const schemas = {

  // ── Grid ───────────────────────────────────────────────────────────────────
  // power = netto totaal alle fases. + = import from grid, - = export to grid.
  // power_l1/l2/l3 = per-fase vermogen (optioneel, null als niet beschikbaar)
  'grid:read': {
    power:        null,   // W  netto totaal (som L1+L2+L3), + = import, - = export
    power_l1:     null,   // W  fase 1
    power_l2:     null,   // W  fase 2
    power_l3:     null,   // W  fase 3
    voltage_l1:   null,   // V
    voltage_l2:   null,   // V
    voltage_l3:   null,   // V
    current_l1:   null,   // A
    current_l2:   null,   // A
    current_l3:   null,   // A
    frequency:    null,   // Hz
    import_today: null,   // kWh  vandaag afgenomen van net
    export_today: null,   // kWh  vandaag teruggeleverd aan net
  },

  // ── Battery ────────────────────────────────────────────────────────────────
  // power: + = charging (battery receives power), - = discharging (battery delivers power)
  'battery:read': {
    soc:             null,  // %
    power:           null,  // W  + = charging, - = discharging
    voltage:         null,  // V
    current:         null,  // A
    temp:            null,  // °C
    charge_today:    null,  // kWh  vandaag opgeladen
    discharge_today: null,  // kWh  vandaag ontladen
  },

  // ── Solar ──────────────────────────────────────────────────────────────────
  // power is always positive (production). Negative values are clamped to 0.
  'solar:read': {
    power:        null,   // W   AC output totaal
    power_dc:     null,   // W   DC input (indien beschikbaar)
    energy_today: null,   // kWh vandaag geproduceerd
    energy_total: null,   // kWh lifetime cumulatief
    voltage:      null,   // V   AC uitgangsspanning
    frequency:    null,   // Hz
    temperature:  null,   // °C  heatsink temperatuur
  },

  // ── Home ───────────────────────────────────────────────────────────────────
  'home:read': {
    power:        null,   // W   huidig verbruik
    energy_today: null,   // kWh vandaag verbruikt
  },

  // ── Battery status (dispatch state) ───────────────────────────────────────
  'battery:status': {
    active:           false,
    charging:         false,
    discharging:      false,
    watts:            null,
    remainingSeconds: null,
  },

  // ── Solar forecast ─────────────────────────────────────────────────────────
  // Defined by the solar-forecast module — schema here for reference only.
  // Handler returns a richer structure; dispatch does not merge/clip forecasts.
  'solar:forecast': null,   // passthrough — no normalization

  // ── Grid pricing ───────────────────────────────────────────────────────────
  'grid:pricing': null,     // passthrough — no normalization
  'battery:charge-from-grid': { success: null, command: null },
  'battery:discharge-to-grid': { success: null, command: null },
  'battery:stop': { success: null, mode: null },
  'battery:set-charge-limit': { success: null, chargeLimitPct: null },
  'grid:status': { gridConnected: null, mode: null },
  'solar:curtail': null,  // passthrough

  // ── Solar curtailment state ───────────────────────────────────────────────
  // Mirrors battery:status — in-memory, no hardware I/O on read.
  //
  // targetPct   is what Wolffie asked the inverter for.
  // verifiedPct is what the inverter confirmed on read-back.
  // When those disagree, or failedWrites > 0, `degraded` is true and the UI
  // must say so rather than showing a calm "curtailing" state over a write
  // path that is not actually working.
  'solar:curtail-status': {
    active:                false,
    targetWatts:           null,   // W   requested cap
    targetPct:             null,   // %   that cap as % of baseLimitW
    verifiedPct:           null,   // %   read back from the inverter
    remainingSeconds:      null,   // s   null = no expiry set
    expiresAt:             null,   // ISO
    requestedAt:           null,   // ISO
    source:                null,   // 'manual' | 'strategy:smart-eco' | ...
    lastAppliedAt:         null,   // ISO  last successful write + read-back
    lastError:             null,
    failedWrites:          0,
    baseLimitW:            null,   // W   inverter's active power limit base
    commandTimeoutS:       null,   // s   inverter watchdog timeout
    fallbackPct:           null,   // %   what it reverts to on timeout
    dynamicControlEnabled: null,   // bool
    degraded:              false,
  },
  'smartdevice:read':   null,   // passthrough — define shape later
  'smartdevice:status': null,
  'smartdevice:write':  null,
  'smartdevice:p1':     null,
};

/**
 * Normalize a handler result against the canonical schema for a capability type.
 *
 * - If no schema is defined (null) the raw result passes through unchanged.
 * - If a schema is defined, the result is merged onto a fresh copy of the schema.
 *   This guarantees all keys are present (as null if the handler omitted them).
 *
 * @param {string} type    Capability type, e.g. 'grid:read'
 * @param {*}      result  Raw handler return value
 * @returns {*}            Normalized result
 */
export function normalize(type, result) {
  const schema = schemas[type];

  // No schema defined → passthrough
  if (schema === undefined || schema === null) return result;

  // Null/undefined handler result → return empty schema
  if (result == null) return { ...schema };

  // Merge handler result onto a fresh copy of the schema
  return { ...schema, ...result };
}

export default schemas;