import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const directory = await mkdtemp(join(tmpdir(), 'vm-support-test-'));
Object.assign(process.env, {
  VERCEL: '1', DATABASE_URL: '', POSTGRES_URL: '',
  SQLITE_DATABASE_PATH: join(directory, 'test.db'),
  ADMIN_PASSWORD: 'test-password', GLOBAL_ADMIN_PASSWORD: '',
  ADMIN_USERNAME: '', GLOBAL_ADMIN_USERNAME: '', COOKIE_SECRET: 'isolated-test',
  CONSTANT_CONTACT_ACCESS_TOKEN: '', CONSTANT_CONTACT_CLIENT_ID: '',
  CONSTANT_CONTACT_CLIENT_SECRET: '', CONSTANT_CONTACT_REFRESH_TOKEN: '',
});
const realFetch = globalThis.fetch;
globalThis.fetch = async () => { throw new Error('External networking disabled in support tests'); };
let server;
try {
  const { default: handler } = await import('../server.js');
  const database = new DatabaseSync(process.env.SQLITE_DATABASE_PATH);
  database.prepare("INSERT INTO support_requests (id,name,email,topic,message) VALUES (1,'Test member','test@example.org','Access','Test request'), (2,'Keep member','keep@example.org','Other','Keep request')").run();
  server = http.createServer(handler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const remove = (id, cookie = '') => realFetch(`${base}/api/admin/support?id=${encodeURIComponent(id)}`, { method: 'DELETE', headers: { cookie } });
  assert.equal((await remove('1')).status, 401);
  assert.equal(database.prepare('SELECT COUNT(*) AS n FROM support_requests').get().n, 2);
  const login = await realFetch(base + '/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'test-password' }) });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie').split(';')[0];
  for (const id of ['', '0', '-1', '1 OR 1=1', '1.5', '9007199254740992']) assert.equal((await remove(id, cookie)).status, 400);
  assert.equal((await remove('999', cookie)).status, 404);
  assert.equal((await remove('1', cookie)).status, 200);
  assert.equal(database.prepare('SELECT id FROM support_requests WHERE id=1').get(), undefined);
  assert.equal(database.prepare('SELECT id FROM support_requests WHERE id=2').get().id, 2);
  assert.equal((await remove('1', cookie)).status, 404);
  database.close();
  console.log('PASS: support deletion requires admin login, validates IDs, persists deletion, preserves other requests, and handles missing requests.');
} finally {
  globalThis.fetch = realFetch;
  if (server) await new Promise(resolve => server.close(resolve));
  // The application owns an open SQLite connection; Windows releases it on process exit.
  await rm(directory, { recursive: true, force: true }).catch(() => {});
}
