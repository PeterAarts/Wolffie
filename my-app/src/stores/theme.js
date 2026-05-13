// src/stores/theme.js
import { defineStore } from 'pinia';
import apiClient from '@/services/api';
import { ref, watch } from 'vue';

// ── Named presets ─────────────────────────────────────────────────────────────
export const THEME_PRESETS = {
  default: {
    label:           'Default',
    primaryColor:    '#0a0a0a',
    secondaryColor:  '#9ea1a7',
    backgroundColor: '#eef3f8;',
    cardBackgroundColor: '#ffffff',
    borderRadius:    '.5rem',
  },
  olive: {
    label:           'Olive',
    primaryColor:    '#3d3028',
    secondaryColor:  '#948d83',
    backgroundColor: '#f1f5f9',
    cardBackgroundColor: '#ffffff',
    borderRadius:    '0.5rem',
  },
  ocean: {
    label:           'Ocean',
    primaryColor:    '#183e5f',
    secondaryColor:  '#5597d1',
    backgroundColor: '#f1f5f9',
    cardBackgroundColor: '#e2e8f0',
    borderRadius:    '.5rem',
  },
  carbon: {
    label:           'Carbon Forest',
    primaryColor:    '#3c5242', // Deep near-black for text/headers
    secondaryColor:  '#7a9782', // High-energy "glowing" mint for power lines/charts
    backgroundColor: '#1e1e1e', // Dark charcoal background
    borderRadius:    '.5rem',     // Sharp, technical edge
  },
  solar: {
    label:           'Solar Flare',
    primaryColor:    '#0f172a', // Deep Navy
    secondaryColor:  '#f59e0b', // Solar Amber (represents the sun/production)
    backgroundColor: '#f8fafc', // Very light grey (almost white)
    borderRadius:    '1rem',    // Soft, modern mobile-app feel
  },
  midnight: {
    label:           'Midnight Rose',
    primaryColor:    '#471717', // White text for dark mode
    secondaryColor:  '#fb7185', // Soft Rose/Pink (great for discharge/consumption visibility)
    backgroundColor: '#0f0f12', // Pure OLED Black
    borderRadius:    '0.5rem',
  }
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
  let px = parseFloat(base);
  if (base.includes('rem')) px = px * 16;
  px = Math.round(px);
  if (!px || px === 0) return { sm: '0px', md: '0px', lg: '0px', xl: '0px', '2xl': '0px' };
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

  const primaryColor        = ref(saved.primaryColor    ?? DEFAULTS.primaryColor);
  const secondaryColor      = ref(saved.secondaryColor  ?? DEFAULTS.secondaryColor);
  const backgroundColor     = ref(saved.backgroundColor ?? DEFAULTS.backgroundColor);
  const borderRadius        = ref(saved.borderRadius    ?? DEFAULTS.borderRadius);
  const cardBackgroundColor = ref(saved.cardBackgroundColor ?? DEFAULTS.cardBackgroundColor);
  const activePreset        = ref(saved.activePreset    ?? 'default');

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

    // ── Secondary numbered scale (50–900) ─────────────────────────────────────
    // sec.l is the lightness of the 500 stop (the base color itself).
    // Offsets shift lightness up (lighter) or down (darker).
    const s50  = hsl(sec.h, sec.s, sec.l + 42);
    const s100 = hsl(sec.h, sec.s, sec.l + 36);
    const s200 = hsl(sec.h, sec.s, sec.l + 28);
    const s300 = hsl(sec.h, sec.s, sec.l + 18);
    const s400 = hsl(sec.h, sec.s, sec.l +  8);
    const s500 = secondaryColor.value;
    const s600 = hsl(sec.h, sec.s, sec.l - 10);
    const s700 = hsl(sec.h, sec.s, sec.l - 20);
    const s800 = hsl(sec.h, sec.s, sec.l - 30);
    const s900 = hsl(sec.h, sec.s, sec.l - 40);

    root.style.setProperty('--color-secondary-50',  s50);
    root.style.setProperty('--color-secondary-100', s100);
    root.style.setProperty('--color-secondary-200', s200);
    root.style.setProperty('--color-secondary-300', s300);
    root.style.setProperty('--color-secondary-400', s400);
    root.style.setProperty('--color-secondary-500', s500);
    root.style.setProperty('--color-secondary-600', s600);
    root.style.setProperty('--color-secondary-700', s700);
    root.style.setProperty('--color-secondary-800', s800);
    root.style.setProperty('--color-secondary-900', s900);

    // ── Named aliases (used by main.css / control.css) ────────────────────────
    root.style.setProperty('--color-secondary',        s500);
    root.style.setProperty('--color-secondary-subtle', s50);
    root.style.setProperty('--color-secondary-muted',  s200);
    root.style.setProperty('--color-secondary-hover',  s300);
    root.style.setProperty('--color-text-secondary',   s500);
    root.style.setProperty('--color-data-secondary',   s500);
    root.style.setProperty('--color-text-tertiary',    s400);
    root.style.setProperty('--color-border',           s200);
    root.style.setProperty('--color-border-dark',      s300);
    root.style.setProperty('--color-bg-secondary',     s50);

    // ── Background ────────────────────────────────────────────────────────────
    root.style.setProperty('--color-background',  backgroundColor.value);
    root.style.setProperty('--color-bg-primary',  backgroundColor.value);
    root.style.setProperty('--card-bg-color', cardBackgroundColor.value);
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
    cardBackgroundColor.value = preset.cardBackgroundColor;
    borderRadius.value    = preset.borderRadius;
    activePreset.value    = presetKey;
    applyTheme();
    // Persist to server (fire-and-forget) via shared apiClient so the correct
    // base URL, auth token, and session cookie are all applied automatically.
    apiClient.post('/settings/core', { theme: presetKey })
      .catch(err => console.warn('[theme] failed to persist to server:', err));
  }

  async function loadFromServer() {
    try {
      const res  = await apiClient.get('/settings/core');
      const data = res.data;
      const settings = data.settings ?? data;
      const serverPreset = settings.theme ?? settings['system.theme'];
      if (serverPreset && THEME_PRESETS[serverPreset] && serverPreset !== activePreset.value) {
        applyPreset(serverPreset);
      }
    } catch (err) {
      console.warn('[theme] could not load theme from server, using localStorage fallback:', err);
    }
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
      cardBackgroundColor: cardBackgroundColor.value,
      activePreset:    activePreset.value,
    }));
  }

  watch([primaryColor, secondaryColor, backgroundColor, borderRadius], applyTheme);

  return {
    primaryColor,
    secondaryColor,
    backgroundColor,
    cardBackgroundColor,
    borderRadius,
    activePreset,
    applyTheme,
    applyPreset,
    loadFromServer,
    resetToDefaults,
    PRESETS: THEME_PRESETS,
  };
});