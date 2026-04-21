// server/core/utils/logger.js
 
const PAD_WIDTH = 25;
/**
 * Returns the module display name padded or truncated to PAD_WIDTH characters.
 * Use this as a prefix in all module console.log calls so timestamps align.
 *
 * Usage:
 *   import { padName } from '../../core/utils/logger.js';
 *   const PREFIX = padName('SolarEdge ModBus');
 *   console.log(`${PREFIX} Solar=${w}W ...`);
 */
export function padName(name) {
  if (name.length >= PAD_WIDTH) return name.slice(0, PAD_WIDTH);
  return name.padEnd(PAD_WIDTH, ' ');
}
 