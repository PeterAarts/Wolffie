// core/capabilityRegistry.js
//
// Central registry for all service capabilities provided by modules.
//
// Modules register handlers during their init() and unregister them
// during destroy(). When two modules register the same capability type,
// the one with the highest priority wins. On a tie the first registrant
// keeps the slot — priority should be set explicitly in the manifest to
// avoid ambiguity.
//
// Handler signature:  async (body, req) => result
//   body  — parsed request body (may be empty for GET-style handlers)
//   req   — Express request object (available if the handler needs it)

/**
 * @typedef {Object} CapabilityEntry
 * @property {string}   type      - Capability type string, e.g. 'battery:charge-from-grid'
 * @property {Function} handler   - async (body, req) => result
 * @property {number}   priority  - Higher number wins when two modules claim same type
 * @property {string}   moduleId  - ID of the registering module (for unregister / debug)
 */

class CapabilityRegistry {
  constructor() {
    /** @type {Map<string, CapabilityEntry>} */
    this._registry = new Map();
  }

  // ─── Registration ──────────────────────────────────────────────────────────

  /**
   * Register a capability handler.
   * Replaces an existing entry only if the new priority is strictly higher.
   *
   * @param {string}   type      Capability type, e.g. 'battery:charge-from-grid'
   * @param {Function} handler   async (body, req) => result
   * @param {number}   priority  Higher wins (e.g. modbus=10, cloud=5)
   * @param {string}   moduleId  Registering module's ID
   */
  register(type, handler, priority, moduleId) {
    const existing = this._registry.get(type);

    if (existing && existing.priority >= priority) {
      console.log(
        `     - CapabilityRegistry '${type}' kept for '${existing.moduleId}' ` +
        `(priority ${existing.priority}) — '${moduleId}' (priority ${priority}) did not win`
      );
      return;
    }

    if (existing) {
      console.log(
        `     - CapabilityRegistry '${type}' reassigned from '${existing.moduleId}' ` +
        `(priority ${existing.priority}) to '${moduleId}' (priority ${priority})`
      );
    } else {
      console.log(`     - CapabilityRegistry '${type}' registered by '${moduleId}' (priority ${priority})`);
    }

    this._registry.set(type, { type, handler, priority, moduleId });
  }

  /**
   * Unregister all capabilities belonging to a module.
   * Called when a module is disabled or destroyed.
   *
   * @param {string} moduleId
   */
  unregister(moduleId) {
    let count = 0;
    for (const [type, entry] of this._registry.entries()) {
      if (entry.moduleId === moduleId) {
        this._registry.delete(type);
        count++;
      }
    }
    if (count > 0) {
      console.log(`     - CapabilityRegistry Unregistered ${count} capability/ies for '${moduleId}'`);
    }
  }

  // ─── Lookup ────────────────────────────────────────────────────────────────

  /**
   * Returns the handler function for a capability type, or null if unavailable.
   *
   * @param  {string}        type
   * @returns {Function|null}
   */
  get(type) {
    return this._registry.get(type)?.handler ?? null;
  }

  /**
   * Returns true if a capability is currently registered.
   *
   * @param  {string}  type
   * @returns {boolean}
   */
  has(type) {
    return this._registry.has(type);
  }

  // ─── Introspection ─────────────────────────────────────────────────────────

  /**
   * Returns a plain array of all currently registered capabilities,
   * suitable for the GET /api/capabilities response.
   *
   * @returns {{ type: string, moduleId: string, priority: number }[]}
   */
  list() {
    return Array.from(this._registry.values()).map(({ type, moduleId, priority }) => ({
      type,
      moduleId,
      priority,
    }));
  }
}

// Singleton — shared across the entire process
export default new CapabilityRegistry();