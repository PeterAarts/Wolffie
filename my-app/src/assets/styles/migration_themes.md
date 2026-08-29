# Dark theme migration — remaining steps

Four files are drop-in replacements: `theme.js`, `themes.css` (new),
`main.css`, `control.css`. Everything below is what those four can't reach.

---

## 1. Set the theme before Vue mounts

Without this you get a flash of the default light theme on every load.
In `src/main.js`, **before** `createApp(...).mount()`:

```js
import { readStoredPreset, setDocumentTheme } from '@/stores/theme';
setDocumentTheme(readStoredPreset());
```

Both are plain exports, no Pinia instance needed. `applyPreset()` later is
idempotent.

`readStoredPreset()` also migrates the old localStorage payload: the previous
store wrote a JSON object, the new one writes a bare key string. Existing
users keep their theme, no reset.

---

## 2. Verify the preset picker

**Assumption — I haven't seen this component.** The screenshot shows preset
buttons rendered from `field.component === 'color'`, presumably iterating
`THEME_PRESETS` and reading `.label` plus the two swatch colours.

The new registry keeps `label` but replaces `primaryColor` / `secondaryColor`
with `swatch: ['#hex', '#hex']`. If the picker reads the old key names the
swatches will render empty. Either point it at `preset.swatch[0]` /
`preset.swatch[1]`, or tell me the component path and I'll adjust.

`dark: true|false` is also on each entry now, if you want a moon/sun marker.

---

## 3. Delete the dead dashboards

```
src/views/Dashboard_fout.vue
src/views/Dashboard_v1.vue
src/views/Dashboard_v2.vue
```

~90 of the ~200 grep hits. Confirm nothing routes to them first.

---

## 4. Undefined variables in `StrategyPanel.vue`

Three `var()` calls reference tokens that have never existed anywhere —
they resolve to nothing, with no fallback. Typos for `--color-secondary-*`:

| Line | Wrong | Correct |
|---|---|---|
| 1025 | `--color-bg-secondary-50` | `--color-secondary-50` |
| 1025 | `--color-bg-secondary-500` | `--color-secondary-500` |
| 1109 | `--color-bg-secondary-100` | `--color-secondary-100` |

---

## 5. Hardcoded surfaces

Substitute the token, no other change:

| File | Line | Replace |
|---|---|---|
| `AppDrawer.vue` | 90 | `background-color: #FFF` → `var(--card-bg-color)` |
| `AppTable.vue` | 153, 248, 265 | `background: #fff` → `var(--card-bg-color)` |
| `AppTable.vue` | 278 | `color: #fff` → `var(--color-on-accent)` |
| `DispatchPanel.vue` | 301 | `background: #fff` → `var(--card-bg-color)`; `color: #6b7280` → `var(--color-text-secondary)` |
| `collectorStatus.vue` | 247 | `background: #fff` → `var(--card-bg-color)` |
| `LoggingTab.vue` | 248 | `background: #fff` → `var(--card-bg-color)` |
| `energyGauge.vue` | 101 | `var(--color-card, #fff)` → `var(--card-bg-color)` (the alias now exists either way) |
| `EnergyFlowDiagram.vue` | 457 | `fill: #fff` → `var(--card-bg-color)` |
| `StrategyPanel.vue` | 1215 | `background: #fff` → `var(--card-bg-color)`; `color: #374151` → `var(--color-text-primary)` |
| `StrategyPanel.vue` | 1220, `AlertDrawer.vue` 364, `AppModal.vue` 142, `Login.vue` 189, `UserSettings.vue` 325, `MainLayout.vue` 390 | `color: #fff` → `var(--color-on-accent)` |
| `DashboardGraph.vue` | 305 | `var(--color-text-primary, #111827)` bg + `#fff` text → `var(--color-primary)` + `var(--color-on-accent)` |
| `EnergyFlowGraph.vue` | 630, `SmartDeviceFlowGraph.vue` 255 | same as above |
| `SliderField.vue` | 101, 109 | `border: 2px solid #fff` → `var(--card-bg-color)` |

**Leave alone** — these sit on a saturated fixed fill and are correctly white:
`AlertDrawer.vue:290` (red badge), `ToastList.vue:95`, `SdkView.vue:276–280`.

---

## 6. Inline tooltips

`EnergyFlowGraph.vue:38` and `SmartDeviceFlowGraph.vue:36` have the tooltip
styling inline in the template, duplicating the `.chart-html-tooltip` class.
Delete the `style="..."` attribute and add `class="chart-html-tooltip"` —
`main.css` now defines it with themed tokens. Then remove the duplicate rule
at `EnergyFlowGraph.vue:613`.

---

## 7. Chart.js colours

`DayAheadChart.vue:569`, `StrategyChart.vue:277, 293` pass `'#ffffff'` as
JS values. Chart.js can't read CSS vars, so resolve at build time:

```js
const css = getComputedStyle(document.documentElement);
const surface = css.getPropertyValue('--card-bg-color').trim();
```

Charts won't restyle on theme switch unless you re-run this. If that matters,
watch `themeStore.activePreset` and call `chart.update()`.

---

## 8. Dead Tailwind v3 syntax

`CommissioningModal.vue:5` — `bg-opacity-75` was removed in v4. Use
`bg-secondary-900/75`. (Also worth checking: that's a modal scrim, and on
dark themes `secondary-900` is near-white. `bg-black/60` is probably what
you actually want there.)

---

## Two things I changed that you may want to revert

- **Ocean's card colour.** The old preset had the card (`#e2e8f0`) *darker*
  than the page (`#f1f5f9`), so cards sank instead of lifting. Normalised to
  a tinted page with a white card. Swap `--card-bg-color` back if it was
  deliberate.

- **Solar Flare's ramp is neutral slate, not amber.** The old preset fed
  `#f59e0b` into the ramp, and the ramp drives body text and borders — so it
  was amber text on white. Amber now lives in `--color-accent`, and
  `--color-solar` already carried it for the energy charts. The theme's
  identity comes from the navy ink and the 1rem radius instead. This is the
  one place where the static approach exposed something the generator was
  hiding rather than fixing it — if you want amber to actually show up, it
  needs to be applied to specific elements, not the scale.