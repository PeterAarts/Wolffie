// server/core/system/services/eventService.js
//
// ── Legacy shim ───────────────────────────────────────────────────────────────
// Delegates to eventLogService. Existing callers (e.g. alphaess-modbus-tcp
// collector) continue to work without changes.
//
// Maps the old interface:
//   eventService.log({ category, action, source, userId, details, status })
//
// To the new interface:
//   eventLogService.log(source, category, event, severity, message, metadata)

import eventLogService from './eventLogService.js';

class EventService {
  async log(data) {
    const {
      category = 'system',
      action   = 'unknown',
      source   = 'unknown',
      userId   = null,
      details  = {},
      status   = 'SUCCESS',
    } = data;

    // Map old status to severity
    const severity = status === 'ERROR' ? 'error'
                   : status === 'WARNING' ? 'warning'
                   : 'info';

    // Build a readable message from the old fields
    const message = `${action} — ${status}`;

    // Preserve userId in metadata alongside original details
    const metadata = { ...details };
    if (userId) metadata._userId = userId;

    await eventLogService.log(
      source,
      category.toLowerCase(),
      action.toLowerCase(),
      severity,
      message,
      Object.keys(metadata).length > 0 ? metadata : null
    );
  }
}

export default new EventService();