const localeEntries = [
  ['en', 'English', 'ltr'],
  ['es', 'Español', 'ltr'],
  ['fr', 'Français', 'ltr'],
  ['de', 'Deutsch', 'ltr'],
  ['it', 'Italiano', 'ltr'],
  ['pt-BR', 'Português (Brasil)', 'ltr'],
  ['pt-PT', 'Português (Portugal)', 'ltr'],
  ['nl', 'Nederlands', 'ltr'],
  ['da', 'Dansk', 'ltr'],
  ['sv', 'Svenska', 'ltr'],
  ['nb', 'Norsk bokmål', 'ltr'],
  ['fi', 'Suomi', 'ltr'],
  ['pl', 'Polski', 'ltr'],
  ['cs', 'Čeština', 'ltr'],
  ['hu', 'Magyar', 'ltr'],
  ['ro', 'Română', 'ltr'],
  ['el', 'Ελληνικά', 'ltr'],
  ['tr', 'Türkçe', 'ltr'],
  ['ru', 'Русский', 'ltr'],
  ['uk', 'Українська', 'ltr'],
  ['ar', 'العربية', 'rtl'],
  ['he', 'עברית', 'rtl'],
  ['hi', 'हिन्दी', 'ltr'],
  ['th', 'ไทย', 'ltr'],
  ['vi', 'Tiếng Việt', 'ltr'],
  ['id', 'Bahasa Indonesia', 'ltr'],
  ['ja', '日本語', 'ltr'],
  ['ko', '한국어', 'ltr'],
  ['zh-Hans', '简体中文', 'ltr'],
  ['zh-Hant', '繁體中文', 'ltr'],
];

export const locales = Object.freeze(Object.fromEntries(
  localeEntries.map(([code, name, direction]) => [code, Object.freeze({code, name, direction})]),
));

const readyLocales = new Set(['en', 'es', 'fr', 'de', 'it', 'pt-BR', 'pt-PT', 'nl', 'da', 'sv', 'nb', 'fi', 'pl', 'cs', 'hu', 'ro', 'el', 'tr', 'ru', 'uk', 'ar', 'he', 'hi', 'th', 'vi', 'id', 'ja', 'ko', 'zh-Hans', 'zh-Hant']);
const sourceText = new WeakMap();
const sourceTextValues = new WeakMap();
const literalTextNodes = new WeakSet();
const renderedText = new WeakMap();
const sourceAttributes = new WeakMap();
const sourceAttributeValues = new WeakMap();
const renderedAttributes = new WeakMap();
const translatedAttributes = ['aria-label', 'aria-description', 'aria-valuetext', 'placeholder', 'title'];
const excludedTextTags = new Set(['CODE', 'PRE', 'SCRIPT', 'STYLE', 'TEXTAREA']);
const excludedContainers = '#result,#history-list,#earlier-receptions-list,#morse-tables,#location-summary,#location-search-results,#location-reference-list,#event-reference-list,#header-preview,#morse-code,#morse-normalized,#payload-name,#diag-input';

let activeLocale = 'en';
let activeMessages = Object.create(null);
let activePatterns = [];
let observer;
let localeRequest = 0;

export const getLocale = () => activeLocale;
export const formatNumber = (value, options) => new Intl.NumberFormat(activeLocale, options).format(value);
export const formatDate = (value, options) => new Intl.DateTimeFormat(activeLocale, options).format(value);
export const formatUnit = (value, unit, options = {}) => new Intl.NumberFormat(activeLocale, {style: 'unit', unit, unitDisplay: 'short', ...options}).format(value);

function compilePatterns(messages) {
  return Object.entries(messages).flatMap(([source, target]) => {
    const names = [];
    const pieces = source.split(/\{([A-Za-z][A-Za-z0-9_]*)\}/g);
    if (pieces.length === 1) return [];
    const expression = pieces.map((piece, index) => {
      if (index % 2) {
        names.push(piece);
        return '(.*?)';
      }
      return piece.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }).join('');
    return [{source, target, names, pattern: new RegExp(`^${expression}$`, 'u')}];
  }).sort((a, b) => b.names.length - a.names.length);
}

function lookupTranslation(source) {
  if (Object.hasOwn(activeMessages, source)) return activeMessages[source];
  for (const entry of activePatterns) {
    const match = entry.pattern.exec(source);
    if (!match) continue;
    return entry.target.replace(/\{([A-Za-z][A-Za-z0-9_]*)\}/g, (token, name) => {
      const slot = entry.names.indexOf(name);
      return slot < 0 ? token : match[slot + 1] ?? '';
    });
  }
  return source;
}

function shouldTranslateText(node) {
  const parent = node.parentElement;
  return Boolean(parent && !excludedTextTags.has(parent.tagName) && !parent.closest(excludedContainers));
}

function translateTextNode(node) {
  if (literalTextNodes.has(node)) return;
  if (!shouldTranslateText(node)) return;
  const current = node.nodeValue;
  let source = sourceText.get(node);
  if (source === undefined || current !== renderedText.get(node)) {
    source = current;
    sourceText.set(node, source);
    sourceTextValues.delete(node);
  }
  const leading = source.match(/^\s*/u)?.[0] || '';
  const trailing = source.match(/\s*$/u)?.[0] || '';
  const key = source.slice(leading.length, source.length - trailing.length);
  const translated = key ? `${leading}${translate(key, sourceTextValues.get(node) || {})}${trailing}` : source;
  renderedText.set(node, translated);
  if (translated !== current) node.nodeValue = translated;
}

function translateAttributes(element) {
  if (!(element instanceof Element)) return;
  let originals = sourceAttributes.get(element);
  if (!originals) {
    originals = new Map();
    sourceAttributes.set(element, originals);
  }
  let rendered = renderedAttributes.get(element);
  if (!rendered) {
    rendered = new Map();
    renderedAttributes.set(element, rendered);
  }
  for (const name of translatedAttributes) {
    if (!element.hasAttribute(name)) continue;
    const current = element.getAttribute(name);
    let source = originals.get(name);
    if (source === undefined || current !== rendered.get(name)) {
      source = current;
      originals.set(name, source);
      sourceAttributeValues.get(element)?.delete(name);
    }
    const values = sourceAttributeValues.get(element)?.get(name) || {};
    const translated = translate(source, values);
    rendered.set(name, translated);
    if (translated !== current) element.setAttribute(name, translated);
  }
  if (element.matches('meta[name="description"]')) {
    const current = element.content;
    let source = originals.get('content');
    if (source === undefined || current !== rendered.get('content')) {
      source = current;
      originals.set('content', source);
      sourceAttributeValues.get(element)?.delete('content');
    }
    const values = sourceAttributeValues.get(element)?.get('content') || {};
    const translated = translate(source, values);
    rendered.set('content', translated);
    if (translated !== current) element.content = translated;
  }
}

function scan(root = document) {
  if (root instanceof Element) translateAttributes(root);
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) translateTextNode(node);
  if (root.querySelectorAll) root.querySelectorAll('*').forEach(translateAttributes);
}

function observe() {
  if (observer) return;
  observer = new MutationObserver(records => {
    for (const record of records) {
      if (record.type === 'characterData') translateTextNode(record.target);
      else if (record.type === 'attributes') translateAttributes(record.target);
      else {
        for (const node of record.addedNodes) {
          if (node.nodeType === Node.TEXT_NODE) translateTextNode(node);
          else if (node.nodeType === Node.ELEMENT_NODE) scan(node);
        }
      }
    }
  });
  observer.observe(document.documentElement, {subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: translatedAttributes});
}

function detectLocale() {
  let saved = '';
  try { saved = localStorage.getItem('signal-lab-locale') || ''; } catch {}
  if (locales[saved]) return saved;
  for (const candidate of navigator.languages || [navigator.language]) {
    if (!candidate) continue;
    let tag;
    try { tag = new Intl.Locale(candidate); } catch { continue; }
    const language = tag.language.toLowerCase();
    const exact = tag.baseName.toLowerCase();
    if (language === 'zh') {
      const script = tag.script || (['TW','HK','MO'].includes(tag.region) ? 'Hant' : 'Hans');
      if (script === 'Hant' || script === 'Hans') return `zh-${script}`;
      continue;
    }
    if (language === 'pt') return tag.region === 'BR' ? 'pt-BR' : 'pt-PT';
    if (language === 'no') return 'nb';
    if (language === 'iw') return 'he';
    const match = localeEntries.find(([code]) => code.toLowerCase() === exact)
      || localeEntries.find(([code]) => code.toLowerCase() === language);
    if (match) return match[0];
  }
  return 'en';
}

async function readMessages(code) {
  if (code === 'en') return Object.create(null);
  const response = await fetch(new URL(`./locales/${code}.json?v=0.7.1`, import.meta.url));
  if (!response.ok) throw new Error(`Locale ${code} is not available.`);
  const value = await response.json();
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Locale ${code} has an invalid message catalog.`);
  return value;
}

export async function setLocale(code) {
  if (!locales[code]) return false;
  if (!readyLocales.has(code)) {
    const selector = document.querySelector('#language');
    if (selector) selector.value = activeLocale;
    return false;
  }
  const request = ++localeRequest;
  let messages;
  try {
    messages = await readMessages(code);
  } catch {
    if (request !== localeRequest) return false;
    const selector = document.querySelector('#language');
    if (selector) selector.value = activeLocale;
    return false;
  }
  if (request !== localeRequest) return false;
  activeLocale = code;
  activeMessages = messages;
  activePatterns = compilePatterns(messages);
  document.documentElement.lang = locales[code].code;
  document.documentElement.dir = locales[code].direction;
  const selector = document.querySelector('#language');
  if (selector) selector.value = code;
  try { localStorage.setItem('signal-lab-locale', code); } catch {}
  scan();
  window.dispatchEvent(new CustomEvent('signal-lab-locale-change', {detail: {locale: code}}));
  return true;
}

export async function initLocalization() {
  observe();
  const selector = document.querySelector('#language');
  if (selector && selector.options.length === 0) {
    for (const [code, name] of localeEntries) {
      const option = document.createElement('option');
      option.value = code;
      option.textContent = name;
      option.disabled = !readyLocales.has(code);
      selector.append(option);
    }
  }
  scan();
  if (selector) selector.addEventListener('change', () => { void setLocale(selector.value); });
  const initial = detectLocale();
  if (initial !== 'en') await setLocale(initial);
  else {
    const selectorNow = document.querySelector('#language');
    if (selectorNow) selectorNow.value = 'en';
  }
}

export function translate(source, values = {}) {
  const pattern = lookupTranslation(source);
  return pattern.replace(/\{([A-Za-z][A-Za-z0-9_]*)\}/g, (match, name) =>
    Object.hasOwn(values, name)
      ? values[name] && typeof values[name] === 'object' && typeof values[name].source === 'string'
        ? translate(values[name].source, values[name].values || {})
        : String(values[name])
      : match,
  );
}

export function setLocalizedText(element, source, values = {}) {
  const translated = translate(source, values);
  element.textContent = translated;
  const node = element.firstChild;
  if (node?.nodeType === Node.TEXT_NODE) {
    sourceText.set(node, source);
    sourceTextValues.set(node, values);
    renderedText.set(node, translated);
  }
  return translated;
}

export function setLocalizedParts(element, parts) {
  const nodes = parts.map(part => {
    const message = typeof part === 'string' ? {source: part, values: {}} : part;
    const text = message.literal ? String(message.text ?? '') : translate(message.source, message.values || {});
    const node = document.createTextNode(text);
    if (message.literal) literalTextNodes.add(node);
    else {
      sourceText.set(node, message.source);
      sourceTextValues.set(node, message.values || {});
      renderedText.set(node, text);
    }
    return node;
  });
  element.replaceChildren(...nodes);
}

export function setLocalizedAttribute(element, name, source, values = {}) {
  const translated = translate(source, values);
  element.setAttribute(name, translated);
  let originals = sourceAttributes.get(element);
  if (!originals) { originals = new Map(); sourceAttributes.set(element, originals); }
  originals.set(name, source);
  let attributeValues = sourceAttributeValues.get(element);
  if (!attributeValues) { attributeValues = new Map(); sourceAttributeValues.set(element, attributeValues); }
  attributeValues.set(name, values);
  let rendered = renderedAttributes.get(element);
  if (!rendered) { rendered = new Map(); renderedAttributes.set(element, rendered); }
  rendered.set(name, translated);
  return translated;
}

export function localizeString(source, values = {}) {
  return translate(source, values);
}

void initLocalization();
