<template>
  <div class="flow-diagram">
    <svg
      :viewBox="`0 0 ${W} ${H}`"
      class="flow-svg"
      xmlns="http://www.w3.org/2000/svg"
    >


      <!-- ══════════════════════════════════════════════════════════
           PATHS
      ══════════════════════════════════════════════════════════ -->

      <!-- Grid: straight down to hub top-center -->
      <path id="p-grid"
        :d="`M ${POS.grid.x} ${POS.grid.y + NR} L ${CX} ${CY - 48}`"
        class="flow-line-base"
        :class="gridLineClass"
      />

      <!-- Solar: down then right to hub top-left -->
      <path id="p-solar"
        :d="`M ${POS.solar.x} ${POS.solar.y + NR}
             L ${POS.solar.x} ${CY - 14 - R}
             Q ${POS.solar.x} ${CY - 14} ${POS.solar.x + R} ${CY - 14}
             L ${CX - 34} ${CY - 14}`"
        class="flow-line-base"
        :class="solarActive ? 'flow-line--active' : 'flow-line--inactive'"
      />

      <!-- Wind: down then left to hub top-right -->
      <path id="p-wind"
        :d="`M ${POS.wind.x} ${POS.wind.y + NR}
             L ${POS.wind.x} ${CY - 14 - R}
             Q ${POS.wind.x} ${CY - 14} ${POS.wind.x - R} ${CY - 14}
             L ${CX + 34} ${CY - 14}`"
        class="flow-line-base flow-line--inactive"
      />

      <!-- Hub bottom-left → Home: horizontal then down -->
      <path id="p-home"
        :d="`M ${CX - 34} ${CY + 14} L ${POS.home.x + R} ${CY + 14} Q ${POS.home.x} ${CY + 14} ${POS.home.x} ${CY + 14 + R} L ${POS.home.x} ${POS.home.y - NR}`"
        class="flow-line-base"
        :class="homeActive ? 'flow-line--active' : 'flow-line--inactive'"
      />

      <!-- Hub bottom-center → Boiler: straight down -->
      <path id="p-boiler"
        :d="`M ${CX} ${CY + 48} L ${POS.boiler.x} ${POS.boiler.y - NR}`"
        class="flow-line-base flow-line--inactive"
      />

      <!-- Hub bottom-right → EV: horizontal then down -->
      <path id="p-ev"
        :d="`M ${CX + 34} ${CY + 14} L ${POS.ev.x - R} ${CY + 14} Q ${POS.ev.x} ${CY + 14} ${POS.ev.x} ${CY + 14 + R} L ${POS.ev.x} ${POS.ev.y - NR}`"
        class="flow-line-base flow-line--inactive"
      />

      <!-- Hub 3-o-clock → Battery: straight horizontal -->
      <path id="p-battery"
        :d="`M ${CX + 48} ${CY} L ${POS.battery.x - NR - 2} ${CY}`"
        class="flow-line-base"
        :class="batteryLineClass"
      />

      <!-- Home → Smart: from right side of home, right then down into smart top -->
      <path id="p-smart"
        :d="`M ${POS.home.x + NR} ${POS.home.y} L ${POS.smart.x - R} ${POS.home.y} Q ${POS.smart.x} ${POS.home.y} ${POS.smart.x} ${POS.home.y + R} L ${POS.smart.x} ${POS.smart.y - NR}`"
        class="flow-line-base"
        :class="smartActive ? 'flow-line--active' : 'flow-line--inactive'"
      />

      <!-- ── Moving dots ────────────────────────────────────────── -->

      <circle v-if="solarActive && solarW > 20" r="3" class="flow-dot flow-dot--green">
        <animateMotion :dur="`${dotSpeed(solarW)}s`" repeatCount="indefinite" rotate="auto">
          <mpath href="#p-solar" />
        </animateMotion>
      </circle>

      <!-- Grid dot: 0;1 = importing (grid→hub), 1;0 = exporting (hub→grid) -->
      <circle v-if="gridActive && !upsMode && Math.abs(gridW) > 20" r="3" class="flow-dot" :class="gridW > 0 ? 'flow-dot--green' : 'flow-dot--export'">
        <animateMotion
          :dur="`${dotSpeed(Math.abs(gridW))}s`"
          repeatCount="indefinite"
          rotate="auto"
          :keyPoints="gridW > 0 ? '0;1' : '1;0'"
          keyTimes="0;1"
          calcMode="linear"
        >
          <mpath href="#p-grid" />
        </animateMotion>
      </circle>

      <!-- Home: always hub→home direction -->
      <circle v-if="homeActive && homeW > 10" r="3" class="flow-dot flow-dot--green">
        <animateMotion
          :dur="`${dotSpeed(homeW)}s`"
          repeatCount="indefinite"
          rotate="auto"
          keyPoints="0;1"
          keyTimes="0;1"
          calcMode="linear"
        >
          <mpath href="#p-home" />
        </animateMotion>
      </circle>

      <!-- Battery: direction depends on charge/discharge -->
      <circle v-if="batteryActive && Math.abs(battW) > 50" r="3" class="flow-dot flow-dot--green">
        <animateMotion
          :dur="`${dotSpeed(Math.abs(battW))}s`"
          repeatCount="indefinite"
          rotate="auto"
          :keyPoints="battW < -50 ? '0;1' : '1;0'"
          keyTimes="0;1"
          calcMode="linear"
        >
          <mpath href="#p-battery" />
        </animateMotion>
      </circle>

      <!-- ── Hub ───────────────────────────────────────────────── -->
      <circle v-if="upsMode" :cx="CX" :cy="CY" r="58" class="hub-ups-ring" />
      <circle :cx="CX" :cy="CY" r="48" :class="['hub-circle', upsMode ? 'hub-circle--ups' : '']" />
      <text :x="CX" :y="CY - 4"  class="hub-text hub-title">WOLFFIE</text>
      <text :x="CX" :y="CY + 10" class="hub-text hub-sub">ENERGY</text>

      <!-- ── Battery node ───────────────────────────────────────── -->
      <g :transform="`translate(${POS.battery.x}, ${POS.battery.y})`">
        <!--<circle :r="NR + 6" class="node-ring node-ring--active" />-->
        <circle :r="NR + 2" fill="none" stroke="var(--color-secondary-100,#f3f4f6)" stroke-width="0" />
        <circle
          :r="NR+1"
          fill="batteryArcColor"
          :stroke="batteryArcColor"
          stroke-width="4"
          stroke-linecap="round"
          :stroke-dasharray="batteryArcDash"
          transform="rotate(-90 0 0)"
          class="hub-soc-arc"
        />
        <circle :r="NR" class="node-circle node-circle--active" />
        <foreignObject :x="-NR * 0.5" :y="-NR * 0.5" :width="NR" :height="NR">
          <div xmlns="http://www.w3.org/1999/xhtml" class="node-icon-wrap">
            <i class="ph-light ph-battery-charging" style="font-size:16px;line-height:1;color:#1a2e2e;"></i>
          </div>
        </foreignObject>
        <text y="34" class="node-label node-label--active text-base font-bold text-primary" text-anchor="middle">Battery</text>
        <text y="46" class="node-value" text-anchor="middle"> {{ battStatusLabel }}</text>
        <text v-if="Math.abs(battW) > 50" y="58" class="node-value" text-anchor="middle">{{ fmtW(battW) }}</text>
      </g>

      <!-- ── Regular nodes ─────────────────────────────────────── -->
      <g v-for="node in nodeList" :key="node.id" :transform="`translate(${node.x}, ${node.y})`">
        <!--<circle :r="NR + 6" :class="['node-ring', node.active ? 'node-ring--active' : 'node-ring--inactive']" />-->
        <circle :r="NR"     :class="['node-circle', node.active ? 'node-circle--active' : 'node-circle--inactive', node.id === 'grid' && upsMode ? 'node-circle--ups' : '']" />
        <foreignObject :x="-NR * 0.5" :y="-NR * 0.5" :width="NR" :height="NR">
          <div xmlns="http://www.w3.org/1999/xhtml" class="node-icon-wrap">
            <i
              :class="`ph-light ${node.icon}`"
              :style="{ fontSize: '16px', lineHeight: '1', color: node.id === 'grid' && upsMode ? '#ef4444' : node.active ? 'var(--color-secondary-700)' : 'var(--color-secondary-300,#9ca3af)' }"
            ></i>
          </div>
        </foreignObject>

        <!-- TOP nodes: label and value ABOVE the circle -->
        <template v-if="node.top">
          <text y="-38" class="node-label" :class="[node.active ? 'node-label--active' : 'node-label--inactive', node.id === 'grid' && upsMode ? 'node-label--ups' : '']" text-anchor="middle">{{ node.label }}</text>
          <text v-if="node.active && node.value" y="-26" class="node-value" text-anchor="middle">{{ node.value }}</text>
        </template>

        <!-- BOTTOM nodes: label and value BELOW the circle -->
        <template v-else>
          <text y="32" class="node-label" :class="[node.active ? 'node-label--active' : 'node-label--inactive', node.id === 'grid' && upsMode ? 'node-label--ups' : '']" text-anchor="middle">{{ node.label }}</text>
          <text v-if="node.active && node.value" y="44" class="node-value" text-anchor="middle">{{ node.value }}</text>
        </template>
      </g>

    </svg>
  </div>
</template>

<script setup>
import { computed, onMounted } from 'vue';
import { useRealtimeStore } from '@/stores/realtime';
import { useDevicesStore } from '@/stores/devices';

const realtimeStore = useRealtimeStore();
const devicesStore  = useDevicesStore();

onMounted(() => {
  if (!devicesStore.autoRefreshEnabled) {
    devicesStore.initialize();
  } else {
    devicesStore.fetchDevices(); // already initialized — refresh immediately
  }
});

const W  = 320;
const H  = 370;
const NR = 16; // node radius
const R  = 10;
const CX = 148; // default 148
const CY = 140; // default 210 (shifted down a bit to make room for UPS banner)

const POS = {
  grid:    { x: CX,       y: 40        },
  solar:   { x: CX - 90,  y: 60        },
  wind:    { x: CX + 70,  y: 60        },
  battery: { x: CX + 118, y: CY        },
  home:    { x: CX - 90,  y: CY + 96  },
  boiler:  { x: CX,       y: CY + 96  },
  ev:      { x: CX + 70,  y: CY + 96  },
  smart:   { x: CX - 45,  y: CY + 150 },
};

const solarActive   = computed(() => !!realtimeStore.realtimeData?.components?.solar);
const batteryActive = computed(() => !!realtimeStore.realtimeData?.components?.battery_1);
const gridActive    = computed(() => !!realtimeStore.realtimeData?.components?.grid);
const homeActive    = computed(() => !!realtimeStore.realtimeData?.components?.home_usage);
// activeDevices timestamp filter breaks on 'YYYY-MM-DD HH:mm:ss' format (no T)
// Use devices directly — if the store has data it's fresh enough
const smartActive   = computed(() => devicesStore.devices.length > 0);
const smartW        = computed(() => devicesStore.totalPower);


const solarW = computed(() => realtimeStore.realtimeData?.components?.solar?.currentOut || 0);
const battW  = computed(() => {
  const b = realtimeStore.realtimeData?.components?.battery_1;
  return b ? (b.currentIn || 0) - (b.currentOut || 0) : 0;
});
const gridW  = computed(() => {
  const g = realtimeStore.realtimeData?.components?.grid;
  return g ? (g.currentIn || 0) - (g.currentOut || 0) : 0;
});
const homeW  = computed(() => realtimeStore.realtimeData?.components?.home_usage?.currentIn || 0);

// UPS mode: grid component exists but inverter reports grid is not connected.
// Uses gridConnected flag from realtime data — avoids false trigger on near-zero export.
const gridConnected = computed(() => realtimeStore.gridConnected ?? true);
const upsMode = computed(() => gridActive.value && !gridConnected.value);

// ── Dot speed: maps watts to duration (high watts = fast = short duration) ─
// Range: 100W → 3.0s,  5000W → 0.5s
function dotSpeed(watts) {
  const MIN_DUR = 0.5;
  const MAX_DUR = 3.0;
  const MIN_W   = 100;
  const MAX_W   = 5000;
  const clamped = Math.max(MIN_W, Math.min(MAX_W, Math.abs(watts)));
  const t = (clamped - MIN_W) / (MAX_W - MIN_W); // 0→1
  return +(MAX_DUR - t * (MAX_DUR - MIN_DUR)).toFixed(2);
}

const battSoc        = computed(() => Math.round(realtimeStore.realtimeData?.batterySOC || 0));
const SOC_CIRC       = 2 * Math.PI * (NR + 2);
const batteryArcDash = computed(() => {
  const filled = SOC_CIRC * (battSoc.value / 100);
  return `${filled} ${SOC_CIRC - filled}`;
});
const batteryArcColor = computed(() => {
  if (battW.value < -50) return '#10b981';
  if (battW.value >  50) return '#f59e0b';
  if (battSoc.value <= 20) return '#f43f5e';
  return '#10b981';
});
const battStatusLabel = computed(() => {
  if (battW.value < -50) return 'charging';
  if (battW.value >  50) return 'discharging';
  return 'idle';
});

const gridLineClass = computed(() => {
  if (upsMode.value)              return 'flow-line--ups';
  if (!gridActive.value)          return 'flow-line--inactive';
  if (Math.abs(gridW.value) > 20) return 'flow-line--active';
  return 'flow-line--inactive';
});

const batteryLineClass = computed(() => {
  if (!batteryActive.value)       return 'flow-line--inactive';
  if (Math.abs(battW.value) > 50) return 'flow-line--active';
  return 'flow-line--inactive';
});

function fmtW(watts) {
  const abs = Math.abs(watts);
  return abs >= 1000 ? `${(abs / 1000).toFixed(1)} kW` : `${Math.round(abs)} W`;
}

const nodeList = computed(() => [
  { id: 'grid',   label: upsMode.value ? 'NO GRID' : 'Grid', icon: 'ph-circuitry', active: gridActive.value,  value: gridActive.value  ? fmtW(gridW.value)  : null, top: true,  ...POS.grid   },
  { id: 'solar',  label: 'Solar',  icon: 'ph-sun',            active: solarActive.value, value: solarActive.value ? fmtW(solarW.value) : null, top: true,  ...POS.solar  },
  { id: 'wind',   label: 'Wind',   icon: 'ph-wind',           active: false,             value: null,                                           top: true,  ...POS.wind   },
  { id: 'home',   label: 'Home',   icon: 'ph-house',          active: homeActive.value,  value: homeActive.value  ? fmtW(homeW.value)  : null, top: false, ...POS.home   },
  { id: 'boiler', label: 'Boiler', icon: 'ph-drop',           active: false,              value: null,                                              top: false, ...POS.boiler },
  { id: 'ev',     label: 'EV',     icon: 'ph-car',            active: false,             value: null,                                           top: false, ...POS.ev     },
  { id: 'smart',  label: 'Smart',  icon: 'ph-plug',           active: smartActive.value, value: smartActive.value ? fmtW(smartW.value) : null,  top: false, ...POS.smart  },
]);
</script>

<style scoped>
.flow-diagram         { display: flex;justify-content: center;align-items: flex-start;padding: 0.75rem 0.5rem 0;height: 100%;}
.flow-svg             { overflow: visible; width: 100%; max-width: 100%; }

.hub-circle           { fill: var(--color-secondary-300); filter: drop-shadow(0 2px 8px rgba(0,0,0,.20)); }
.hub-circle--ups      { fill: var(--color-secondary-400);}
.hub-ups-ring         { fill: none; stroke: #ef4444; stroke-width: 2; animation: ups-pulse 1.2s ease-in-out infinite; }
.hub-text             { fill: var(--color-primary); text-anchor: middle; font-family: 'Rubik', sans-serif; }
.hub-title            { font-size: 7px; font-weight: 700; letter-spacing: 0.1em; }
.hub-sub              { font-size: 6px; font-weight: 400; opacity: 0.6; }
.hub-soc-arc          { transition: stroke-dasharray .6s ease; }

.node-ring            { fill: none; stroke-width: 1.5; }
.node-ring--active    { stroke: var(--color-secondary-200,#e5e7eb); opacity: 0.8; }
.node-ring--inactive  { stroke: var(--color-secondary-200,#e5e7eb); opacity: 0.35; }

.node-circle           { transition: fill .3s; }
.node-circle--active   { fill: #fff; stroke: var(--color-secondary-500,#d1d5db); stroke-width: 1; filter: drop-shadow(0 2px 4px var(--color-secondary-200)); }
.node-circle--inactive { fill: var(--color-secondary-100,#f3f4f6); stroke: var(--color-secondary-200,#e5e7eb); stroke-width: 1; }
.node-circle--ups      { fill: #fef2f2; stroke: #ef4444; stroke-width: 1; animation: ups-node-pulse 1.2s ease-in-out infinite; }

.node-icon-wrap       { display: flex; align-items: center; justify-content: center; width: 100%; height: 100%; }

.node-label           { font-family: 'Rubik', sans-serif; font-size: 8px; font-weight: 600; text-transform: lowercase; }
.node-label--active   { fill: var(--color-primary,#111827); }
.node-label--inactive { fill: var(--color-secondary-300,#9ca3af); font-size: 7px; font-weight: 500; text-transform: lowercase; }
.node-label--ups      { fill: #ef4444; font-weight: 700; }
.node-value           { font-family: 'Rubik', sans-serif; font-size: 7px; font-weight: 500; fill: var(--color-secondary,#6b7280); }

.flow-line-base       { fill: none; stroke-width: 1; stroke-linecap: round; }
.flow-line--inactive  { stroke: var(--color-secondary-200,#e5e7eb); stroke-dasharray: 3 6; }
.flow-line--active    { stroke: var(--color-secondary-400,#e5e7eb); }
.flow-line--ups       { stroke: #fca5a5; }

.flow-dot--green      { fill: var(--color-secondary-700); filter: drop-shadow(0 0 3px var(--color-secondary-300)); }
.flow-dot--export     { fill: #f97316; filter: drop-shadow(0 0 3px rgba(249,115,22,.5)); }

@keyframes ups-pulse      { 0%, 100% { opacity: 0.15; } 50% { opacity: 0.5; } }
@keyframes ups-node-pulse { 0%, 100% { stroke-opacity: 0.5; } 50% { stroke-opacity: 1; } }
</style>