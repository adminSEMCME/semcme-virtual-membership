import { readFileSync } from 'node:fs';

export function postgresOptions(databaseUrl) {
  const url = new URL(databaseUrl);
  const options = { connectionString: databaseUrl, max: 3, idleTimeoutMillis: 10000, connectionTimeoutMillis: 15000 };
  if (url.hostname.endsWith('.pooler.supabase.com') || /^db\.[a-z0-9]+\.supabase\.co$/.test(url.hostname)) {
    // pg's URL SSL parameters override the explicit SSL object, including its CA.
    for (const key of ['ssl', 'sslmode', 'sslcert', 'sslkey', 'sslrootcert', 'uselibpqcompat']) url.searchParams.delete(key);
    options.connectionString = url.toString();
    options.ssl = {
      ca: readFileSync(new URL('./supabase-ca.crt', import.meta.url), 'utf8'),
      rejectUnauthorized: true,
      servername: url.hostname,
    };
  }
  return options;
}
