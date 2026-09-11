import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import http from 'node:http';
import { createHmac } from 'node:crypto';
import { classifyEvent } from '../data/program-sync.js';

const dir = await mkdtemp(join(tmpdir(), 'vm-sync-test-'));
Object.assign(process.env, { VERCEL: '1', SQLITE_DATABASE_PATH: join(dir, 'test.db'), DATABASE_URL: '', POSTGRES_URL: '', ADMIN_PASSWORD: 'test-password', GLOBAL_ADMIN_PASSWORD: '', GLOBAL_ADMIN_USERNAME: '', ADMIN_USERNAME: '', CRON_SECRET: 'test-cron-secret', COOKIE_SECRET: 'isolated-test-cookie-secret' });
const realFetch = globalThis.fetch;
let sourceCalls = 0;
let mode = 'normal';
const titles = ['Functional Neurological Disorders','Eating Disorders in Adolescents','Addiction Medicine','The Sunny Side of Stress','Generational Differences in Med Ed','Access to Healthcare for Immigrants Virtual Program','Fatigue Mitigation & Burnout Prevention','Preparing for Practice Fall 2026','Unfamiliar New Program'];
globalThis.fetch = async (url, options) => {
  if (!String(url).includes('semcme.org')) return realFetch(url, options);
  sourceCalls++;
  if (mode === 'error') throw new Error('Source unavailable');
  if (mode === 'broken') return new Response('<html>Maintenance</html>');
  const list = mode === 'empty' ? ['In person event'] : titles;
  return new Response(list.map((title, i) => `<div class="et_pb_slide et_pb_slide_${i}"><h2 class="et_pb_slide_title"><a href="https://example.org/event/${i}">${title}</a></h2><div class="et_pb_slide_content">${mode === 'empty' ? 'In person' : 'Virtual over Zoom, December 1, 2027'}</div></div></div></div></div>`).join(''));
};
let server;
let sqlite;
try {
  const { default: handler } = await import('../server.js');
  server = http.createServer(handler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  let cookie = '';
  async function request(path, body, headers = {}) {
    const response = await realFetch(base + path, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', cookie, ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    if (response.headers.get('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0];
    return { status: response.status, data: await response.json() };
  }
  assert.equal((await request('/api/cron/sync-programs')).status, 401);
  assert.equal((await request('/api/admin/login', { password: 'test-password' })).status, 200);
  let dashboard = (await request('/api/admin/dashboard')).data;
  assert.equal(dashboard.heroEvents.length, 9);
  const find = slug => dashboard.libraryPrograms.find(p => p.slug === slug);
  assert.equal(find('jedi').name, 'Justice in Healthcare');
  assert.equal(find('pediatrics').upcoming.length, 3);
  assert.equal(find('hot-topics').upcoming.length, 1);
  assert.equal(find('quality-improvement').upcoming.length, 0);
  assert.ok(find('lecture-series').current.some(r => r.url === 'https://ehr.portal.semcme.org/'));
  assert.ok(find('additional-offerings').archives.some(r => r.title === 'Advocacy 101'));
  assert.equal(find('additional-offerings').archives.filter(r => /Home Buying/.test(r.title)).length, 2);
  assert.ok(find('pediatrics').archives[0].videos.length);
  assert.ok(!find('lecture-series').current.some(r => /pediatric|hot topics|AI in Medicine/i.test(`${r.title} ${r.group}`)));
  assert.ok(dashboard.heroPlacements.some(p => p.needs_review === 1));
  await request('/api/admin/dashboard');
  assert.equal(sourceCalls, 1, 'stored refresh timestamp prevents repeat source fetches');
  const playlist = find('pediatrics').archives[0];
  await request('/api/admin/library/resource', { ...playlist, programSlug:'additional-offerings', section:'current' });
  dashboard = (await request('/api/admin/dashboard')).data;
  assert.deepEqual(find('additional-offerings').current.find(r => r.id === playlist.id).videos, playlist.videos, 'moving a playlist preserves its video queue');
  const item = find('pediatrics').upcoming[0];
  assert.equal((await request('/api/admin/library/resource', { ...item, programSlug: 'research', section: 'archives', title: 'Admin-edited title' })).status, 200);
  await request('/api/admin/sync-virtual-events', {});
  dashboard = (await request('/api/admin/dashboard')).data;
  assert.ok(find('research').archives.some(r => r.id === item.id && r.title === 'Admin-edited title'));
  sqlite = new DatabaseSync(process.env.SQLITE_DATABASE_PATH);
  const count = sqlite.prepare('SELECT COUNT(*) AS n FROM library_resources').get().n;
  await request('/api/admin/sync-virtual-events', {});
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM library_resources').get().n, count, 'repeated sync does not duplicate resources');
  const deleted = find('hot-topics').upcoming[0];
  await realFetch(`${base}/api/admin/library/resource?id=${deleted.id}`, { method: 'DELETE', headers: { cookie } });
  await request('/api/admin/sync-virtual-events', {});
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM library_resources WHERE id=?').get(deleted.id).n, 0, 'deleted import stays deleted');
  mode = 'broken';
  assert.equal((await request('/api/admin/sync-virtual-events', {})).status, 500);
  assert.equal((await request('/api/admin/dashboard')).data.heroEvents.length, 9, 'parser failure preserves previous events');
  mode = 'error';
  assert.equal((await request('/api/admin/sync-virtual-events', {})).status, 500);
  mode = 'empty';
  const cron = await request('/api/cron/sync-programs', undefined, { authorization: 'Bearer test-cron-secret' });
  assert.equal(cron.status, 200);
  assert.equal(cron.data.count, 0);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM imported_programs WHERE active=1').get().n, 0);
  assert.ok(sqlite.prepare('SELECT id FROM library_resources WHERE id=?').get(item.id), 'manual resource retained');
  const value = 'member:1';
  const memberCookie = `semcme_member=${encodeURIComponent(value + '.' + createHmac('sha256', process.env.COOKIE_SECRET).update(value).digest('base64url'))}`;
  const library = (await request('/api/library', undefined, { cookie: memberCookie })).data;
  assert.equal(library.events.length, 0);
  assert.ok(library.programs.find(p => p.slug === 'research').archives.some(r => r.id === item.id));
  assert.equal(library.programs.find(p => p.slug === 'pediatrics').upcoming.length, 0, 'removed banners disappear from member Upcoming');
  const { migratePrograms } = await import('../data/program-sync.js');
  const db = { exec: async s => sqlite.exec(s), get: async (s,p=[]) => sqlite.prepare(s.replace(/\$\d+/g,'?')).get(...p) };
  await migratePrograms(db); // Must return without mutating previously migrated admin content.
  assert.equal(classifyEvent({ title:'EHR Modules', description:'' }).section, 'current');
  assert.equal(classifyEvent({ title:'Hot Topics', description:'Virtual December 1, 2020' }, new Date('2026-09-11')).section, 'archives');
  console.log('PASS: category migration, placements, EHR, archives, admin moves/edits, deduplication, suppression, persistent cache, failure retention, empty schedule, cron authentication, migration rerun, date classification');
} finally {
  globalThis.fetch = realFetch;
  if (server) await new Promise(resolve => server.close(resolve));
  sqlite?.close();
  // The application's SQLite connection remains open until this process exits.
  await rm(dir, { recursive: true, force: true }).catch(() => {});
}

