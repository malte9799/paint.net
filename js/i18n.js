// Minimal i18n: English strings are the keys; other languages map them to translations.
// Language comes from Settings ("auto" follows the browser) and is read once at startup.
import { DE } from './lang/de.js';

const LANGS = { de: DE };

function readPref() {
  try { return JSON.parse(localStorage.getItem('pdnweb.settings.v1') || '{}').language || 'auto'; } catch { return 'auto'; }
}
const pref = readPref();
const browserLang = (navigator.languages?.[0] || navigator.language || 'en').toLowerCase().slice(0, 2);
export const lang = pref === 'auto' ? (LANGS[browserLang] ? browserLang : 'en') : LANGS[pref] ? pref : 'en';
document.documentElement.lang = lang;
const dict = LANGS[lang] || null;

export const LANGUAGES = [['auto', 'Automatic (browser language)'], ['en', 'English'], ['de', 'Deutsch']];

function lookup(s) {
  if (s in dict) return dict[s];
  let m;
  if (s.endsWith('…') && s.slice(0, -1) in dict) return dict[s.slice(0, -1)] + '…';
  if (s.endsWith(':') && s.slice(0, -1) in dict) return dict[s.slice(0, -1)] + ':';
  if ((m = /^(.*) \(([^()]*)\)$/.exec(s)) && m[1] in dict) return dict[m[1]] + ' (' + lookup(m[2]) + ')';
  if ((m = /^Repeat (.+)$/.exec(s))) return (dict['Repeat'] || 'Repeat') + ': ' + lookup(m[1]);
  return s;
}

// t('Hello {name}', {name}) → translated string with variables filled in
export function t(s, vars) {
  if (s == null || typeof s !== 'string') return s;
  let out = dict ? lookup(s) : s;
  if (vars) out = out.replace(/\{(\w+)\}/g, (_, k) => (k in vars ? vars[k] : `{${k}}`));
  return out;
}

const KEY_NAMES = {
  de: { Ctrl: 'Strg', Shift: 'Umschalt', Delete: 'Entf', Backspace: 'Rücktaste', PageUp: 'Bild↑', PageDown: 'Bild↓', ArrowUp: 'Pfeil↑', ArrowDown: 'Pfeil↓', Space: 'Leertaste', Enter: 'Eingabe', Esc: 'Esc' },
  en: { ArrowUp: 'Up', ArrowDown: 'Down' },
};
// Localize a shortcut like "Ctrl+Shift+N" for display
export function tKeys(shortcut) {
  if (!shortcut) return '';
  const names = KEY_NAMES[lang] || KEY_NAMES.en;
  return shortcut.split('+').map((p, i, a) => (p === '' && i === a.length - 1 ? '+' : names[p] || p)).join('+').replace(/\+\+$/, '++');
}
