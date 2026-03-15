// core/system/routes/modules.js
import express from 'express';
import multer from 'multer';
import unzipper from 'unzipper';
import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import db from '../../database.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MODULES_DIR = path.resolve(__dirname, '../../../modules');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.fieldname === 'module' && !file.originalname.endsWith('.zip')) {
      return cb(new Error('Module file must be a .zip'));
    }
    cb(null, true);
  }
});

const router = express.Router();

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

async function walkDir(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) files.push(...await walkDir(full));
    else files.push(full);
  }
  return files;
}

// ── GET /api/modules ──────────────────────────────────────────────────────
// Returns all rows from module_registry, enriched with _lock from manifest.lock.json
router.get('/', async (req, res) => {
  try {
    const [rows] = await db.pool.query(`
      SELECT
        module_id,
        module_name,
        module_version,
        module_type,
        description,
        author,
        documentation_url,
        has_collector,
        has_api,
        has_ui,
        has_schema,
        api_prefix,
        collector_interval,
        collector_priority,
        settings_component,
        enabled,
        installed,
        discovered_at,
        installed_at,
        updated_at,
        last_seen_at
      FROM module_registry
      ORDER BY module_name ASC
    `);

    // Enrich each row with _lock data if a manifest.lock.json exists on disk
    const modules = await Promise.all(rows.map(async (row) => {
      let _lock = null;
      try {
        const lockPath = path.join(MODULES_DIR, row.module_id, 'manifest.lock.json');
        _lock = JSON.parse(await fs.readFile(lockPath, 'utf-8'));
      } catch { /* no lock file — module was not installed via upload */ }

      return { ...row, _lock };
    }));

    res.json(modules);
  } catch (err) {
    console.error('GET /api/modules failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/modules/upload ──────────────────────────────────────────────
router.post('/upload', upload.fields([
  { name: 'module',   maxCount: 1 },
  { name: 'checksum', maxCount: 1 },
]), async (req, res) => {
  const zipFile      = req.files?.module?.[0];
  const checksumFile = req.files?.checksum?.[0];

  if (!zipFile) return res.status(400).json({ error: 'No module file uploaded' });

  const actualChecksum = sha256(zipFile.buffer);

  // ── Checksum validation ──────────────────────────────────────────────────
  if (checksumFile) {
    const expected = checksumFile.buffer.toString('utf-8').trim().toLowerCase();
    if (actualChecksum !== expected) {
      return res.status(400).json({
        error: 'Checksum mismatch',
        message: 'The uploaded ZIP does not match the provided checksum.',
        expected,
        actual: actualChecksum,
      });
    }
  }

  const tempDir = path.join(MODULES_DIR, `_tmp_${Date.now()}`);

  try {
    // ── Extract ZIP ──────────────────────────────────────────────────────────
    await fs.mkdir(tempDir, { recursive: true });
    const zip = await unzipper.Open.buffer(zipFile.buffer);
    await zip.extract({ path: tempDir });

    // ── Find manifest.json ───────────────────────────────────────────────────
    const allFiles    = await walkDir(tempDir);
    const manifestFile = allFiles.find(f => path.basename(f) === 'manifest.json');

    if (!manifestFile) {
      await fs.rm(tempDir, { recursive: true });
      return res.status(400).json({ error: 'No manifest.json found in ZIP' });
    }

    const manifest = JSON.parse(await fs.readFile(manifestFile, 'utf-8'));

    // ── Validate manifest ────────────────────────────────────────────────────
    const missing = ['id', 'name', 'version', 'type'].filter(k => !manifest[k]);
    if (missing.length) {
      await fs.rm(tempDir, { recursive: true });
      return res.status(400).json({ error: `manifest.json missing fields: ${missing.join(', ')}` });
    }

    if (!/^[a-z0-9-_]+$/.test(manifest.id)) {
      await fs.rm(tempDir, { recursive: true });
      return res.status(400).json({ error: `Invalid module id "${manifest.id}". Use only: a-z, 0-9, hyphens, underscores.` });
    }

    // ── Validate embedded checksum ───────────────────────────────────────────
    if (manifest.checksum && actualChecksum !== manifest.checksum.toLowerCase()) {
      await fs.rm(tempDir, { recursive: true });
      return res.status(400).json({
        error: 'Checksum mismatch',
        message: 'ZIP does not match checksum declared in manifest.json',
        expected: manifest.checksum,
        actual: actualChecksum,
      });
    }

    // ── Handle overwrite ─────────────────────────────────────────────────────
    const destDir = path.join(MODULES_DIR, manifest.id);
    try {
      await fs.access(destDir);
      if (!req.query.overwrite) {
        await fs.rm(tempDir, { recursive: true });
        return res.status(409).json({
          error: `Module '${manifest.id}' is already installed.`,
          hint: 'Add ?overwrite=true to replace it.',
        });
      }
      await fs.rm(destDir, { recursive: true });
    } catch { /* not installed yet */ }

    // ── Move to final location ────────────────────────────────────────────────
    const moduleRoot = path.dirname(manifestFile);
    await fs.rename(moduleRoot, destDir);
    await fs.rm(tempDir, { recursive: true }).catch(() => {});

    // ── Write lock file ───────────────────────────────────────────────────────
    await fs.writeFile(
      path.join(destDir, 'manifest.lock.json'),
      JSON.stringify({
        checksum:          actualChecksum,
        checksumVerified:  !!(checksumFile || manifest.checksum),
        installedAt:       new Date().toISOString(),
        originalFilename:  zipFile.originalname,
      }, null, 2)
    );

    // ── Sync to module_registry via moduleLoader ──────────────────────────────
    let hotLoaded = false;
    try {
      const { default: moduleLoader } = await import('../../moduleLoader.js');
      await moduleLoader.syncManifestToRegistry(manifest);
      hotLoaded = true;
    } catch (e) {
      console.warn('Hot-sync to registry failed (non-fatal):', e.message);
    }

    res.json({
      success:          true,
      module:           manifest,
      checksum:         actualChecksum,
      checksumVerified: !!(checksumFile || manifest.checksum),
      hotLoaded,
      message:          hotLoaded
        ? `Module "${manifest.name}" installed and registry updated.`
        : `Module "${manifest.name}" installed. Restart the server to register it.`,
    });

  } catch (err) {
    await fs.rm(tempDir, { recursive: true }).catch(() => {});
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/modules/:id/verify ───────────────────────────────────────────
router.get('/:id/verify', async (req, res) => {
  try {
    const lockPath = path.join(MODULES_DIR, req.params.id, 'manifest.lock.json');
    const lock = JSON.parse(await fs.readFile(lockPath, 'utf-8'));
    res.json({ verified: true, ...lock });
  } catch {
    res.json({ verified: false, message: 'No lock file — module was not installed via upload.' });
  }
});

// ── DELETE /api/modules/:id ───────────────────────────────────────────────
router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  try {
    // Remove from filesystem
    const destDir = path.join(MODULES_DIR, id);
    await fs.access(destDir);
    await fs.rm(destDir, { recursive: true });

    // Mark as uninstalled in registry (keep the row for history)
    await db.pool.query(`
      UPDATE module_registry
      SET installed = 0, enabled = 0, updated_at = ?
      WHERE module_id = ?
    `, [new Date().toISOString().slice(0, 19).replace('T', ' '), id]);

    res.json({ success: true, message: `Module '${id}' uninstalled.` });
  } catch (err) {
    res.status(404).json({ error: `Module '${id}' not found or could not be removed.` });
  }
});

export default router;