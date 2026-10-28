import assert from 'node:assert/strict';
import {EAS_EVENTS, EVENT_GROUPS, eventExplanation} from '../dist/eas-events.mjs';

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
