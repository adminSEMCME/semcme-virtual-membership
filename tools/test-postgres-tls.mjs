import assert from 'node:assert/strict';
import net from 'node:net';
import tls from 'node:tls';
import pg from 'pg';
import { postgresOptions } from '../data/postgres-options.js';

const host = 'aws-1-us-east-1.pooler.supabase.com';
const options = postgresOptions(`postgresql://test:unused@${host}:5432/postgres?sslmode=require`);
assert.ok(!options.connectionString.includes('sslmode'));
assert.equal(options.ssl.rejectUnauthorized, true);
const client = new pg.Client(options);
assert.equal(client.connectionParameters.ssl.ca, options.ssl.ca);
assert.equal(client.connectionParameters.ssl.rejectUnauthorized, true);
assert.equal(postgresOptions('postgresql://localhost/test').ssl, undefined);
console.log('PASS: CA and certificate verification survive pg connection-string parsing; local connections unchanged.');

if (process.argv.includes('--live')) {
  // PostgreSQL SSL negotiation only: no username, password or SQL is sent.
  await new Promise((resolve, reject) => {
    const socket = net.connect({ host, port: 5432 });
    socket.setTimeout(15000, () => socket.destroy(new Error('TLS test timed out')));
    socket.on('error', reject);
    socket.once('connect', () => socket.write(Buffer.from([0, 0, 0, 8, 4, 210, 22, 47])));
    socket.once('data', data => {
      if (data[0] !== 83) { socket.destroy(); return reject(new Error('Server did not accept SSL')); }
      const secure = tls.connect({ socket, ...options.ssl }, () => {
        try {
          assert.equal(secure.authorized, true);
          assert.ok(tls.checkServerIdentity('unrelated.invalid', secure.getPeerCertificate()), 'Wrong host must fail verification');
          console.log('PASS: live Supabase TLS chain and hostname verified; wrong hostname rejected.');
          secure.destroy();
          resolve();
        } catch (error) { secure.destroy(); reject(error); }
      });
      secure.on('error', reject);
    });
  });
}
