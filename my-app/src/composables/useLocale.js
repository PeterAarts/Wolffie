// src/composables/useLocale.js
// Composable for language switching - integrates with settings store and vue-i18n
import { computed, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useSettingsStore } from '../stores/settings';
import { availableLanguages } from '../i18n';

export function useLocale() {
  const { locale, t, n, d } = useI18n();
  const settingsStore = useSettingsStore();

  // Current language as computed (reads from i18n, writes to both i18n + store)
  const currentLanguage = computed({
    get: () => locale.value,
    set: (lang) => setLanguage(lang),
  });

  // Available languages for dropdowns
  const languages = availableLanguages;

  // Current language object (for showing flag/label)
  const currentLanguageInfo = computed(() =>
    languages.find(l => l.code === locale.value) || languages[0]
  );

  /**
   * Switch language — updates i18n, settings store, localStorage, and HTML lang
   */
  function setLanguage(lang) {
    if (!languages.some(l => l.code === lang)) {
      console.warn(`Language "${lang}" not available, falling back to "en"`);
      lang = 'en';
    }

    // Update vue-i18n
    locale.value = lang;

    // Update settings store (persists to localStorage)
    settingsStore.updateDisplaySettings({ language: lang });

    // Update HTML lang attribute (accessibility + SEO)
    document.documentElement.lang = lang;

    console.log(`🌐 Language switched to: ${lang}`);
  }

  // Keep i18n in sync if settings store changes externally
  watch(
    () => settingsStore.displaySettings.language,
    (newLang) => {
      if (newLang && newLang !== locale.value) {
        locale.value = newLang;
        document.documentElement.lang = newLang;
      }
    }
  );

  // --- Locale-aware energy formatting helpers ---

  /**
   * Format power value with locale-aware number formatting
   * Examples: "1.234 W", "3,5 kW" (Dutch/German use comma)
   */
  function formatLocalePower(watts) {
    if (watts === null || watts === undefined || isNaN(watts)) return `0 ${t('units.watt')}`;

    const abs = Math.abs(watts);
    if (abs >= 1000) {
      return `${n(watts / 1000, 'energy')} ${t('units.kilowatt')}`;
    }
    return `${n(watts, 'power')} ${t('units.watt')}`;
  }

  /**
   * Format energy value with locale-aware number formatting
   * Examples: "10.22 kWh", "0,37 kWh" (Dutch/German)
   */
  function formatLocaleEnergy(wattHours) {
    if (wattHours === null || wattHours === undefined || isNaN(wattHours)) return `0 ${t('units.kilowattHour')}`;

    const abs = Math.abs(wattHours);
    if (abs >= 1000000) {
      return `${n(wattHours / 1000000, 'energy')} ${t('units.megawattHour')}`;
    }
    if (abs >= 1000) {
      return `${n(wattHours / 1000, 'energy')} ${t('units.kilowattHour')}`;
    }
    return `${n(wattHours, 'power')} ${t('units.wattHour')}`;
  }

  /**
   * Format percentage with locale-aware decimal separator
   */
  function formatLocalePercent(value, decimals = 1) {
    if (value === null || value === undefined || isNaN(value)) return `0${t('units.percent')}`;
    return `${n(value, 'decimal')}${t('units.percent')}`;
  }

  return {
    // Language control
    currentLanguage,
    currentLanguageInfo,
    languages,
    setLanguage,

    // i18n core (re-exported for convenience)
    t,
    n,
    d,

    // Locale-aware energy formatters
    formatLocalePower,
    formatLocaleEnergy,
    formatLocalePercent,
  };
}