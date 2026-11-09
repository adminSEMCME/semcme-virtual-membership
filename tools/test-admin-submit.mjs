import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../public/admin.js', import.meta.url), 'utf8');
for (const [selector, next, payload] of [
  ['#institutionSegmentForm', '#institutionSegmentList', null],
]) {
  let handler, sent, resets = 0;
  const status = { textContent: '', classList: { add() {}, remove() {} } };
  const form = {
    slug: { readOnly: true }, name: { value: ' Test institution ' },
    querySelector: () => ({}), reset: () => resets++,
  };
  const context = {
    $: id => id === selector ? { addEventListener: (_, callback) => { handler = callback; } } : status,
    formObject: target => { assert.equal(target, form, 'must use the form before event.currentTarget clears'); return payload; },
    confirmAction: async () => true,
    withLoading: async (_, __, task) => { await Promise.resolve(); return task(); },
    api: async (_, options) => { sent = JSON.parse(options.body); return { slug: 'research', id: 'recording', virtualInstitutionSegments: [] }; },
    load: async () => {}, renderInstitutionSegments: () => {},
  };
  const start = source.indexOf(`$("${selector}").addEventListener("submit"`);
  const end = source.indexOf(`$("${next}").addEventListener`, start);
  assert.ok(start >= 0 && end > start);
  vm.runInNewContext(source.slice(start, end), context);
  const event = { preventDefault() {}, currentTarget: form, submitter: {} };
  const pending = handler(event);
  // Browsers clear currentTarget once synchronous event dispatch returns.
  event.currentTarget = null;
  await pending;
  assert.deepEqual(sent, payload || { name: 'Test institution' });
  assert.ok(!status.textContent.includes('null'));
  if (!payload) assert.equal(resets, 1);
}
console.log('PASS: institution reset survive asynchronous event dispatch.');
