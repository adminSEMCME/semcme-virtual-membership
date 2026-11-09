import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { materialIdentity } from '../data/library-catalog.js';

const url = process.env.TEST_DATABASE_URL;
if (!url || new URL(url).hostname !== '127.0.0.1' || !new URL(url).pathname.includes('test')) throw new Error('Use an isolated local test database.');
Object.assign(process.env, {
  VERCEL: '1', DATABASE_URL: url, DATABASE_PROVIDER: 'postgres', DATABASE_TABLE_PREFIX: 'vm_',
  COOKIE_SECRET: 'local-test-secret', ADMIN_PASSWORD: 'test-password', GLOBAL_ADMIN_PASSWORD: '',
  ADMIN_USERNAME: '', GLOBAL_ADMIN_USERNAME: '', CONSTANT_CONTACT_ACCESS_TOKEN: '', CONSTANT_CONTACT_CLIENT_ID: '',
  CONSTANT_CONTACT_CLIENT_SECRET: '', CONSTANT_CONTACT_REFRESH_TOKEN: '',
});
assert.equal(materialIdentity('https://youtu.be/abcdefghijk?t=50').identityKey, materialIdentity('https://www.youtube.com/watch?v=abcdefghijk').identityKey);
assert.throws(() => materialIdentity('javascript:alert(1)'));
const pool = new pg.Pool({ connectionString: url });
await pool.query(await readFile(new URL('../database/migrations/20261109-library-categories.sql', import.meta.url), 'utf8'));
await pool.query(await readFile(new URL('../database/migrations/20261109-unify-library.sql', import.meta.url), 'utf8'));
const realFetch = globalThis.fetch;
globalThis.fetch = async () => { throw new Error('External networking disabled in catalog tests'); };
let server;
try {
  const { default: handler } = await import('../server.js');
  server = http.createServer(handler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  let cookie = '';
  const request = async (path, method = 'GET', body) => {
    const response = await realFetch(base + path, { method, headers: { cookie, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, data: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] };
  };
  assert.equal((await request('/api/admin/catalog')).status, 401);
  assert.equal((await request('/api/admin/catalog/material', 'POST', {})).status, 401);
  assert.equal((await request('/api/admin/catalog/material', 'DELETE', {})).status, 401);
  cookie = (await request('/api/admin/login', 'POST', { password: 'test-password' })).cookie;
  let catalog = (await request('/api/admin/catalog')).data;
  assert.equal(catalog.tags.filter(t => t.taxonomy !== 'topic').length, 14);
  const original = (await pool.query('SELECT row_to_json(r)::text AS row FROM vm_library_resources r ORDER BY id')).rows;
  const series = await request('/api/admin/catalog/series', 'POST', { title: 'Testing series' });
  assert.equal(series.status, 200);
  const created = await request('/api/admin/catalog/material', 'POST', { title: 'Test video', url: 'https://youtu.be/abcdefghijk', type: 'recording', tagIds: [], seriesId: series.data.id, sessionPosition: 1 });
  assert.equal(created.status, 200);
  const id = created.data.id;
  const readMaterial = async () => (await request('/api/admin/catalog')).data.materials.find(m => m.id === id);
  let material = await readMaterial();
  assert.equal(material.needsReview, true);
  assert.equal(material.additionalTopics, false);
  const tagged = { ...material, tagIds: ['competency-communication', 'competency-professionalism', 'survey-evaluation'] };
  assert.equal((await request('/api/admin/catalog/material', 'POST', tagged)).status, 200);
  material = await readMaterial();
  assert.equal(material.tags.length, 3);
  assert.equal(material.needsReview, true);
  assert.equal(material.additionalTopics, false);
  assert.equal((await request('/api/admin/catalog/material', 'POST', tagged)).status, 409, 'stale edits cannot overwrite a saved change');
  const duplicate = await request('/api/admin/catalog/material', 'POST', { title: 'Duplicate link', url: 'https://www.youtube.com/watch?v=abcdefghijk', type: 'recording', tagIds: [] });
  assert.equal(duplicate.status, 409);
  const invalid = await request('/api/admin/catalog/material', 'POST', { ...material, title: 'Must not save', tagIds: ['missing'] });
  assert.equal(invalid.status, 409);
  assert.equal((await readMaterial()).title, 'Test video');
  assert.equal((await readMaterial()).tags.length, 3);
  catalog = (await request('/api/admin/catalog')).data;
  const usedTag = catalog.tags.find(t => t.id === 'survey-evaluation');
  assert.equal((await request('/api/admin/catalog/tag', 'DELETE', usedTag)).status, 409);
  assert.equal((await request('/api/admin/catalog/material', 'POST', { ...material, tagIds: [], competencyReviewed: true, surveyReviewed: false })).status, 200);
  material = await readMaterial();
  assert.equal(material.additionalTopics, false);
  assert.equal((await request('/api/admin/catalog/material', 'POST', { ...material, tagIds: [], surveyReviewed: true })).status, 200);
  material = await readMaterial();
  assert.equal(material.additionalTopics, true);
  assert.equal(material.needsReview, false);
  const newTag = await request('/api/admin/catalog/tag', 'POST', { name: 'Test category', taxonomy: 'survey', enabled: true });
  assert.equal(newTag.status, 200);
  catalog = (await request('/api/admin/catalog')).data;
  const category = catalog.tags.find(t => t.id === newTag.data.id);
  assert.equal((await request('/api/admin/catalog/tag', 'POST', { ...category, name: 'Renamed category', enabled: false })).status, 200);
  catalog = (await request('/api/admin/catalog')).data;
  assert.equal(catalog.tags.find(t => t.id === category.id).enabled, false);
  assert.equal((await request('/api/admin/catalog/tag', 'DELETE', catalog.tags.find(t => t.id === category.id))).status, 200);
  const grouping = catalog.series.find(s => s.id === series.data.id);
  assert.equal((await request('/api/admin/catalog/series', 'DELETE', grouping)).status, 200);
  material = await readMaterial();
  assert.equal(material.seriesId, '');
  assert.equal((await request('/api/admin/catalog/material', 'POST', { ...material, tagIds: [], enabled: false })).status, 200);
  material = await readMaterial();
  assert.equal(material.enabled, false);
  assert.equal((await request('/api/admin/catalog/material', 'DELETE', material)).status, 200);
  assert.equal(await readMaterial(), undefined);
  assert.deepEqual((await pool.query('SELECT row_to_json(r)::text AS row FROM vm_library_resources r ORDER BY id')).rows, original);
  console.log('PASS: authenticated catalog APIs, material/tag/series CRUD, multiple tags, review states, stale edits, duplicate videos, rollback on validation, safe deletion, and unchanged original library.');
} finally {
  globalThis.fetch = realFetch;
  if (server) await new Promise(resolve => server.close(resolve));
  await pool.end();
}
