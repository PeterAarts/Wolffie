// src/stores/theme.js
import { defineStore } from 'pinia';
import { ref, watch } from 'vue';

// ── Named presets ─────────────────────────────────────────────────────────────
export const THEME_PRESETS = {
  default: {
    label:           'Default',
    primaryColor:    '#0a0a0a',
    secondaryColor:  '#6b7280',
    backgroundColor: '#f1f5f9',
    borderRadius:    '0px',
  },
  blue: {
    label:           'Blue',
    primaryColor:    '#003d73',   // darker than #00529c
    secondaryColor:  '#08a9ce',
    backgroundColor: '#f1f5f9',
    borderRadius:    '0px',
  },
};

const DEFAULTS = THEME_PRESETS.default;
const STORAGE_KEY = 'wolffie_theme';

// ── Color math ────────────────────────────────────────────────────────────────
function hexToHsl(hex) {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h, s, l = (max + min) / 2;
  if (max === min) { h = s = 0; }
  else {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
      case g: h = ((b - r) / d + 2) / 6; break;
      case b: h = ((r - g) / d + 4) / 6; break;
    }
  }
  return { h: Math.round(h * 360), s: Math.round(s * 100), l: Math.round(l * 100) };
}

function hsl(h, s, l) {
  return `hsl(${h}, ${s}%, ${Math.min(Math.max(l, 0), 97)}%)`;
}

function radiusScale(base) {
  const px = parseInt(base) || 0;
  if (px === 0) return { sm: '0px', md: '0px', lg: '0px', xl: '0px', '2xl': '0px' };
  return {
    sm:    `${Math.round(px * 0.5)}px`,
    md:    `${px}px`,
    lg:    `${Math.round(px * 1.5)}px`,
    xl:    `${Math.round(px * 2)}px`,
    '2xl': `${Math.round(px * 3)}px`,
  };
}

// ── Store ─────────────────────────────────────────────────────────────────────
export const useThemeStore = defineStore('theme', () => {
  const saved = (() => {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); }
    catch { return {}; }
  })();

  const primaryColor    = ref(saved.primaryColor    ?? DEFAULTS.primaryColor);
  const secondaryColor  = ref(saved.secondaryColor  ?? DEFAULTS.secondaryColor);
  const backgroundColor = ref(saved.backgroundColor ?? DEFAULTS.backgroundColor);
  const borderRadius    = ref(saved.borderRadius    ?? DEFAULTS.borderRadius);
  const activePreset    = ref(saved.activePreset    ?? 'default');

  function applyTheme() {
    const root = document.documentElement;
    const sec  = hexToHsl(secondaryColor.value);
    const r    = radiusScale(borderRadius.value);

    // ── Primary ───────────────────────────────────────────────────────────────
    root.style.setProperty('--color-primary',      primaryColor.value);
    root.style.setProperty('--color-text-primary',  primaryColor.value);
    root.style.setProperty('--color-data-primary',  primaryColor.value);
    root.style.setProperty('--color-bg-dark',       primaryColor.value);
    root.style.setProperty('--color-bg-black',      primaryColor.value);

    // ── Secondary scale ───────────────────────────────────────────────────────
    // These MUST match the @theme names in main.css so Tailwind's generated
    // classes (.bg-secondary-100 etc.) pick up the runtime values.
    const s50  = hsl(sec.h, sec.s, sec.l + 44);  // lightest tint
    const s100 = hsl(sec.h, sec.s, sec.l + 40);  // panel backgrounds
    const s200 = hsl(sec.h, sec.s, sec.l + 28);  // borders, dividers
    const s300 = hsl(sec.h, sec.s, sec.l + 14);  // hover borders
    const s400 = secondaryColor.value;             // base / labels

    root.style.setProperty('--color-secondary-50',  s50);
    root.style.setProperty('--color-secondary-100', s100);
    root.style.setProperty('--color-secondary-200', s200);
    root.style.setProperty('--color-secondary-300', s300);
    root.style.setProperty('--color-secondary-400', s400);

    // Keep legacy aliases in sync for any remaining CSS var references
    root.style.setProperty('--color-secondary',         s400);
    root.style.setProperty('--color-secondary-subtle',  s100);
    root.style.setProperty('--color-secondary-muted',   s200);
    root.style.setProperty('--color-secondary-hover',   s300);
    root.style.setProperty('--color-text-secondary',    s400);
    root.style.setProperty('--color-data-secondary',    s400);
    root.style.setProperty('--color-text-tertiary',     hsl(sec.h, sec.s, sec.l + 20));
    root.style.setProperty('--color-border',            s200);
    root.style.setProperty('--color-border-dark',       s300);
    root.style.setProperty('--color-bg-secondary',      s100);

    // ── Background ───────────────────────────────────────────────────────────
    root.style.setProperty('--color-background',  backgroundColor.value);
    root.style.setProperty('--color-bg-primary',  backgroundColor.value);

    // ── Border radius scale ───────────────────────────────────────────────────
    root.style.setProperty('--radius-sm',     r.sm);
    root.style.setProperty('--radius-md',     r.md);
    root.style.setProperty('--radius-lg',     r.lg);
    root.style.setProperty('--radius-xl',     r.xl);
    root.style.setProperty('--radius-2xl',    r['2xl']);
    root.style.setProperty('--border-radius', borderRadius.value);

    persist();
  }

  function applyPreset(presetKey) {
    const preset = THEME_PRESETS[presetKey];
    if (!preset) return;
    primaryColor.value    = preset.primaryColor;
    secondaryColor.value  = preset.secondaryColor;
    backgroundColor.value = preset.backgroundColor;
    borderRadius.value    = preset.borderRadius;
    activePreset.value    = presetKey;
    applyTheme();
  }

  function resetToDefaults() {
    applyPreset('default');
  }

  function persist() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      primaryColor:    primaryColor.value,
      secondaryColor:  secondaryColor.value,
      backgroundColor: backgroundColor.value,
      borderRadius:    borderRadius.value,
      activePreset:    activePreset.value,
    }));
  }

  // Auto-apply whenever any value changes
  watch([primaryColor, secondaryColor, backgroundColor, borderRadius], applyTheme);

  return {
    primaryColor,
    secondaryColor,
    backgroundColor,
    borderRadius,
    activePreset,
    applyTheme,
    applyPreset,
    resetToDefaults,
    PRESETS: THEME_PRESETS,
  };
});