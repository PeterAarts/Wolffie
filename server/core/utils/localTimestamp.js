// server/core/utils/localTimestamp.js
//
// Geeft de huidige tijd als lokale tijdstring terug in het formaat dat SQLite verwacht:
// "YYYY-MM-DD HH:MM:SS.mmm"
//
// Waarom niet new Date().toISOString()?
//   toISOString() geeft altijd UTC — bij CEST (UTC+2) is dat 2 uur te vroeg.
//   SQLite heeft geen tijdzone-bewustzijn; timestamps worden opgeslagen en
//   teruggegeven als tekst. Als we UTC opslaan maar de frontend lokale tijd verwacht,
//   verschuift de grafiek-as met de UTC-offset.
//
// Gebruik in collectors:
//   import { localTimestamp } from '../../../core/utils/localTimestamp.js';
//   const timestamp = localTimestamp(); // "2026-04-05 21:42:02.948"

export function localTimestamp() {
  const d  = new Date();
  const p  = n => String(n).padStart(2, '0');
  const ms = n => String(n).padStart(3, '0');
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} ` +
         `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${ms(d.getMilliseconds())}`;
}

// Variant zonder milliseconden — voor tabellen die geen sub-seconde precisie nodig hebben
export function localTimestampSec() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} ` +
         `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}