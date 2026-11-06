import assert from 'node:assert/strict';
import http from 'node:http';
import { createHmac } from 'node:crypto';
import pg from 'pg';
import { prefixTables } from '../data/database-tables.js';

const url = process.env.TEST_DATABASE_URL;
if (!url || new URL(url).hostname !== '127.0.0.1' || !new URL(url).pathname.includes('test')) {
  throw new Error('Use an isolated local test database.');
}
assert.equal(prefixTables("SELECT * FROM members WHERE email='members' -- members", 'vm_'), "SELECT * FROM vm_members WHERE email='members' -- members");
assert.throws(() => prefixTables('SELECT 1', 'rws_'));
Object.assign(process.env, {
  VERCEL: '1', DATABASE_URL: url, DATABASE_PROVIDER: 'postgres', DATABASE_TABLE_PREFIX: 'vm_',
  COOKIE_SECRET: 'local-test-secret', ADMIN_PASSWORD: 'test-password', GLOBAL_ADMIN_PASSWORD: '',
  ADMIN_USERNAME: '', GLOBAL_ADMIN_USERNAME: '', CONSTANT_CONTACT_ACCESS_TOKEN: '',
  CONSTANT_CONTACT_CLIENT_ID: '', CONSTANT_CONTACT_CLIENT_SECRET: '', CONSTANT_CONTACT_REFRESH_TOKEN: '',
});
const realFetch = globalThis.fetch;
globalThis.fetch = async () => { throw new Error('External network disabled in migration test'); };
const pool = new pg.Pool({ connectionString: url });
let server;
try {
  const { default: handler } = await import('../server.js');
  server = http.createServer(handler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const login = await realFetch(base + '/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'test-password' }) });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const response = await realFetch(base + '/api/admin/dashboard', { headers: { cookie } });
  assert.equal(response.status, 200);
  const dashboard = await response.json();
  assert.ok(dashboard.libraryPrograms.length > 0);
  const program = dashboard.libraryPrograms.find(p => p.current.length || p.archives.length);
  const section = program.current.length ? 'current' : 'archives';
  const resource = program[section][0];
  const update = await realFetch(base + '/api/admin/library/resource', { method: 'POST', headers: { cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ ...resource, programSlug: program.slug, section, title: 'Local database migration test' }) });
  assert.equal(update.status, 200);
  assert.equal((await pool.query('SELECT title FROM vm_library_resources WHERE id=$1', [resource.id])).rows[0].title, 'Local database migration test');
  const value = 'member:1';
  const memberCookie = 'semcme_member=' + encodeURIComponent(value + '.' + createHmac('sha256', process.env.COOKIE_SECRET).update(value).digest('base64url'));
  const library = await realFetch(base + '/api/library', { headers: { cookie: memberCookie } });
  assert.equal(library.status, 200);
  assert.ok((await library.json()).programs.length);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM pg_tables WHERE schemaname='public' AND tablename NOT LIKE 'vm_%'")).rows[0].n, 0);
  console.log('PASS: PostgreSQL startup, prefixed tables, admin login/dashboard/edit, member library, no unprefixed tables.');
} finally {
  globalThis.fetch = realFetch;
  if (server) await new Promise(resolve => server.close(resolve));
  await pool.end();
}
