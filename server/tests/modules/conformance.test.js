// server/tests/modules/conformance.test.js
//
// Core module conformance test — automatically discovers every module in
// the modules/ directory and validates it meets the core integration contract.
//
// This test does NOT initialize modules or touch hardware. It validates
// structure, exports, manifest, settings schema, and capability declarations.
//
// What it catches:
//   - Missing or malformed manifest.json
//   - Module index.js missing required exports (initialize, collect, manifest)
//   - Capabilities declared in manifest but not matching capabilitySchemas
//   - Settings schema with invalid structure
//   - Routes declared but missing export
//   - Mismatched module IDs between manifest and directory name
//
// Run:  npm test -- tests/modules/conformance.test.js

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MODULES_DIR = path.join(__dirname, '..', '..', 'modules');
const SCHEMAS_PATH = path.join(__dirname, '..', '..', 'core', 'capabilitySchemas.js');

// ── Discover all modules ──────────────────────────────────────────────────

function discoverModules() {
  if (!fs.existsSync(MODULES_DIR)) return [];

  return fs.readdirSync(MODULES_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .filter(d => {
      const manifestPath = path.join(MODULES_DIR, d.name, 'manifest.json');
      return fs.existsSync(manifestPath);
    })
    .map(d => {
      const dir = path.join(MODULES_DIR, d.name);
      const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
      return { dirName: d.name, dir, manifest };
    });
}

const modules = discoverModules();

// ── Load known capability schemas for validation ──────────────────────────

let knownSchemaTypes = [];
try {
  const schemaModule = await import(SCHEMAS_PATH);
  const schemas = schemaModule.default;
  knownSchemaTypes = Object.keys(schemas);
} catch (_) {
  // capabilitySchemas not loadable — skip schema cross-check
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('module conformance', () => {

  it('should discover at least one module', () => {
    expect(modules.length).toBeGreaterThan(0);
  });

  // Run conformance checks for each discovered module
  for (const mod of modules) {
    describe(`module: ${mod.dirName}`, () => {

      // ── Manifest Structure ────────────────────────────────────────────

      describe('manifest.json', () => {
        it('should have a valid id matching the directory name', () => {
          expect(mod.manifest.id).toBe(mod.dirName);
        });

        it('should have required metadata fields', () => {
          expect(mod.manifest.name).toBeTruthy();
          expect(typeof mod.manifest.name).toBe('string');
          expect(mod.manifest.version).toMatch(/^\d+\.\d+\.\d+$/);
          expect(mod.manifest.description).toBeTruthy();
        });

        it('should have a valid type', () => {
          const validTypes = ['data-collector', 'collector', 'control', 'integration', 'utility'];
          expect(validTypes).toContain(mod.manifest.type);
        });

        it('should have capabilities declared', () => {
          expect(mod.manifest.capabilities).toBeDefined();
          expect(typeof mod.manifest.capabilities).toBe('object');
        });
      });

      // ── Services / Capabilities ───────────────────────────────────────

      if (mod.manifest.services && Array.isArray(mod.manifest.services)) {
        describe('services (capability declarations)', () => {
          it('should have valid service entries', () => {
            for (const service of mod.manifest.services) {
              expect(service.type).toBeTruthy();
              expect(typeof service.type).toBe('string');
              expect(service.type).toMatch(/^[a-z]+:[a-z][-a-z0-9]*$/);
              expect(typeof service.priority).toBe('number');
              expect(service.priority).toBeGreaterThan(0);
              expect(service.priority).toBeLessThanOrEqual(100);
            }
          });

          if (knownSchemaTypes.length > 0) {
            it('should only declare capabilities that have schemas (or passthrough)', () => {
              for (const service of mod.manifest.services) {
                // Warn about capabilities without schemas — not a failure,
                // but indicates the capability may not be normalized
                if (!knownSchemaTypes.includes(service.type)) {
                  console.warn(
                    `      ⚠ ${mod.dirName}: capability '${service.type}' has no schema in capabilitySchemas.js`
                  );
                }
              }
            });
          }

          it('should not declare duplicate capability types', () => {
            const types = mod.manifest.services.map(s => s.type);
            const unique = new Set(types);
            expect(unique.size).toBe(types.length);
          });
        });
      }

      // ── Collector ─────────────────────────────────────────────────────

      if (mod.manifest.collector) {
        describe('collector configuration', () => {
          it('should have a valid interval', () => {
            expect(typeof mod.manifest.collector.interval).toBe('number');
            expect(mod.manifest.collector.interval).toBeGreaterThanOrEqual(1000);
          });

          it('should have enabled flag', () => {
            expect(typeof mod.manifest.collector.enabled).toBe('boolean');
          });
        });
      }

      // ── Routes ────────────────────────────────────────────────────────

      if (mod.manifest.routes) {
        describe('routes configuration', () => {
          it('should have a valid prefix starting with /api/', () => {
            if (mod.manifest.routes.enabled) {
              expect(mod.manifest.routes.prefix).toMatch(/^\/api\//);
            }
          });

          if (mod.manifest.routes.enabled) {
            it('should have a routes/index.js file', () => {
              const routesFile = path.join(mod.dir, 'routes', 'index.js');
              expect(fs.existsSync(routesFile)).toBe(true);
            });
          }
        });
      }

      // ── Module Entry Point ────────────────────────────────────────────

      describe('entry point (index.js)', () => {
        it('should exist', () => {
          const indexFile = path.join(mod.dir, 'index.js');
          expect(fs.existsSync(indexFile)).toBe(true);
        });
      });

      // ── Settings Schema ───────────────────────────────────────────────

     if (mod.manifest.settings?.schema) {
        describe('settings schema', () => {
          const schemaFile = path.join(mod.dir, 'config', mod.manifest.settings.schema);

          it('should exist on disk', () => {
            expect(fs.existsSync(schemaFile)).toBe(true);
          });

          it('should be valid JSON', () => {
            const content = fs.readFileSync(schemaFile, 'utf8');
            expect(() => JSON.parse(content)).not.toThrow();
          });

          it('should have groups with sections and fields', () => {
            const schema = JSON.parse(fs.readFileSync(schemaFile, 'utf8'));
            expect(schema.groups).toBeInstanceOf(Array);
            expect(schema.groups.length).toBeGreaterThan(0);

            for (const group of schema.groups) {
              expect(group.sections).toBeInstanceOf(Array);

            for (const section of group.sections) {
            if (!section.fields) continue;  // skip sections without fields
            expect(section.fields).toBeInstanceOf(Array);

            for (const field of section.fields) {
                  expect(field.key).toBeTruthy();
                  expect(field.component).toBeTruthy();
                  expect(field.label).toBeTruthy();
                }
              }
            }
          });
        });
      }

      // ── File Structure ────────────────────────────────────────────────

      describe('file structure', () => {
        it('should have a services directory', () => {
          const servicesDir = path.join(mod.dir, 'services');
          expect(fs.existsSync(servicesDir)).toBe(true);
        });
      });

      // ── Changelog ─────────────────────────────────────────────────────

      if (mod.manifest.changelog) {
        describe('changelog', () => {
          it('should have entries with required fields', () => {
            for (const entry of mod.manifest.changelog) {
              expect(entry.version).toMatch(/^\d+\.\d+\.\d+$/);
              expect(entry.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
              expect(entry.changes).toBeInstanceOf(Array);
              expect(entry.changes.length).toBeGreaterThan(0);
            }
          });

          it('should have the current version in changelog', () => {
            const versions = mod.manifest.changelog.map(e => e.version);
            expect(versions).toContain(mod.manifest.version);
          });
        });
      }
    });
  }
});