// Locale codes have already been checked against the supported list by i18n.
// Load only the active event reference; an unavailable pack retains English.
export const eventTranslations = Object.create(null);
export async function loadEventLocale(code) {
  if (code === 'en' || eventTranslations[code]) return;
  try {
    eventTranslations[code] = await import(`./event-locales/${code}.mjs?v=0.1.0`);
  } catch {
    // The main interface can still switch languages if a reference file fails.
  }
}
