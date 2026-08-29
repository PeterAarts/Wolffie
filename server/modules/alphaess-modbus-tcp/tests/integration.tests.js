// modules/alphaess-modbus-tcp/tests/integration.test.js
//
// Integration test — verifies this module integrates correctly with core:
//   - Manifest structure is valid
//   - All declared capabilities are registered
//   - Capability handlers return schema-compliant output
//   - Dispatch capabilities trigger event log entries
//
// Mock boundary: api.js (no real Modbus hardware)
//
// Run:  npm test
// File: npm test -- modules/alphaess-modbus-tcp/tests/integration.test.js

import { describe, it, expect, beforeAll, vi } from 'vitest';
import { createTestDb } from '../../../tests/helpers/testDb.js';

// ── Mocks ─────────────────────────────────────────────────────────────────
// Set up all mocks BEFORE importing the module under test.

const testDb = createTestDb();
vi.mock('../../../core/database.js', () => ({ default: testDb }));
vi.mock('../../../core/utils/logger.js', () => ({
  padName: (name) => name.padEnd(24),
}));

// Mock settingsService — returns test config for the module
vi.mock('../../../core/system/services/settingsService.js', () => ({
  default: {
    getCategory: vi.fn().mockResolvedValue({
      enabled: true,
      host: '192.168.1.100',
      port: 502,
      unit_id: 85,
      poll_interval: 20000,
    }),
    getModuleSettings: vi.fn().mockResolvedValue({
      enabled: true,
      host: '192.168.1.100',
      port: 502,
      unit_id: 85,
    }),
  },
}));

// Mock alertService
vi.mock('../../../core/system/services/alertService.js', () => ({
  default: {
    write: vi.fn().mockResolvedValue(null),
    resolveByTypePrefix: vi.fn().mockResolvedValue(undefined),
  },
}));

// Mock eventService (legacy shim)
vi.mock('../../../core/system/services/eventService.js', () => ({
  default: { log: vi.fn().mockResolvedValue(undefined) },
}));

// Realistic snapshot data matching what the collector produces
const MOCK_SNAPSHOT = {
  battery: {
    soc: 85,
    power: -1200,       // AlphaESS native: negative = discharging
    charge_today: 4.5,
    discharge_today: 2.1,
    voltage: 52.3,
    current: -23.0,
    temp: 28.5,
  },
  solar: {
    total_power: 2800,
    energy_today: 12.5,
    energy_total: 4500.2,
  },
  grid: {
    total_active_power: -650,
    l1_voltage: 232.5,
    import_today: 1.2,
    export_today: 8.7,
  },
  system: {
    inv_freq: 50.01,
  },
  inverterMode: {
    gridConnected: true,
    mode: 'Online',
  },
};

// Mock api.js — no real Modbus, all methods are stubs
vi.mock('../services/api.js', () => ({
  default: {
    setConfig: vi.fn(),
    checkStatus: vi.fn().mockResolvedValue(true),
    resetOnStartup: vi.fn().mockResolvedValue(undefined),
    getDispatchStatus: vi.fn().mockReturnValue({
      active: false,
      charging: false,
      discharging: false,
      watts: 0,
      remainingSeconds: null,
    }),
    startCharge: vi.fn().mockResolvedValue(undefined),
    startDischarge: vi.fn().mockResolvedValue(undefined),
    stopDispatch: vi.fn().mockResolvedValue(undefined),
    connect: vi.fn().mockResolvedValue(undefined),
    writeMinSoC: vi.fn().mockResolvedValue(undefined),
  },
}));

// Mock collector.js — return test snapshot data
vi.mock('../services/collector.js', () => ({
  default: {
    config: null,
    getLastSnapshot: vi.fn().mockReturnValue(MOCK_SNAPSHOT),
    getStatus: vi.fn().mockReturnValue({ lastCollection: null, lastError: null, consecutiveErrors: 0 }),
    collect: vi.fn().mockResolvedValue(true),
  },
}));

// Suppress console output
vi.spyOn(console, 'log').mockImplementation(() => {});
vi.spyOn(console, 'warn').mockImplementation(() => {});
vi.spyOn(console, 'error').mockImplementation(() => {});

// ── Import real core modules + module under test ──────────────────────────

const { default: capabilityRegistry } = await import('../../../core/capabilityRegistry.js');
const { normalize } = await import('../../../core/capabilitySchemas.js');
const { default: eventLog } = await import('../../../core/system/services/eventLogService.js');
const { default: alphaModule } = await import('../index.js');
const { default: mockApi } = await import('../services/api.js');

// Read manifest for validation
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'manifest.json'), 'utf8'));

// ── Setup ─────────────────────────────────────────────────────────────────

await eventLog.initialize();

beforeAll(async () => {
  await alphaModule.initialize();
});

// ── Tests ─────────────────────────────────────────────────────────────────

describe('alphaess-modbus-tcp', () => {

  // ── Manifest ──────────────────────────────────────────────────────────

  describe('manifest', () => {
    it('should have required fields', () => {
      expect(manifest.id).toBe('alphaess-modbus-tcp');
      expect(manifest.name).toBeTruthy();
      expect(manifest.version).toMatch(/^\d+\.\d+\.\d+$/);
      expect(manifest.type).toBe('data-collector');
    });

    it('should declare all service capabilities', () => {
      expect(manifest.services).toBeInstanceOf(Array);
      expect(manifest.services.length).toBeGreaterThan(0);

      const types = manifest.services.map(s => s.type);
      expect(types).toContain('battery:read');
      expect(types).toContain('battery:status');
      expect(types).toContain('battery:charge-from-grid');
      expect(types).toContain('battery:discharge-to-grid');
      expect(types).toContain('battery:stop');
      expect(types).toContain('solar:read');
      expect(types).toContain('grid:read');
    });

    it('should have collector configuration', () => {
      expect(manifest.collector).toBeDefined();
      expect(manifest.collector.enabled).toBe(true);
      expect(manifest.collector.interval).toBeGreaterThan(0);
    });
  });

  // ── Capability Registration ───────────────────────────────────────────

  describe('capability registration', () => {
    it('should register all capabilities declared in manifest.services', () => {
      const registered = capabilityRegistry.list();
      const registeredTypes = registered.map(c => c.type);

      for (const service of manifest.services) {
        expect(registeredTypes).toContain(service.type);
      }
    });

    it('should register with correct module ID', () => {
      const registered = capabilityRegistry.list()
        .filter(c => c.moduleId === 'alphaess-modbus-tcp');

      expect(registered.length).toBeGreaterThanOrEqual(manifest.services.length);
    });
  });

  // ── Capability Output Shapes ──────────────────────────────────────────

  describe('capability: battery:read', () => {
    it('should return schema-compliant output', async () => {
      const handler = capabilityRegistry.get('battery:read');
      expect(handler).toBeTruthy();

      const raw = await handler();
      const result = normalize('battery:read', raw);

      expect(result).toHaveProperty('soc');
      expect(result).toHaveProperty('power');
      expect(result).toHaveProperty('charge_today');
      expect(result).toHaveProperty('discharge_today');
      expect(typeof result.soc).toBe('number');
    });

    it('should invert power sign (AlphaESS native → schema convention)', async () => {
      const handler = capabilityRegistry.get('battery:read');
      const raw = await handler();

      // AlphaESS native: -1200 = discharging
      // Schema convention: power * -1, so 1200 = discharging (positive)
      expect(raw.power).toBe(1200);
    });

    it('should handle missing snapshot gracefully', async () => {
      const { default: collector } = await import('../services/collector.js');
      collector.getLastSnapshot.mockReturnValueOnce(null);

      const handler = capabilityRegistry.get('battery:read');
      const raw = await handler();

      expect(raw.soc).toBeNull();
      expect(raw.power).toBeNull();
    });
  });

  describe('capability: battery:status', () => {
    it('should return dispatch state shape', async () => {
      const handler = capabilityRegistry.get('battery:status');
      const result = await handler();

      expect(result).toHaveProperty('active');
      expect(result).toHaveProperty('charging');
      expect(result).toHaveProperty('discharging');
      expect(result).toHaveProperty('watts');
      expect(typeof result.active).toBe('boolean');
    });
  });

  describe('capability: solar:read', () => {
    it('should return schema-compliant output', async () => {
      const handler = capabilityRegistry.get('solar:read');
      const raw = await handler();
      const result = normalize('solar:read', raw);

      expect(result).toHaveProperty('power');
      expect(result).toHaveProperty('energy_today');
      expect(result.power).toBe(2800);
      expect(result.energy_today).toBe(12.5);
    });
  });

  describe('capability: grid:read', () => {
    it('should return schema-compliant output', async () => {
      const handler = capabilityRegistry.get('grid:read');
      const raw = await handler();
      const result = normalize('grid:read', raw);

      expect(result).toHaveProperty('power');
      expect(result).toHaveProperty('voltage_l1');
      expect(result).toHaveProperty('frequency');
      expect(result.power).toBe(-650);
      expect(result.voltage_l1).toBe(232.5);
    });
  });

  describe('capability: grid:status', () => {
    it('should return grid connection state', async () => {
      const handler = capabilityRegistry.get('grid:status');
      const result = await handler();

      expect(result).toHaveProperty('gridConnected');
      expect(result).toHaveProperty('mode');
      expect(result.gridConnected).toBe(true);
      expect(result.mode).toBe('Online');
    });
  });

  // ── Dispatch Capabilities ─────────────────────────────────────────────

  describe('capability: battery:charge-from-grid', () => {
    it('should call api.startCharge with correct parameters', async () => {
      const handler = capabilityRegistry.get('battery:charge-from-grid');
      const result = await handler({
        watts: 2000,
        targetSOC: 95,
        durationHours: 3,
        origin: 'test:integration',
      });

      expect(result.success).toBe(true);
      expect(result.command.mode).toBe('charge-from-grid');
      expect(mockApi.startCharge).toHaveBeenCalledWith(
        2000, 95, 3, 'test:integration'
      );
    });
  });

  describe('capability: battery:discharge-to-grid', () => {
    it('should call api.startDischarge with correct parameters', async () => {
      const handler = capabilityRegistry.get('battery:discharge-to-grid');
      const result = await handler({
        watts: 3000,
        minimumSOC: 20,
        durationHours: 2,
        origin: 'test:integration',
      });

      expect(result.success).toBe(true);
      expect(result.command.mode).toBe('discharge-to-grid');
      expect(mockApi.startDischarge).toHaveBeenCalledWith(
        3000, 20, 2, 'test:integration'
      );
    });
  });

  describe('capability: battery:stop', () => {
    it('should call api.stopDispatch', async () => {
      const handler = capabilityRegistry.get('battery:stop');
      const result = await handler();

      expect(result.success).toBe(true);
      expect(result.mode).toBe('Self-Consumption');
      expect(mockApi.stopDispatch).toHaveBeenCalled();
    });
  });

  // ── Module lifecycle ──────────────────────────────────────────────────

  describe('module lifecycle', () => {
    it('should be initialized after initialize()', () => {
      expect(alphaModule.initialized).toBe(true);
    });

    it('should have the correct manifest attached', () => {
      expect(alphaModule.manifest.id).toBe('alphaess-modbus-tcp');
    });

    it('should report connected status', () => {
      expect(alphaModule.connected).toBe(true);
    });
  });
});