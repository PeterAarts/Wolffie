<!-- src/views/CollectorFlow.vue -->
<template>
  <div class="cf-wrapper">

    <!-- Title -->
    <div class="cf-header">
      <h1 class="cf-title">WattsOn — Collector Data Flow</h1>
      <p class="cf-subtitle">moduleLoader → collectorManager → HomeWizard Collector → MariaDB</p>
    </div>

    <!-- Stage selector pills -->
    <div class="cf-pills">
      <button
        v-for="(pill, i) in pills"
        :key="i"
        :class="['cf-pill', { active: activeStage === i }]"
        :style="activeStage === i ? { borderColor: pill.color, color: pill.color, background: pill.color + '22' } : {}"
        @click="activeStage = i"
      >
        {{ pill.label }}
      </button>
    </div>

    <!-- Description panel -->
    <div class="cf-desc-panel">
      <span class="cf-desc-badge" :style="{ background: pills[activeStage].color }">{{ activeStage + 1 }}</span>
      <span class="cf-desc-text">{{ stages[activeStage].desc }}</span>
    </div>

    <!-- SVG Diagram -->
    <div class="cf-svg-wrap">
      <svg viewBox="0 0 1400 260" class="cf-svg">

        <!-- Background stage regions -->
        <rect x="10"  y="50" width="570" height="210" rx="12" :fill="activeStage===0 ? '#60a5fa09' : 'transparent'" :stroke="activeStage===0 ? '#60a5fa22' : 'transparent'" stroke-width="1"/>
        <rect x="590" y="50" width="370" height="210" rx="12" :fill="activeStage===1 ? '#34d39909' : 'transparent'" :stroke="activeStage===1 ? '#34d39922' : 'transparent'" stroke-width="1"/>
        <rect x="970" y="50" width="420" height="210" rx="12" :fill="activeStage===2 ? '#fbbf2409' : 'transparent'" :stroke="activeStage===2 ? '#fbbf2422' : 'transparent'" stroke-width="1"/>

        <!-- Stage badges -->
        <g v-for="badge in badges" :key="badge.id">
          <rect :x="badge.x-52" :y="badge.y-13" width="104" height="26" rx="13" :fill="badge.color+'22'" :stroke="badge.color" stroke-width="1"/>
          <circle :cx="badge.x-38" :cy="badge.y" r="9" :fill="badge.color"/>
          <text :x="badge.x-38" :y="badge.y+0.5" :fill="'#0a0e1a'" font-size="9" font-weight="700" text-anchor="middle" dominant-baseline="middle">{{ badge.num }}</text>
          <text :x="badge.x+8"  :y="badge.y+0.5" :fill="badge.color" font-size="8.5" font-weight="600" text-anchor="middle" dominant-baseline="middle">{{ badge.label }}</text>
        </g>

        <!-- ════════════════════════════════════════════ -->
        <!-- STAGE 1 — moduleLoader                       -->
        <!-- ════════════════════════════════════════════ -->

        <!-- moduleLoader box -->
        <g class="cf-box">
          <rect x="20" y="82" width="200" height="185" rx="8" fill="#111827" :stroke="activeStage===0?'#60a5fa':'#1e293b'" :stroke-width="activeStage===0?1.5:1"/>
          <rect x="20" y="82" width="200" height="24" rx="8" fill="#60a5fa18"/>
          <rect x="20" y="98" width="200" height="8"  fill="#60a5fa18"/>
          <text x="30" y="97" fill="#60a5fa" font-size="8.5" font-weight="600">moduleLoader.js</text>
          <!-- code lines -->
          <text x="32" y="117" fill="#64748b" font-size="7" font-family="'JetBrains Mono','Fira Code',monospace">discoverModules()</text>
          <text x="32" y="128" fill="#64748b" font-size="7" font-family="'JetBrains Mono','Fira Code',monospace">  path.resolve(__dirname,</text>
          <text x="32" y="139" fill="#64748b" font-size="7" font-family="'JetBrains Mono','Fira Code',monospace">    '..', 'modules')</text>
          <text x="32" y="155" fill="#64748b" font-size="7" font-family="'JetBrains Mono','Fira Code',monospace">  readdirSync()</text>
          <text x="32" y="166" fill="#64748b" font-size="7" font-family="'JetBrains Mono','Fira Code',monospace">  → filter directories</text>
          <text x="32" y="182" fill="#64748b" font-size="7" font-family="'JetBrains Mono','Fira Code',monospace">  for each dir:</text>
          <text x="32" y="193" fill="#34d399" font-size="7" font-family="'JetBrains Mono','Fira Code',monospace">    loadModule(name)</text>
        </g>

        <!-- loadModule() box -->
        <g class="cf-box">
          <rect x="230" y="82" width="200" height="60" rx="8" fill="#111827" :stroke="activeStage===0?'#a78bfa':'#1e293b'" :stroke-width="activeStage===0?1.5:1"/>
          <rect x="230" y="82" width="200" height="24" rx="8" fill="#a78bfa18"/>
          <rect x="230" y="98" width="200" height="8"  fill="#a78bfa18"/>
          <text x="240" y="97" fill="#a78bfa" font-size="8.5" font-weight="600">loadModule()</text>
          <text x="242" y="117" fill="#64748b" font-size="7" font-family="'JetBrains Mono','Fira Code',monospace">  existsSync(manifest.json)</text>
          <text x="242" y="128" fill="#64748b" font-size="7" font-family="'JetBrains Mono','Fira Code',monospace">  existsSync(index.js)</text>
          <text x="242" y="139" fill="#34d399" font-size="7" font-family="'JetBrains Mono','Fira Code',monospace">  import(file://…index.js)</text>
        </g>

        <!-- Three module chips -->
        <g v-for="mod in moduleChips" :key="mod.id">
          <rect :x="230" :y="mod.y-14" width="200" height="28" rx="5" :fill="mod.color+'12'" :stroke="mod.color+'44'" stroke-width="0.8"/>
          <circle cx="244" :cy="mod.y" r="4" :fill="mod.color"/>
          <text x="254" :y="mod.y-3"  :fill="mod.color" font-size="7.5" font-weight="600">{{ mod.name }}</text>
          <text x="254" :y="mod.y+7"  fill="#64748b"   font-size="6.5">{{ mod.cap }}</text>
        </g>

        <!-- modules.set() accumulator -->
        <rect x="440" y="112" width="130" height="76" rx="6" fill="#312e8166" stroke="#a78bfa44" stroke-width="0.8"/>
        <text x="450" y="130" fill="#a78bfa" font-size="7" font-weight="600">Map modules</text>
        <text x="450" y="143" fill="#64748b" font-size="7" font-family="'JetBrains Mono','Fira Code',monospace">modules.set(</text>
        <text x="450" y="154" fill="#64748b" font-size="7" font-family="'JetBrains Mono','Fira Code',monospace">  id, module</text>
        <text x="450" y="165" fill="#34d399" font-size="7" font-family="'JetBrains Mono','Fira Code',monospace">)</text>

        <!-- Stage 1 arrows (static) -->
        <line x1="220" y1="108" x2="228" y2="108" stroke="#60a5fa" stroke-width="1.5" opacity="0.7"/>
        <line x1="220" y1="108" x2="228" y2="148" stroke="#60a5fa" stroke-width="1.5" opacity="0.7"/>
        <line x1="220" y1="108" x2="228" y2="188" stroke="#60a5fa" stroke-width="1.5" opacity="0.7"/>
        <line x1="430" y1="108" x2="438" y2="140" stroke="#a78bfa" stroke-width="1.5" opacity="0.7"/>
        <line x1="430" y1="148" x2="438" y2="155" stroke="#a78bfa" stroke-width="1.5" opacity="0.7"/>
        <line x1="430" y1="188" x2="438" y2="175" stroke="#64748b" stroke-width="1.5" opacity="0.5"/>

        <!-- Stage 1→2 connector -->
        <line x1="572" y1="150" x2="598" y2="150" stroke="#60a5fa" stroke-width="1.5" opacity="0.7"/>
        <polygon points="598,150 592,146 592,154" fill="#60a5fa" opacity="0.8"/>
        <text x="585" y="144" fill="#64748b" font-size="7" text-anchor="middle">modules Map</text>

        <!-- ════════════════════════════════════════════ -->
        <!-- STAGE 2 — collectorManager                   -->
        <!-- ════════════════════════════════════════════ -->

        <!-- collectorManager box -->
        <g class="cf-box">
          <rect x="598" y="82" width="180" height="185" rx="8" fill="#111827" :stroke="activeStage===1?'#34d399':'#1e293b'" :stroke-width="activeStage===1?1.5:1"/>
          <rect x="598" y="82" width="180" height="24" rx="8" fill="#34d39918"/>
          <rect x="598" y="98" width="180" height="8"  fill="#34d39918"/>
          <text x="608" y="97" fill="#34d399" font-size="8.5" font-weight="600">collectorManager.js</text>
          <text x="610" y="117" fill="#64748b" font-size="7" font-family="'JetBrains Mono','Fira Code',monospace">startAll(modules)</text>
          <text x="610" y="133" fill="#64748b" font-size="7" font-family="'JetBrains Mono','Fira Code',monospace">for each module:</text>
          <text x="610" y="144" fill="#64748b" font-size="7" font-family="'JetBrains Mono','Fira Code',monospace">  ① capabilities</text>
          <text x="610" y="155" fill="#64748b" font-size="7" font-family="'JetBrains Mono','Fira Code',monospace">     .dataCollection?</text>
          <text x="610" y="166" fill="#64748b" font-size="7" font-family="'JetBrains Mono','Fira Code',monospace">  ② collector.enabled</text>
          <text x="610" y="177" fill="#64748b" font-size="7" font-family="'JetBrains Mono','Fira Code',monospace">     !== false?</text>
          <text x="610" y="188" fill="#64748b" font-size="7" font-family="'JetBrains Mono','Fira Code',monospace">  ③ typeof start</text>
          <text x="610" y="199" fill="#34d399" font-size="7" font-family="'JetBrains Mono','Fira Code',monospace">     === 'function'?</text>
        </g>

        <!-- Gate checks -->
        <g v-for="gate in gates" :key="gate.id">
          <rect x="790" :y="gate.y-10" width="148" height="20" rx="4" fill="#064e3b" stroke="#34d39955" stroke-width="0.7"/>
          <text x="802" :y="gate.y+3" fill="#34d399" font-size="7">✓ {{ gate.label }}</text>
        </g>

        <!-- module.start() -->
        <rect x="790" y="168" width="148" height="34" rx="5" fill="#34d39916" stroke="#34d39944" stroke-width="0.8"/>
        <text x="802" y="183" fill="#34d399" font-size="7.5" font-weight="600">module.start()</text>
        <text x="802" y="195" fill="#64748b" font-size="6.5">→ collector.start()</text>

        <!-- Stage 2 arrows -->
        <line x1="778" y1="108" x2="788" y2="100" stroke="#34d399" stroke-width="1.5" opacity="0.7"/>
        <line x1="778" y1="140" x2="788" y2="124" stroke="#34d399" stroke-width="1.5" opacity="0.7"/>
        <line x1="778" y1="150" x2="788" y2="148" stroke="#34d399" stroke-width="1.5" opacity="0.7"/>
        <line x1="778" y1="160" x2="788" y2="178" stroke="#34d399" stroke-width="1.5" opacity="0.7"/>

        <!-- Stage 2→3 connector -->
        <line x1="940" y1="150" x2="978" y2="150" stroke="#34d399" stroke-width="1.5" opacity="0.7"/>
        <polygon points="978,150 972,146 972,154" fill="#34d399" opacity="0.8"/>
        <text x="959" y="144" fill="#64748b" font-size="7" text-anchor="middle">start()</text>

        <!-- ════════════════════════════════════════════ -->
        <!-- STAGE 3 — Collect & Store                    -->
        <!-- ════════════════════════════════════════════ -->

        <!-- HomeWizardCollector box -->
        <g class="cf-box">
          <rect x="980" y="82" width="180" height="185" rx="8" fill="#111827" :stroke="activeStage===2?'#fbbf24':'#1e293b'" :stroke-width="activeStage===2?1.5:1"/>
          <rect x="980" y="82" width="180" height="24" rx="8" fill="#fbbf2418"/>
          <rect x="980" y="98" width="180" height="8"  fill="#fbbf2418"/>
          <text x="990" y="97" fill="#fbbf24" font-size="8.5" font-weight="600">HomeWizardCollector</text>
          <text x="992" y="117" fill="#64748b" font-size="7" font-family="'JetBrains Mono','Fira Code',monospace">start()</text>
          <text x="992" y="128" fill="#64748b" font-size="7" font-family="'JetBrains Mono','Fira Code',monospace">  loadDevices()</text>
          <text x="992" y="139" fill="#64748b" font-size="7" font-family="'JetBrains Mono','Fira Code',monospace">  setInterval(5s)</text>
          <text x="992" y="155" fill="#64748b" font-size="7" font-family="'JetBrains Mono','Fira Code',monospace">collect()</text>
          <text x="992" y="166" fill="#34d399" font-size="7" font-family="'JetBrains Mono','Fira Code',monospace">  Promise.allSettled(</text>
          <text x="992" y="177" fill="#64748b" font-size="7" font-family="'JetBrains Mono','Fira Code',monospace">    devices.map(</text>
          <text x="992" y="188" fill="#64748b" font-size="7" font-family="'JetBrains Mono','Fira Code',monospace">      collectFromDevice</text>
          <text x="992" y="199" fill="#64748b" font-size="7" font-family="'JetBrains Mono','Fira Code',monospace">    ))</text>
        </g>

        <!-- fetch box -->
        <rect x="1172" y="84"  width="150" height="38" rx="5" fill="#08334466" stroke="#22d3ee44" stroke-width="0.8"/>
        <text x="1184" y="100" fill="#22d3ee" font-size="7.5" font-weight="600">fetch() Device API</text>
        <text x="1184" y="113" fill="#64748b" font-size="6.5">http://ip/api/v1/data</text>

        <!-- route box -->
        <rect x="1172" y="128" width="150" height="26" rx="5" fill="#fbbf2416" stroke="#fbbf2444" stroke-width="0.8"/>
        <text x="1184" y="145" fill="#fbbf24" font-size="7">Route by product_type</text>

        <!-- DB box -->
        <rect x="1172" y="160" width="150" height="48" rx="5" fill="#064e3b66" stroke="#34d39944" stroke-width="0.8"/>
        <text x="1184" y="177" fill="#34d399" font-size="7.5" font-weight="600">INSERT INTO DB</text>
        <text x="1184" y="188" fill="#64748b" font-size="7" font-family="'JetBrains Mono','Fira Code',monospace">homewizard_data ✓</text>
        <text x="1184" y="199" fill="#f87171" font-size="6.5" font-weight="600">⚠ energy_snapshots ✗</text>

        <!-- Stage 3 arrows -->
        <line x1="1160" y1="108" x2="1170" y2="103" stroke="#22d3ee" stroke-width="1.5" opacity="0.7"/>
        <line x1="1160" y1="145" x2="1170" y2="141" stroke="#fbbf24" stroke-width="1.5" opacity="0.7"/>
        <line x1="1160" y1="165" x2="1170" y2="175" stroke="#34d399" stroke-width="1.5" opacity="0.7"/>

        <!-- Animated flow particles -->
        <g v-for="p in particles" :key="p.id">
          <circle :cx="p.x" :cy="p.y" :r="2" :fill="p.color" opacity="0.7">
            <animate attribute-name="opacity" values="0.7;0.25;0.7" dur="1.2s" repeat-count="indefinite"/>
          </circle>
        </g>

        <!-- Legend -->
        <g opacity="0.7">
          <circle cx="30"  cy="252" r="2.5" fill="#60a5fa"/><text x="38"  y="254" fill="#64748b" font-size="7">Discovery flow</text>
          <circle cx="130" cy="252" r="2.5" fill="#34d399"/><text x="138" y="254" fill="#64748b" font-size="7">Startup flow</text>
          <circle cx="220" cy="252" r="2.5" fill="#fbbf24"/><text x="228" y="254" fill="#64748b" font-size="7">Collection flow</text>
          <circle cx="320" cy="252" r="2.5" fill="#f87171"/><text x="328" y="254" fill="#64748b" font-size="7">Known gap</text>
        </g>
      </svg>
    </div>

    <!-- Bottom detail cards -->
    <div class="cf-cards">
      <div v-for="card in cards" :key="card.title" class="cf-card" :style="{ borderTopColor: card.color }">
        <div class="cf-card-title" :style="{ color: card.color }">{{ card.title }}</div>
        <div v-for="(item, j) in card.items" :key="j" class="cf-card-item" :style="item.includes('⚠') ? { color: '#f87171' } : {}">
          <span class="cf-card-bullet" :style="{ color: card.color }">›</span>
          <span>{{ item }}</span>
        </div>
      </div>
    </div>

  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue';

// ─── reactive state ───────────────────────────────────
const activeStage = ref(0);
const tick         = ref(0);
let   tickTimer    = null;

onMounted(() => {
  tickTimer = setInterval(() => { tick.value++; }, 600);
});
onUnmounted(() => {
  if (tickTimer) clearInterval(tickTimer);
});

// ─── static data ──────────────────────────────────────
const pills = [
  { label: '1  Discovery',      color: '#60a5fa' },
  { label: '2  Startup',        color: '#34d399' },
  { label: '3  Collect & Store',color: '#fbbf24' },
];

const stages = [
  { desc: 'moduleLoader scans the modules/ directory, reads each manifest.json, and dynamically imports index.js. Valid modules are stored in a Map keyed by their manifest id.' },
  { desc: 'collectorManager iterates loaded modules. It gates on three checks: dataCollection capability, collector.enabled, and presence of a start() method. Passing modules are started.' },
  { desc: 'The module\'s collector polls device APIs on a timer, routes each response to a type-specific store method, and INSERTs rows into the database. The gap: homewizard_energy_snapshots is not yet written to.' },
];

const badges = [
  { id: 1, x: 155,  y: 68, num: '1', label: 'DISCOVERY',        color: '#60a5fa' },
  { id: 2, x: 775,  y: 68, num: '2', label: 'STARTUP',          color: '#34d399' },
  { id: 3, x: 1180, y: 68, num: '3', label: 'COLLECT & STORE',  color: '#fbbf24' },
];

const moduleChips = [
  { id: 'hw',  name: 'homewizard',     y: 152, color: '#22d3ee', cap: 'dataCollection ✓' },
  { id: 'ae',  name: 'alphaess-cloud', y: 192, color: '#34d399', cap: 'dataCollection ✓' },
  { id: 'se',  name: 'solaredge',      y: 232, color: '#64748b', cap: 'not implemented ✗' },
];

const gates = [
  { id: 1, label: '① dataCollection',   y: 100 },
  { id: 2, label: '② collector.enabled', y: 124 },
  { id: 3, label: '③ start() exists',    y: 148 },
];

const cards = [
  {
    title: 'moduleLoader.js', color: '#60a5fa',
    items: [
      'path.resolve(__dirname, \'…\', \'modules\') — finds modules/ dir',
      'readdirSync → filters directories only',
      'Reads manifest.json with fs.readFileSync + JSON.parse',
      'Dynamic import() via file:// URL for index.js',
      'Attaches manifest to default export → stores in Map',
    ],
  },
  {
    title: 'collectorManager.js', color: '#34d399',
    items: [
      'Iterates the modules Map from moduleLoader',
      'Gate 1: manifest.capabilities.dataCollection === true',
      'Gate 2: manifest.collector.enabled !== false',
      'Gate 3: typeof module.start === \'function\'',
      'Calls module.start() → delegates to collector.start()',
    ],
  },
  {
    title: 'HomeWizard Collector', color: '#fbbf24',
    items: [
      'loadDevices() queries device_settings WHERE module=\'homewizard\'',
      'setInterval(5s) → collect() on each tick',
      'Promise.allSettled polls all devices in parallel',
      'Routes by product_type: P1 / SKT / KWH1 / KWH3',
      'INSERTs into homewizard_data — but NOT energy_snapshots ⚠',
    ],
  },
];

// ─── animated particles ──────────────────────────────
const flowPaths = [
  // Stage 1
  { x1: 220, y1: 108, x2: 230, y2: 108, color: '#60a5fa' },
  { x1: 220, y1: 108, x2: 230, y2: 148, color: '#60a5fa' },
  { x1: 220, y1: 108, x2: 230, y2: 188, color: '#60a5fa' },
  // 1→2
  { x1: 572, y1: 150, x2: 598, y2: 150, color: '#60a5fa' },
  // Stage 2
  { x1: 778, y1: 120, x2: 790, y2: 110, color: '#34d399' },
  { x1: 778, y1: 150, x2: 790, y2: 148, color: '#34d399' },
  // 2→3
  { x1: 940, y1: 150, x2: 978, y2: 150, color: '#34d399' },
  // Stage 3
  { x1: 1160, y1: 108, x2: 1172, y2: 103, color: '#22d3ee' },
  { x1: 1160, y1: 145, x2: 1172, y2: 141, color: '#fbbf24' },
  { x1: 1160, y1: 165, x2: 1172, y2: 175, color: '#34d399' },
];

const particles = computed(() => {
  const out = [];
  const t = tick.value;
  flowPaths.forEach((p, i) => {
    for (let j = 0; j < 2; j++) {
      const progress = ((t * 0.08 + j * 0.5 + i * 0.3) % 1);
      out.push({
        id:    `${i}-${j}`,
        x:     p.x1 + (p.x2 - p.x1) * progress,
        y:     p.y1 + (p.y2 - p.y1) * progress,
        color: p.color,
      });
    }
  });
  return out;
});
</script>

<style scoped>
/* ─── layout shell ─────────────────────────── */
.cf-wrapper {
  background : #0a0e1a;
  min-height : 100vh;
  padding    : 28px 20px;
  font-family: 'Inter', sans-serif;
  color      : #c8d6e5;
}

/* ─── header ───────────────────────────────── */
.cf-header    { text-align: center; margin-bottom: 8px; }
.cf-title     { font-size: 22px; font-weight: 700; color: #f1f5f9; margin: 0; letter-spacing: -0.5px; }
.cf-subtitle  { font-size: 11px; color: #64748b; margin: 4px 0 0; letter-spacing: 0.5px; text-transform: uppercase; }

/* ─── pills ────────────────────────────────── */
.cf-pills {
  display        : flex;
  justify-content: center;
  gap            : 8px;
  margin-bottom  : 16px;
}
.cf-pill {
  background   : #111827;
  border       : 1px solid #1e293b;
  color        : #64748b;
  border-radius: 20px;
  padding      : 5px 14px;
  font-size    : 11px;
  font-weight  : 600;
  cursor       : pointer;
  transition   : all 0.2s;
  letter-spacing: 0.3px;
}
.cf-pill:hover { border-color: #334155; color: #c8d6e5; }

/* ─── description panel ────────────────────── */
.cf-desc-panel {
  background   : #111827;
  border       : 1px solid #1e293b;
  border-radius: 10px;
  padding      : 10px 16px;
  max-width    : 900px;
  margin       : 0 auto 18px;
  min-height   : 42px;
  display      : flex;
  align-items  : center;
  gap          : 10px;
}
.cf-desc-badge {
  color        : #0a0e1a;
  border-radius: 50%;
  width        : 22px;
  height       : 22px;
  display      : flex;
  align-items  : center;
  justify-content: center;
  font-size    : 11px;
  font-weight  : 700;
  flex-shrink  : 0;
}
.cf-desc-text { font-size: 11.5px; line-height: 1.5; }

/* ─── svg container ────────────────────────── */
.cf-svg-wrap { overflow-x: auto; display: flex; justify-content: center; }
.cf-svg      { width: 100%; max-width: 1400px; height: auto; }

/* ─── bottom cards ─────────────────────────── */
.cf-cards {
  display        : flex;
  gap            : 12px;
  max-width      : 1100px;
  margin         : 18px auto 0;
  flex-wrap      : wrap;
  justify-content: center;
}
.cf-card {
  flex           : 1 1 280px;
  max-width      : 340px;
  background     : #111827;
  border         : 1px solid #1e293b;
  border-radius  : 10px;
  padding        : 12px 14px;
  border-top     : 2px solid transparent; /* overridden inline */
}
.cf-card-title {
  font-size     : 11px;
  font-weight   : 700;
  margin-bottom : 8px;
  letter-spacing: 0.3px;
}
.cf-card-item {
  font-size     : 10.5px;
  color         : #64748b;
  padding       : 3px 0;
  border-bottom : 1px solid #1e293b;
  display       : flex;
  align-items   : flex-start;
  gap           : 6px;
}
.cf-card-item:last-child { border-bottom: none; }
.cf-card-bullet { margin-top: 1px; flex-shrink: 0; }
</style>