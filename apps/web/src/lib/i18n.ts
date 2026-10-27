import { Settings } from 'luxon';
import { en, he, type MessageKey } from './messages';
import { getCurrentLocale } from './user';

export type Locale = 'en' | 'he';
export type { MessageKey };

const catalogs: Record<Locale, Record<string, string>> = { en, he };

// The active language is module state so plain helpers (dates, schedules) can use it too.
// LocaleProvider sets it and remounts the app whenever it changes.
let current: Locale = 'en';

export function getLocale(): Locale {
  return current;
}

export function isRtl(locale: Locale = current) {
  return locale === 'he';
}

export function applyLocale(locale: Locale) {
  current = locale;
  Settings.defaultLocale = intlLocale(locale);
  if (typeof document !== 'undefined') {
    document.documentElement.lang = locale;
    document.documentElement.dir = isRtl(locale) ? 'rtl' : 'ltr';
  }
}

export function intlLocale(locale: Locale = current) {
  return locale === 'he' ? 'he-IL' : 'en-US';
}

export function browserLocale(): Locale {
  if (typeof navigator === 'undefined') return 'en';
  return navigator.languages?.some((l) => /^(he|iw)\b/i.test(l)) ? 'he' : 'en';
}

// Signed-in member's language (cached on this device), else the last one used here, else the browser's.
export function preferredLocale(): Locale {
  return getCurrentLocale() || browserLocale();
}

// Start from the stored preference so a fresh module (e.g. after a hot reload) agrees with the page.
if (typeof window !== 'undefined') applyLocale(preferredLocale());

type Vars = Record<string, string | number>;

// Wraps text in Unicode isolates (FSI…PDI) so a Hebrew name inside an English sentence
// (or an English chore title inside a Hebrew one) can't reorder the words around it.
export function isolate(text: string) {
  return `\u2068${text}\u2069`;
}

function fill(template: string, vars?: Vars) {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = vars[name];
    if (value === undefined) return match;
    return typeof value === 'number' ? String(value) : isolate(value);
  });
}

export function t(key: MessageKey, vars?: Vars) {
  return fill(catalogs[current][key] ?? en[key] ?? key, vars);
}

type PluralBase = MessageKey extends infer K ? (K extends `${infer B}_other` ? B : never) : never;

export function tn(base: PluralBase, count: number, vars?: Vars) {
  const catalog = catalogs[current];
  const rule = new Intl.PluralRules(intlLocale()).select(count);
  const template = catalog[`${base}_${rule}`] ?? catalog[`${base}_other`] ?? (en as Record<string, string>)[`${base}_other`];
  return fill(template, { count, ...vars });
}

// Items are isolated so e.g. two Latin names in a Hebrew list keep their order instead of merging into one LTR run.
export function listJoin(items: string[]) {
  return new Intl.ListFormat(intlLocale(), { style: 'short', type: 'conjunction' }).format(items.map(isolate));
}

export function joinNames(items: string[], separator = t('common.listSeparator')) {
  return items.map(isolate).join(separator);
}
