// src/i18n/index.js
// Vue-i18n setup for WattsOn
import { createI18n } from 'vue-i18n';

// Import locale files
import en from './locales/en.json';
import nl from './locales/nl.json';
import de from './locales/de.json';
import fr from './locales/fr.json';
import da from './locales/da.json';
import es from './locales/es.json';

// Number formatting per locale (affects energy value display)
const numberFormats = {
  en: {
    decimal: { minimumFractionDigits: 2, maximumFractionDigits: 2 },
    power:   { minimumFractionDigits: 0, maximumFractionDigits: 0 },
    energy:  { minimumFractionDigits: 2, maximumFractionDigits: 2 },
    percent: { style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1 },
  },
  nl: {
    decimal: { minimumFractionDigits: 2, maximumFractionDigits: 2 },
    power:   { minimumFractionDigits: 0, maximumFractionDigits: 0 },
    energy:  { minimumFractionDigits: 2, maximumFractionDigits: 2 },
    percent: { style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1 },
  },
  de: {
    decimal: { minimumFractionDigits: 2, maximumFractionDigits: 2 },
    power:   { minimumFractionDigits: 0, maximumFractionDigits: 0 },
    energy:  { minimumFractionDigits: 2, maximumFractionDigits: 2 },
    percent: { style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1 },
  },
  fr: {
    decimal: { minimumFractionDigits: 2, maximumFractionDigits: 2 },
    power:   { minimumFractionDigits: 0, maximumFractionDigits: 0 },
    energy:  { minimumFractionDigits: 2, maximumFractionDigits: 2 },
    percent: { style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1 },
  },
  da: {
    decimal: { minimumFractionDigits: 2, maximumFractionDigits: 2 },
    power:   { minimumFractionDigits: 0, maximumFractionDigits: 0 },
    energy:  { minimumFractionDigits: 2, maximumFractionDigits: 2 },
    percent: { style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1 },
  },
  es: {
    decimal: { minimumFractionDigits: 2, maximumFractionDigits: 2 },
    power:   { minimumFractionDigits: 0, maximumFractionDigits: 0 },
    energy:  { minimumFractionDigits: 2, maximumFractionDigits: 2 },
    percent: { style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1 },
  },
};

// Datetime formatting per locale
const datetimeFormats = {
  en: {
    short:    { year: 'numeric', month: '2-digit', day: '2-digit' },
    long:     { year: 'numeric', month: 'long', day: 'numeric' },
    time:     { hour: '2-digit', minute: '2-digit', hour12: false },
    datetime: { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false },
  },
  nl: {
    short:    { year: 'numeric', month: '2-digit', day: '2-digit' },
    long:     { year: 'numeric', month: 'long', day: 'numeric' },
    time:     { hour: '2-digit', minute: '2-digit', hour12: false },
    datetime: { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false },
  },
  de: {
    short:    { year: 'numeric', month: '2-digit', day: '2-digit' },
    long:     { year: 'numeric', month: 'long', day: 'numeric' },
    time:     { hour: '2-digit', minute: '2-digit', hour12: false },
    datetime: { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false },
  },
  fr: {
    short:    { year: 'numeric', month: '2-digit', day: '2-digit' },
    long:     { year: 'numeric', month: 'long', day: 'numeric' },
    time:     { hour: '2-digit', minute: '2-digit', hour12: false },
    datetime: { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false },
  },
  da: {
    short:    { year: 'numeric', month: '2-digit', day: '2-digit' },
    long:     { year: 'numeric', month: 'long', day: 'numeric' },
    time:     { hour: '2-digit', minute: '2-digit', hour12: false },
    datetime: { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false },
  },
  es: {
    short:    { year: 'numeric', month: '2-digit', day: '2-digit' },
    long:     { year: 'numeric', month: 'long', day: 'numeric' },
    time:     { hour: '2-digit', minute: '2-digit', hour12: false },
    datetime: { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false },
  },
};

// Resolve initial locale: localStorage > browser > fallback
function getInitialLocale() {
  // 1. Check localStorage (user's explicit choice)
  const stored = localStorage.getItem('language');
  if (stored && ['en', 'nl', 'de', 'fr', 'da', 'es'].includes(stored)) {
    return stored;
  }

  // 2. Check browser language
  const browserLang = navigator.language?.split('-')[0];
  if (browserLang && ['en', 'nl', 'de', 'fr', 'da', 'es'].includes(browserLang)) {
    return browserLang;
  }

  // 3. Fallback
  return 'en';
}

const i18n = createI18n({
  legacy: false,                    // Use Composition API mode
  locale: getInitialLocale(),
  fallbackLocale: 'en',
  messages: { en, nl, de, fr, da, es },
  numberFormats,
  datetimeFormats,
  missingWarn: false,               // Suppress console warnings in production
  fallbackWarn: false,
});

export default i18n;

// Export available languages for the settings UI
export const availableLanguages = [
  { code: 'en', label: 'English',    flag: '🇬🇧' },
  { code: 'nl', label: 'Nederlands', flag: '🇳🇱' },
  { code: 'de', label: 'Deutsch',    flag: '🇩🇪' },
  { code: 'fr', label: 'Français',   flag: '🇫🇷' },
  { code: 'da', label: 'Dansk',      flag: '🇩🇰' },
  { code: 'es', label: 'Español',    flag: '🇪🇸' },
  { code: 'se', label: 'Svenska',    flag: '🇸🇪' },
  { code: 'nk', label: 'Norsk',      flag: '🇳🇴' },
  { code: 'fi', label: 'Suomi',      flag: '🇫🇮' },
];