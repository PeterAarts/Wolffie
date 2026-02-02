import { useState, useEffect, useRef } from "react";

const COLORS = {
  bg: "#0a0e1a",
  surface: "#111827",
  surfaceHover: "#1a2238",
  border: "#1e293b",
  borderActive: "#334155",
  text: "#c8d6e5",
  textDim: "#64748b",
  textBright: "#f1f5f9",
  green: "#34d399",
  greenDim: "#064e3b",
  blue: "#60a5fa",
  blueDim: "#1e3a5f",
  amber: "#fbbf24",
  amberDim: "#451a03",
  red: "#f87171",
  redDim: "#450a0a",
  purple: "#a78bfa",
  purpleDim: "#312e81",
  cyan: "#22d3ee",
  cyanDim: "#083344",
};

// ─── Particle (animated data dot flowing along paths) ───
function Particle({ x, y, color, opacity = 1, size = 3 }) {
  return (
    <circle cx={x} cy={y} r={size} fill={color} opacity={opacity}>
      <animate
        attributeName="opacity"
        values={`${opacity};${opacity * 0.4};${opacity}`}
        dur="1.2s"
        repeatCount="indefinite"
      />
    </circle>
  );
}

// ─── Animated arrow path ───
function FlowArrow({ x1, y1, x2, y2, color = COLORS.blue, label, animated = true }) {
  const dx = x2 - x1, dy = y2 - y1;
  const len = Math.sqrt(dx * dx + dy * dy);
  const ux = dx / len, uy = dy / len;
  const arrowLen = 8;
  const ax = x2 - ux * arrowLen, ay = y2 - uy * arrowLen;
  const perpX = -uy * 5, perpY = ux * 5;

  const midX = (x1 + x2) / 2, midY = (y1 + y2) / 2;
  const labelOffX = -uy * 14, labelOffY = ux * 14;

  return (
    <g>
      <defs>
        <linearGradient id={`arrow-${x1}-${y1}-${x2}-${y2}`} x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor={color} stopOpacity="0.3" />
          <stop offset="100%" stopColor={color} stopOpacity="0.9" />
        </linearGradient>
      </defs>
      <line x1={x1} y1={y1} x2={ax} y2={ay} stroke={color} strokeWidth="1.5" opacity="0.7" />
      <polygon
        points={`${x2},${y2} ${ax + perpX},${ay + perpY} ${ax - perpX},${ay - perpY}`}
        fill={color}
        opacity="0.8"
      />
      {label && (
        <text x={midX + labelOffX} y={midY + labelOffY} fill={COLORS.textDim} fontSize="8" textAnchor="middle" dominantBaseline="middle">
          {label}
        </text>
      )}
    </g>
  );
}

// ─── Stage badge ───
function StageBadge({ x, y, number, label, color }) {
  return (
    <g>
      <rect x={x - 52} y={y - 13} width="104" height="26" rx="13" fill={color + "22"} stroke={color} strokeWidth="1" />
      <circle cx={x - 38} cy={y} r="9" fill={color} />
      <text x={x - 38} y={y + 0.5} fill="#0a0e1a" fontSize="9" fontWeight="700" textAnchor="middle" dominantBaseline="middle">{number}</text>
      <text x={x + 8} y={y + 0.5} fill={color} fontSize="8.5" fontWeight="600" textAnchor="middle" dominantBaseline="middle">{label}</text>
    </g>
  );
}

// ─── Box component ───
function Box({ x, y, w, h, title, children, color = COLORS.blue, active = false }) {
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx="8" fill={COLORS.surface} stroke={active ? color : COLORS.border} strokeWidth={active ? 1.5 : 1} />
      {title && (
        <>
          <rect x={x} y={y} width={w} height="24" rx="8" fill={color + "18"} />
          <rect x={x} y={y + 16} width={w} height="8" fill={color + "18"} />
          <text x={x + 10} y={y + 15} fill={color} fontSize="8.5" fontWeight="600">{title}</text>
        </>
      )}
      {children}
    </g>
  );
}

// ─── Code snippet text block ───
function CodeBlock({ x, y, lines, color = COLORS.textDim }) {
  return lines.map((line, i) => (
    <text key={i} x={x} y={y + i * 11} fill={line.highlight ? COLORS.green : color} fontSize="7" fontFamily="'JetBrains Mono', 'Fira Code', monospace">
      {line.text}
    </text>
  ));
}

// ─── Main Diagram ───
export default function CollectorFlowDiagram() {
  const [activeStage, setActiveStage] = useState(0);
  const [tick, setTick] = useState(0);
  const svgRef = useRef(null);

  useEffect(() => {
    const interval = setInterval(() => setTick(t => t + 1), 600);
    return () => clearInterval(interval);
  }, []);

  // Particle positions cycling along flow paths
  const particles = [];
  const paths = [
    // Stage 1 arrows
    { x1: 230, y1: 108, x2: 340, y2: 108 },
    { x1: 230, y1: 108, x2: 340, y2: 148 },
    { x1: 230, y1: 108, x2: 340, y2: 188 },
    // Stage 1 → 2 connector
    { x1: 510, y1: 150, x2: 590, y2: 150 },
    // Stage 2 → modules
    { x1: 720, y1: 108, x2: 830, y2: 108 },
    { x1: 720, y1: 148, x2: 830, y2: 148 },
    // Stage 2 → 3 connector
    { x1: 950, y1: 148, x2: 1020, y2: 148 },
    // Stage 3 → DB
    { x1: 1150, y1: 108, x2: 1230, y2: 108 },
    { x1: 1150, y1: 148, x2: 1230, y2: 148 },
    { x1: 1150, y1: 188, x2: 1230, y2: 188 },
  ];

  paths.forEach((p, i) => {
    const count = 2;
    for (let j = 0; j < count; j++) {
      const progress = ((tick * 0.08 + j / count + i * 0.3) % 1);
      const px = p.x1 + (p.x2 - p.x1) * progress;
      const py = p.y1 + (p.y2 - p.y1) * progress;
      const colors = [COLORS.blue, COLORS.green, COLORS.cyan, COLORS.amber, COLORS.purple];
      particles.push(
        <Particle key={`p-${i}-${j}`} x={px} y={py} color={colors[i % colors.length]} opacity={0.7} size={2} />
      );
    }
  });

  const stages = [
    { label: "Discovery", desc: "moduleLoader scans the modules/ directory, reads each manifest.json, and dynamically imports index.js. Valid modules are stored in a Map keyed by their manifest id." },
    { label: "Startup", desc: "collectorManager iterates loaded modules. It gates on three checks: dataCollection capability, collector.enabled, and presence of a start() method. Passing modules are started." },
    { label: "Collect & Store", desc: "The module's collector polls device APIs on a timer, routes each response to a type-specific store method, and INSERTs rows into the database. The gap: homewizard_energy_snapshots is not yet written to." },
  ];

  return (
    <div style={{ background: COLORS.bg, minHeight: "100vh", padding: "28px 20px", fontFamily: "'Inter', sans-serif", color: COLORS.text }}>
      {/* Title */}
      <div style={{ textAlign: "center", marginBottom: 8 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: COLORS.textBright, margin: 0, letterSpacing: "-0.5px" }}>
          WattsOn — Collector Data Flow
        </h1>
        <p style={{ fontSize: 11, color: COLORS.textDim, margin: "4px 0 0", letterSpacing: "0.5px", textTransform: "uppercase" }}>
          moduleLoader → collectorManager → HomeWizard Collector → MariaDB
        </p>
      </div>

      {/* Stage selector pills */}
      <div style={{ display: "flex", justifyContent: "center", gap: 8, marginBottom: 16 }}>
        {["1  Discovery", "2  Startup", "3  Collect & Store"].map((s, i) => (
          <button
            key={i}
            onClick={() => setActiveStage(i)}
            style={{
              background: activeStage === i ? [COLORS.blue, COLORS.green, COLORS.amber][i] + "22" : COLORS.surface,
              border: `1px solid ${activeStage === i ? [COLORS.blue, COLORS.green, COLORS.amber][i] : COLORS.border}`,
              color: activeStage === i ? [COLORS.blue, COLORS.green, COLORS.amber][i] : COLORS.textDim,
              borderRadius: 20,
              padding: "5px 14px",
              fontSize: 11,
              fontWeight: 600,
              cursor: "pointer",
              transition: "all 0.2s",
              letterSpacing: "0.3px",
            }}
          >
            {s}
          </button>
        ))}
      </div>

      {/* Description panel */}
      <div style={{
        background: COLORS.surface,
        border: `1px solid ${COLORS.border}`,
        borderRadius: 10,
        padding: "10px 16px",
        marginBottom: 18,
        maxWidth: 900,
        margin: "0 auto 18px",
        minHeight: 42,
        display: "flex",
        alignItems: "center",
        gap: 10,
      }}>
        <span style={{
          background: [COLORS.blue, COLORS.green, COLORS.amber][activeStage],
          color: "#0a0e1a",
          borderRadius: "50%",
          width: 22,
          height: 22,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 11,
          fontWeight: 700,
          flexShrink: 0,
        }}>{activeStage + 1}</span>
        <span style={{ fontSize: 11.5, color: COLORS.text, lineHeight: 1.5 }}>{stages[activeStage].desc}</span>
      </div>

      {/* Main SVG Diagram */}
      <div style={{ overflowX: "auto", display: "flex", justifyContent: "center" }}>
        <svg ref={svgRef} viewBox="0 0 1400 260" style={{ width: "100%", maxWidth: 1400, height: "auto" }}>
          {/* Subtle background regions per stage */}
          <rect x="10" y="50" width="570" height="210" rx="12" fill={activeStage === 0 ? COLORS.blue + "06" : "transparent"} stroke={activeStage === 0 ? COLORS.blue + "20" : "transparent"} strokeWidth="1" />
          <rect x="590" y="50" width="370" height="210" rx="12" fill={activeStage === 1 ? COLORS.green + "06" : "transparent"} stroke={activeStage === 1 ? COLORS.green + "20" : "transparent"} strokeWidth="1" />
          <rect x="970" y="50" width="420" height="210" rx="12" fill={activeStage === 2 ? COLORS.amber + "06" : "transparent"} stroke={activeStage === 2 ? COLORS.amber + "20" : "transparent"} strokeWidth="1" />

          {/* Stage labels */}
          <StageBadge x={155} y={68} number="1" label="DISCOVERY" color={COLORS.blue} />
          <StageBadge x={775} y={68} number="2" label="STARTUP" color={COLORS.green} />
          <StageBadge x={1180} y={68} number="3" label="COLLECT & STORE" color={COLORS.amber} />

          {/* ══════════════════════════════════════════════════ */}
          {/* STAGE 1: moduleLoader                              */}
          {/* ══════════════════════════════════════════════════ */}

          {/* moduleLoader box */}
          <Box x={20} y={82} w={200} h={185} title="moduleLoader.js" color={COLORS.blue} active={activeStage === 0}>
            <CodeBlock x={32} y={117} lines={[
              { text: "discoverModules()" },
              { text: "  path.resolve(__dirname," },
              { text: "    '..', 'modules')" },
              { text: "" },
              { text: "  readdirSync()" },
              { text: "  → filter directories" },
              { text: "" },
              { text: "  for each dir:" },
              { text: "    loadModule(name)", highlight: true },
            ]} />
          </Box>

          {/* loadModule detail */}
          <Box x={230} y={82} w={200} h={60} title="loadModule()" color={COLORS.purple} active={activeStage === 0}>
            <CodeBlock x={242} y={107} lines={[
              { text: "  existsSync(manifest.json)" },
              { text: "  existsSync(index.js)" },
              { text: "  import(file://...index.js)", highlight: true },
            ]} />
          </Box>

          {/* Three module outputs */}
          {[
            { name: "homewizard", y: 152, color: COLORS.cyan, caps: "dataCollection ✓" },
            { name: "alphaess-cloud", y: 192, color: COLORS.green, caps: "dataCollection ✓" },
            { name: "solaredge", y: 232, color: COLORS.textDim, caps: "not implemented ✗" },
          ].map((m, i) => (
            <g key={m.name}>
              <rect x={230} y={m.y - 14} width={200} height={28} rx="5" fill={m.color + "12"} stroke={m.color + "44"} strokeWidth="0.8" />
              <circle cx={244} cy={m.y} r={4} fill={m.color} />
              <text x={254} y={m.y - 3} fill={m.color} fontSize="7.5" fontWeight="600">{m.name}</text>
              <text x={254} y={m.y + 7} fill={COLORS.textDim} fontSize="6.5">{m.caps}</text>
            </g>
          ))}

          {/* modules.set(id, module) */}
          <rect x={440} y={112} width={130} height={76} rx="6" fill={COLORS.purpleDim + "66"} stroke={COLORS.purple + "44"} strokeWidth="0.8" />
          <text x={450} y={130} fill={COLORS.purple} fontSize="7" fontWeight="600">Map modules</text>
          <CodeBlock x={450} y={143} lines={[
            { text: "modules.set(" },
            { text: "  id, module" },
            { text: ")", highlight: true },
          ]} />

          {/* Arrows stage 1 */}
          <FlowArrow x1={220} y1={108} x2={228} y2={108} color={COLORS.blue} />
          <FlowArrow x1={220} y1={108} x2={228} y2={148} color={COLORS.blue} />
          <FlowArrow x1={220} y1={108} x2={228} y2={188} color={COLORS.blue} />
          <FlowArrow x1={430} y1={108} x2={438} y2={140} color={COLORS.purple} />
          <FlowArrow x1={430} y1={148} x2={438} y2={155} color={COLORS.purple} />
          <FlowArrow x1={430} y1={188} x2={438} y2={175} color={COLORS.textDim} />

          {/* Stage 1→2 connector */}
          <FlowArrow x1={572} y1={150} x2={598} y2={150} color={COLORS.blue} label="modules Map" />

          {/* ══════════════════════════════════════════════════ */}
          {/* STAGE 2: collectorManager                          */}
          {/* ══════════════════════════════════════════════════ */}

          <Box x={598} y={82} w={180} h={185} title="collectorManager.js" color={COLORS.green} active={activeStage === 1}>
            <CodeBlock x={610} y={117} lines={[
              { text: "startAll(modules)" },
              { text: "" },
              { text: "for each module:" },
              { text: "  ① capabilities" },
              { text: "     .dataCollection?" },
              { text: "  ② collector.enabled" },
              { text: "     !== false?" },
              { text: "  ③ typeof start" },
              { text: "     === 'function'?", highlight: true },
            ]} />
          </Box>

          {/* Gate checks */}
          {[
            { label: "① dataCollection", y: 100, pass: true },
            { label: "② collector.enabled", y: 124, pass: true },
            { label: "③ start() exists", y: 148, pass: true },
          ].map((g, i) => (
            <g key={i}>
              <rect x={790} y={g.y - 10} width={148} height={20} rx="4" fill={g.pass ? COLORS.greenDim : COLORS.redDim} stroke={g.pass ? COLORS.green + "55" : COLORS.red + "55"} strokeWidth="0.7" />
              <text x={802} y={g.y + 3} fill={g.pass ? COLORS.green : COLORS.red} fontSize="7">{g.pass ? "✓" : "✗"} {g.label}</text>
            </g>
          ))}

          {/* module.start() call box */}
          <rect x={790} y={168} width={148} height={34} rx="5" fill={COLORS.green + "16"} stroke={COLORS.green + "44"} strokeWidth="0.8" />
          <text x={802} y={183} fill={COLORS.green} fontSize="7.5" fontWeight="600">module.start()</text>
          <text x={802} y={195} fill={COLORS.textDim} fontSize="6.5">→ collector.start()</text>

          {/* Arrows stage 2 */}
          <FlowArrow x1={778} y1={108} x2={788} y2={100} color={COLORS.green} />
          <FlowArrow x1={778} y1={140} x2={788} y2={124} color={COLORS.green} />
          <FlowArrow x1={778} y1={150} x2={788} y2={148} color={COLORS.green} />
          <FlowArrow x1={778} y1={160} x2={788} y2={178} color={COLORS.green} />

          {/* Stage 2→3 connector */}
          <FlowArrow x1={940} y1={150} x2={978} y2={150} color={COLORS.green} label="start()" />

          {/* ══════════════════════════════════════════════════ */}
          {/* STAGE 3: Collect & Store                           */}
          {/* ══════════════════════════════════════════════════ */}

          <Box x={980} y={82} w={180} h={185} title="HomeWizardCollector" color={COLORS.amber} active={activeStage === 2}>
            <CodeBlock x={992} y={117} lines={[
              { text: "start()" },
              { text: "  loadDevices()" },
              { text: "  setInterval(5s)" },
              { text: "" },
              { text: "collect()" },
              { text: "  Promise.allSettled(", highlight: true },
              { text: "    devices.map(" },
              { text: "      collectFromDevice" },
              { text: "    ))" },
            ]} />
          </Box>

          {/* Device fetch */}
          <rect x={1172} y={84} width={150} height={38} rx="5" fill={COLORS.cyanDim + "66"} stroke={COLORS.cyan + "44"} strokeWidth="0.8" />
          <text x={1184} y={100} fill={COLORS.cyan} fontSize="7.5" fontWeight="600">fetch() Device API</text>
          <text x={1184} y={113} fill={COLORS.textDim} fontSize="6.5">http://ip/api/v1/data</text>

          {/* Route by type */}
          <rect x={1172} y={128} width={150} height={26} rx="5" fill={COLORS.amber + "16"} stroke={COLORS.amber + "44"} strokeWidth="0.8" />
          <text x={1184} y={145} fill={COLORS.amber} fontSize="7">Route by product_type</text>

          {/* DB insert */}
          <rect x={1172} y={160} width={150} height={48} rx="5" fill={COLORS.greenDim + "66"} stroke={COLORS.green + "44"} strokeWidth="0.8" />
          <text x={1184} y={177} fill={COLORS.green} fontSize="7.5" fontWeight="600">INSERT INTO DB</text>
          <CodeBlock x={1184} y={188} lines={[
            { text: "homewizard_data ✓" },
            { text: "energy_snapshots ✗ ← GAP", highlight: false },
          ]} color={COLORS.textDim} />
          {/* Gap indicator */}
          <text x={1184} y={200} fill={COLORS.red} fontSize="6.5" fontWeight="600">⚠ not written yet</text>

          {/* Arrows stage 3 */}
          <FlowArrow x1={1160} y1={108} x2={1170} y2={103} color={COLORS.cyan} />
          <FlowArrow x1={1160} y1={145} x2={1170} y2={141} color={COLORS.amber} />
          <FlowArrow x1={1160} y1={165} x2={1170} y2={175} color={COLORS.green} />

          {/* Animated particles */}
          {particles}

          {/* Legend */}
          <g opacity="0.7">
            <circle cx={30} cy={252} r={2.5} fill={COLORS.blue} />
            <text x={38} y={254} fill={COLORS.textDim} fontSize="7">Discovery flow</text>
            <circle cx={130} cy={252} r={2.5} fill={COLORS.green} />
            <text x={138} y={254} fill={COLORS.textDim} fontSize="7">Startup flow</text>
            <circle cx={220} cy={252} r={2.5} fill={COLORS.amber} />
            <text x={228} y={254} fill={COLORS.textDim} fontSize="7">Collection flow</text>
            <circle cx={320} cy={252} r={2.5} fill={COLORS.red} />
            <text x={328} y={254} fill={COLORS.textDim} fontSize="7">Known gap</text>
          </g>
        </svg>
      </div>

      {/* Bottom detail cards */}
      <div style={{ display: "flex", gap: 12, maxWidth: 1100, margin: "18px auto 0", flexWrap: "wrap", justifyContent: "center" }}>
        {[
          {
            title: "moduleLoader.js",
            color: COLORS.blue,
            items: [
              "path.resolve(__dirname, '..', 'modules') — finds modules/ dir",
              "readdirSync → filters directories only",
              "Reads manifest.json with fs.readFileSync + JSON.parse",
              "Dynamic import() via file:// URL for index.js",
              "Attaches manifest to default export → stores in Map",
            ]
          },
          {
            title: "collectorManager.js",
            color: COLORS.green,
            items: [
              "Iterates the modules Map from moduleLoader",
              "Gate 1: manifest.capabilities.dataCollection === true",
              "Gate 2: manifest.collector.enabled !== false",
              "Gate 3: typeof module.start === 'function'",
              "Calls module.start() → delegates to collector.start()",
            ]
          },
          {
            title: "HomeWizard Collector",
            color: COLORS.amber,
            items: [
              "loadDevices() queries device_settings WHERE module='homewizard'",
              "setInterval(5s) → collect() on each tick",
              "Promise.allSettled polls all devices in parallel",
              "Routes by product_type: P1 / SKT / KWH1 / KWH3",
              "INSERTs into homewizard_data — but NOT energy_snapshots ⚠",
            ]
          },
        ].map((card, i) => (
          <div key={i} style={{
            flex: "1 1 280px",
            maxWidth: 340,
            background: COLORS.surface,
            border: `1px solid ${card.color}33`,
            borderRadius: 10,
            padding: "12px 14px",
            borderTop: `2px solid ${card.color}`,
          }}>
            <div style={{ color: card.color, fontSize: 11, fontWeight: 700, marginBottom: 8, letterSpacing: "0.3px" }}>{card.title}</div>
            {card.items.map((item, j) => (
              <div key={j} style={{
                fontSize: 10.5,
                color: item.includes("⚠") ? COLORS.red : COLORS.textDim,
                padding: "3px 0",
                borderBottom: j < card.items.length - 1 ? `1px solid ${COLORS.border}` : "none",
                display: "flex",
                alignItems: "flex-start",
                gap: 6,
              }}>
                <span style={{ color: card.color, marginTop: 1, flexShrink: 0 }}>›</span>
                <span>{item}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}