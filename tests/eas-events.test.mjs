import assert from 'node:assert/strict';
import {readdir,readFile} from 'node:fs/promises';
import {EAS_EVENTS, EVENT_GROUPS, eventExplanation} from '../dist/eas-events.mjs';
import * as es from '../dist/event-locales/es.mjs';
import * as fr from '../dist/event-locales/fr.mjs';
import * as de from '../dist/event-locales/de.mjs';
import * as it from '../dist/event-locales/it.mjs';
import * as ptBR from '../dist/event-locales/pt-BR.mjs';
import * as ptPT from '../dist/event-locales/pt-PT.mjs';
import * as hans from '../dist/event-locales/zh-Hans.mjs';
import * as hant from '../dist/event-locales/zh-Hant.mjs';
import * as ja from '../dist/event-locales/ja.mjs';
import * as nl from '../dist/event-locales/nl.mjs';
import * as sv from '../dist/event-locales/sv.mjs';
import * as da from '../dist/event-locales/da.mjs';
import * as nb from '../dist/event-locales/nb.mjs';
import * as id from '../dist/event-locales/id.mjs';
import * as vi from '../dist/event-locales/vi.mjs';
import * as ro from '../dist/event-locales/ro.mjs';
import * as tr from '../dist/event-locales/tr.mjs';
import * as ru from '../dist/event-locales/ru.mjs';
import * as uk from '../dist/event-locales/uk.mjs';
import * as ar from '../dist/event-locales/ar.mjs';
import * as he from '../dist/event-locales/he.mjs';
import * as cs from '../dist/event-locales/cs.mjs';
import * as pl from '../dist/event-locales/pl.mjs';
import * as fi from '../dist/event-locales/fi.mjs';
import * as hu from '../dist/event-locales/hu.mjs';
import * as ko from '../dist/event-locales/ko.mjs';
import * as el from '../dist/event-locales/el.mjs';
import * as hi from '../dist/event-locales/hi.mjs';
import * as th from '../dist/event-locales/th.mjs';

const localeSource = await readFile(new URL('../dist/i18n.mjs', import.meta.url), 'utf8');
const locales = [...localeSource.matchAll(/^\s*\['([^']+)'/gm)].map(match => match[1]).filter(code => code !== 'en').sort();
const packs = (await readdir(new URL('../dist/event-locales/', import.meta.url))).filter(name => name.endsWith('.mjs')).map(name => name.slice(0, -4)).sort();
assert.deepEqual(packs, locales, 'every supported non-English locale has an event pack');
const grouped = EVENT_GROUPS.flatMap(group => group.codes);
assert.equal(new Set(grouped).size, grouped.length, 'each event appears once');
assert.deepEqual([...grouped].sort(), Object.keys(EAS_EVENTS).sort(), 'every FCC event is described');
assert.equal(grouped.length, 57);
for (const code of grouped) {
  assert.match(code, /^[A-Z]{3}$/);
  assert.ok(EAS_EVENTS[code]);
  assert.notEqual(eventExplanation(code), 'Refer to the official source and local alerting plan for this code.');
}
assert.match(eventExplanation('AVA'), /watch/i);
assert.match(eventExplanation('TOR'), /warning/i);
assert.match(eventExplanation('FFS'), /follow-up/i);
assert.match(eventExplanation('NMN'), /not defined/i);
console.log('PASS FCC event catalog and organized study explanations');

const checkedPacks = [['es', es], ['fr', fr], ['de', de], ['it', it], ['pt-BR', ptBR], ['pt-PT', ptPT], ['zh-Hans', hans], ['zh-Hant', hant], ['ja', ja], ['nl', nl], ['sv', sv], ['da', da], ['nb', nb], ['id', id], ['vi', vi], ['ro', ro], ['tr', tr], ['ru', ru], ['uk', uk], ['ar', ar], ['he', he], ['cs', cs], ['pl', pl], ['fi', fi], ['hu', hu], ['ko', ko], ['el', el], ['hi', hi], ['th', th]];
assert.deepEqual(checkedPacks.map(([locale]) => locale).sort(), locales, 'every locale pack has coverage checks');
for (const [locale, pack] of checkedPacks) {
  assert.deepEqual(Object.keys(pack.names).sort(), Object.keys(EAS_EVENTS).sort(), `${locale}: all event names`);
  assert.equal(pack.groups.length, EVENT_GROUPS.length, `${locale}: all groups`);
  for (const group of pack.groups) assert.ok(typeof group === 'string' && group.trim(), `${locale}: empty group`);
  for (const [watch, warning] of [['AVA','AVW'], ['CFA','CFW'], ['FFA','FFW'], ['FLA','FLW'], ['HWA','HWW'], ['HUA','HUW'], ['SVA','SVR'], ['SSA','SSW'], ['TOA','TOR'], ['TRA','TRW'], ['TSA','TSW'], ['WSA','WSW']]) {
    assert.notEqual(pack.names[watch], pack.names[warning], `${locale}: ${watch} and ${warning} must be distinguishable`);
  }
  assert.notEqual(pack.watch, pack.warning, `${locale}: watch and warning explanations must be distinguishable`);
  for (const key of Object.keys(pack.descriptions)) assert.ok(Object.hasOwn(EAS_EVENTS, key), `${locale}: unknown event ${key}`);
  for (const code of grouped) {
    assert.ok(typeof pack.names[code] === 'string' && pack.names[code].trim(), `${locale}: missing ${code} name`);
    if (!pack.descriptions[code]) assert.match(EAS_EVENTS[code], /(Watch|Warning|Statement)$/, `${locale}: missing ${code} explanation`);
  }
  for (const description of [...Object.values(pack.descriptions), pack.watch, pack.warning, pack.statement]) {
    assert.ok(typeof description === 'string' && description.trim(), `${locale}: empty explanation`);
  }
  console.log(`PASS ${locale} event-reference coverage`);
}
assert.notEqual(ptBR.names.EQW, ptPT.names.EQW);
