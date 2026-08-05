import http from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { dirname, extname, join, normalize } from 'node:path';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { programs as defaultPrograms, defaultBanner, defaultEvents } from './data/library.js';

const root = new URL('.', import.meta.url).pathname;

const initialEnv = new Set(Object.keys(process.env));
async function loadEnvFile(name, override = false) {
  try {
    const raw = await readFile(join(root, name), 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
      const index = trimmed.indexOf('=');
      const key = trimmed.slice(0, index).trim();
      let value = trimmed.slice(index + 1).trim();
      value = value.replace(/^(['"])(.*)\1$/, '$2');
      if (!key || initialEnv.has(key)) continue;
      if (override || process.env[key] === undefined) process.env[key] = value;
    }
  } catch {
    /* env file is optional */
  }
}

await loadEnvFile('.env');
await loadEnvFile('.env.local', true);

const port = Number(process.env.PORT || 3000);
const isProd = process.env.NODE_ENV === 'production';
const configuredBaseUrl = process.env.BASE_URL || process.env.SITE_URL || '';
const productionBaseUrl = process.env.PRODUCTION_BASE_URL || 'https://virtual.semcme.org';
const localBaseUrl = `http://localhost:${port}`;
const adminUsername = process.env.GLOBAL_ADMIN_USERNAME || process.env.ADMIN_USERNAME || '';
const adminPassword = process.env.GLOBAL_ADMIN_PASSWORD || process.env.ADMIN_PASSWORD || 'admin-demo-2026';
const cookieSecret = process.env.COOKIE_SECRET || 'local-development-only-change-me';
const ccBase = 'https://api.cc.email/v3';
const semcmeHomeUrl = process.env.SEMCME_HOME_URL || 'https://semcme.org/';
const oneDayMs = 24 * 60 * 60 * 1000;
const semcmeHeroRefreshMs = Math.max(Number(process.env.SEMCME_HERO_REFRESH_MS || oneDayMs), oneDayMs);
const magicLinkTtlMs = 30 * 60 * 1000;
const ccAccessToken = process.env.CONSTANT_CONTACT_ACCESS_TOKEN || '';
const ccClientId = process.env.CONSTANT_CONTACT_CLIENT_ID || '';
const ccClientSecret = process.env.CONSTANT_CONTACT_CLIENT_SECRET || '';
const ccRefreshToken = process.env.CONSTANT_CONTACT_REFRESH_TOKEN || '';
const ccVirtualMembersListId = process.env.CONSTANT_CONTACT_VIRTUAL_MEMBERSHIP_LIST_ID || '';
const ccVirtualMembersListName = process.env.CONSTANT_CONTACT_VIRTUAL_MEMBERSHIP_LIST_NAME || 'SEMCME - Virtual Members';
const ccVirtualInstitutionFieldId = process.env.CONSTANT_CONTACT_VIRTUAL_INSTITUTION_FIELD_ID || '';
const ccVirtualInstitutionFieldName = process.env.CONSTANT_CONTACT_VIRTUAL_INSTITUTION_FIELD_NAME || 'Virtual Member Institution';
const ccRedirectUri = process.env.CONSTANT_CONTACT_REDIRECT_URI || `${productionBaseUrl}/api/admin/constant-contact/callback`;
const registrationUrl = process.env.VIRTUAL_MEMBERSHIP_REGISTRATION_URL || 'https://lp.constantcontactpages.com/sl/8vmbMa9';
const constantContactConfigured = Boolean((ccAccessToken || (ccClientId && ccClientSecret && ccRefreshToken)) && (ccVirtualMembersListId || ccVirtualMembersListName));
const databaseUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL || '';
const databasePath = process.env.SQLITE_DATABASE_PATH || (process.env.VERCEL ? '/tmp/semcme.db' : join(root, 'data', 'semcme.db'));
const ccTokenState = {
  accessToken: ccAccessToken,
  refreshToken: ccRefreshToken,
  expiresAt: 0
};
const virtualInstitutionFieldLabel = 'SEMCME Virtual Member Institution';
const defaultVirtualInstitutionSegments = [
  'SEMCME',
  'NON-SEMCME'
];

function cleanBaseUrl(value) {
  const url = String(value || '').trim().replace(/\/+$/, '');
  if (!url) return '';
  try {
    return new URL(url).origin;
  } catch {
    return '';
  }
}

const delay = ms => new Promise((resolve) => setTimeout(resolve, ms));

function isVercelAppUrl(value) {
  try {
    return new URL(value).hostname.endsWith('.vercel.app');
  } catch {
    return false;
  }
}

function magicLinkBaseUrl() {
  const configured = cleanBaseUrl(configuredBaseUrl);
  if (isProd && (!configured || isVercelAppUrl(configured))) return cleanBaseUrl(productionBaseUrl);
  return configured || localBaseUrl;
}

function sqliteDatabase() {
  const sqlite = new DatabaseSync(databasePath);
  const bind = (sql, params = []) => {
    let index = 0;
    return {
      sql: sql.replace(/\$\d+/g, () => '?'),
      params: params.map((value) => typeof value === 'boolean' ? (value ? 1 : 0) : (value ?? ''))
    };
  };

  return {
    type: 'sqlite',
    async exec(sql) { sqlite.exec(sql); },
    async all(sql, params) {
      const q = bind(sql, params);
      return sqlite.prepare(q.sql).all(...q.params);
    },
    async get(sql, params) {
      const q = bind(sql, params);
      return sqlite.prepare(q.sql).get(...q.params);
    },
    async run(sql, params) {
      const q = bind(sql, params);
      return sqlite.prepare(q.sql).run(...q.params);
    }
  };
}

async function postgresDatabase() {
  const { neon } = await import('@neondatabase/serverless');
  const sql = neon(databaseUrl);
  return {
    type: 'postgres',
    async exec(statement) {
      for (const part of statement.split(';').map((value) => value.trim()).filter(Boolean)) {
        await sql.query(part);
      }
    },
    async all(statement, params = []) {
      return sql.query(statement, params);
    },
    async get(statement, params = []) {
      const rows = await sql.query(statement, params);
      return rows[0] || null;
    },
    async run(statement, params = []) {
      await sql.query(statement, params);
    }
  };
}

async function createDatabase() {
  if (databaseUrl) return postgresDatabase();
  await mkdir(dirname(databasePath), { recursive: true });
  return sqliteDatabase();
}

const db = await createDatabase();
await db.exec(db.type === 'postgres' ? `
  CREATE TABLE IF NOT EXISTS registrations (
    id SERIAL PRIMARY KEY, first_name TEXT NOT NULL, last_name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE, institution TEXT NOT NULL,
    degrees TEXT NOT NULL, role TEXT NOT NULL, cc_status TEXT DEFAULT 'pending',
    email_status TEXT DEFAULT 'pending', created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS members (
    id SERIAL PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    first_name TEXT DEFAULT '',
    last_name TEXT DEFAULT '',
    institution TEXT DEFAULT '',
    cc_registration_id TEXT DEFAULT '',
    cc_status TEXT DEFAULT 'local',
    last_cc_sync_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS support_requests (
    id SERIAL PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL,
    topic TEXT NOT NULL, message TEXT NOT NULL, status TEXT DEFAULT 'new',
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS magic_links (
    id SERIAL PRIMARY KEY,
    member_id INTEGER NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS library_programs (
    slug TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    short TEXT DEFAULT '',
    description TEXT DEFAULT '',
    position INTEGER NOT NULL DEFAULT 0,
    enabled BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS library_resources (
    id TEXT PRIMARY KEY,
    program_slug TEXT NOT NULL REFERENCES library_programs(slug) ON DELETE CASCADE,
    section TEXT NOT NULL,
    title TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'resource',
    url TEXT NOT NULL,
    group_name TEXT DEFAULT '',
    presenter TEXT DEFAULT '',
    item_date TEXT DEFAULT '',
    meta TEXT DEFAULT '',
    embed_enabled BOOLEAN NOT NULL DEFAULT true,
    videos_json TEXT DEFAULT '[]',
    position INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
` : `
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS registrations (
    id INTEGER PRIMARY KEY, first_name TEXT NOT NULL, last_name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE, institution TEXT NOT NULL,
    degrees TEXT NOT NULL, role TEXT NOT NULL, cc_status TEXT DEFAULT 'pending',
    email_status TEXT DEFAULT 'pending', created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS members (
    id INTEGER PRIMARY KEY,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    first_name TEXT DEFAULT '',
    last_name TEXT DEFAULT '',
    institution TEXT DEFAULT '',
    cc_registration_id TEXT DEFAULT '',
    cc_status TEXT DEFAULT 'local',
    last_cc_sync_at TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS support_requests (
    id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL,
    topic TEXT NOT NULL, message TEXT NOT NULL, status TEXT DEFAULT 'new',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS magic_links (
    id INTEGER PRIMARY KEY,
    member_id INTEGER NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TEXT NOT NULL,
    used_at TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS library_programs (
    slug TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    short TEXT DEFAULT '',
    description TEXT DEFAULT '',
    position INTEGER NOT NULL DEFAULT 0,
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS library_resources (
    id TEXT PRIMARY KEY,
    program_slug TEXT NOT NULL,
    section TEXT NOT NULL,
    title TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'resource',
    url TEXT NOT NULL,
    group_name TEXT DEFAULT '',
    presenter TEXT DEFAULT '',
    item_date TEXT DEFAULT '',
    meta TEXT DEFAULT '',
    embed_enabled INTEGER NOT NULL DEFAULT 1,
    videos_json TEXT DEFAULT '[]',
    position INTEGER NOT NULL DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`);

async function ensureMagicLinksSchema() {
  if (db.type === 'postgres') {
    await db.exec(`
      ALTER TABLE magic_links ADD COLUMN IF NOT EXISTS member_id INTEGER;
      ALTER TABLE magic_links ADD COLUMN IF NOT EXISTS token_hash TEXT;
      ALTER TABLE magic_links ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;
      ALTER TABLE magic_links ADD COLUMN IF NOT EXISTS used_at TIMESTAMPTZ;
      CREATE UNIQUE INDEX IF NOT EXISTS magic_links_token_hash_idx ON magic_links(token_hash);
    `);
    return;
  }

  const columns = new Set((await db.all('PRAGMA table_info(magic_links)')).map((column) => column.name));
  if (!columns.has('member_id')) await db.run('ALTER TABLE magic_links ADD COLUMN member_id INTEGER');
  if (!columns.has('token_hash')) await db.run('ALTER TABLE magic_links ADD COLUMN token_hash TEXT');
  if (!columns.has('expires_at')) await db.run('ALTER TABLE magic_links ADD COLUMN expires_at TEXT');
  if (!columns.has('used_at')) await db.run('ALTER TABLE magic_links ADD COLUMN used_at TEXT');
  await db.run('CREATE UNIQUE INDEX IF NOT EXISTS magic_links_token_hash_idx ON magic_links(token_hash)');
}

await ensureMagicLinksSchema();

const existingRegistrations = await db.all('SELECT * FROM registrations ORDER BY created_at');
for (const r of existingRegistrations) {
  await db.run(`
    INSERT INTO members (email, first_name, last_name, institution, cc_status, created_at, updated_at)
    VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)
    ON CONFLICT(email) DO UPDATE SET
      first_name=excluded.first_name,
      last_name=excluded.last_name,
      institution=excluded.institution,
      updated_at=CURRENT_TIMESTAMP
  `, [r.email, r.first_name || '', r.last_name || '', r.institution || '', r.cc_status || 'legacy', r.created_at || new Date().toISOString()]);
}

const mime = { '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.svg':'image/svg+xml', '.png':'image/png', '.ico':'image/x-icon', '.json':'application/json; charset=utf-8' };
const json = (res, status, body, headers={}) => { res.writeHead(status, { 'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store', ...headers }); res.end(JSON.stringify(body)); };
const sign = value => `${value}.${createHmac('sha256', cookieSecret).update(value).digest('base64url')}`;
const unsign = signed => {
  if (!signed) return '';
  const idx = signed.lastIndexOf('.'); if (idx < 1) return '';
  const value = signed.slice(0, idx), sig = signed.slice(idx + 1), wanted = sign(value).slice(idx + 1);
  if (sig.length !== wanted.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(wanted))) return '';
  return value;
};
const validSigned = (signed, expected) => unsign(signed) === expected;
const tokenHash = token => createHash('sha256').update(token).digest('base64url');
const cookies = req => Object.fromEntries((req.headers.cookie || '').split(';').filter(Boolean).map(x => { const [k,...v]=x.trim().split('='); return [k, decodeURIComponent(v.join('='))]; }));
const memberId = req => {
  const value = unsign(cookies(req).semcme_member);
  if (!value.startsWith('member:')) return 0;
  return Number(value.slice(7)) || 0;
};
const member = req => Boolean(memberId(req));
const admin = req => validSigned(cookies(req).semcme_admin, 'admin');
const cookie = (name, value, days=7) => `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${days*86400}${isProd?'; Secure':''}`;
const clearCookie = name => `${name}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
const readBody = async req => {
  let raw=''; for await (const chunk of req) { raw += chunk; if (raw.length > 1_000_000) throw new Error('Request too large'); }
  try { return JSON.parse(raw || '{}'); } catch { throw new Error('Invalid JSON'); }
};
const clean = (v, max=300) => String(v || '').trim().replace(/[\u0000-\u001f]/g, '').slice(0,max);
const slugOk = v => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(v);
const emailOk = v => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
const escapeHtml = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const stripHtml = html => decodeHtml(String(html || '').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]*>/g, ' ').replace(/\s+\n/g, '\n').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim());
const decodeHtml = value => String(value || '')
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
  .replace(/&nbsp;/g, ' ')
  .replace(/&amp;/g, '&')
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"')
  .replace(/&#39;/g, "'");

async function getSettingJson(key, fallback) {
  const row = await db.get('SELECT value FROM settings WHERE key=$1', [key]);
  if (!row?.value) return fallback;
  try {
    return JSON.parse(row.value);
  } catch {
    return fallback;
  }
}

async function setSettingJson(key, value) {
  await db.run(`
    INSERT INTO settings (key, value)
    VALUES ($1, $2)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value
  `, [key, JSON.stringify(value)]);
}

function uniqueCleanList(values) {
  const seen = new Set();
  return values
    .map((value) => clean(value, 120))
    .filter(Boolean)
    .filter((value) => {
      const key = value.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

async function getVirtualInstitutionSegmentNames() {
  const saved = await getSettingJson('virtual_institution_segment_names', []);
  return uniqueCleanList([...defaultVirtualInstitutionSegments, ...(Array.isArray(saved) ? saved : [])]);
}

async function saveVirtualInstitutionSegmentNames(values) {
  const names = uniqueCleanList(values);
  const defaults = new Set(defaultVirtualInstitutionSegments.map((value) => value.toLowerCase()));
  const custom = names.filter((name) => !defaults.has(name.toLowerCase()));
  await setSettingJson('virtual_institution_segment_names', custom);
  return uniqueCleanList([...defaultVirtualInstitutionSegments, ...custom]);
}

async function addVirtualInstitutionSegmentName(value) {
  const name = clean(value, 120);
  if (!name) throw Object.assign(new Error('Enter an institution name.'), { status:400 });
  const names = await getVirtualInstitutionSegmentNames();
  return saveVirtualInstitutionSegmentNames([...names, name]);
}

async function removeVirtualInstitutionSegmentName(value) {
  const name = clean(value, 120);
  const defaults = new Set(defaultVirtualInstitutionSegments.map((item) => item.toLowerCase()));
  if (defaults.has(name.toLowerCase())) {
    throw Object.assign(new Error('Default institution segments cannot be removed.'), { status:400 });
  }
  const names = await getVirtualInstitutionSegmentNames();
  return saveVirtualInstitutionSegmentNames(names.filter((item) => item.toLowerCase() !== name.toLowerCase()));
}

let loadedStoredConstantContactTokens = false;
async function loadStoredConstantContactTokens() {
  if (loadedStoredConstantContactTokens) return;
  loadedStoredConstantContactTokens = true;
  const tokens = await getSettingJson('constant_contact_tokens', null);
  if (!tokens) return;
  ccTokenState.accessToken = tokens.accessToken || tokens.access_token || ccTokenState.accessToken;
  ccTokenState.refreshToken = tokens.refreshToken || tokens.refresh_token || ccTokenState.refreshToken;
}

async function saveStoredConstantContactTokens() {
  await setSettingJson('constant_contact_tokens', {
    accessToken: ccTokenState.accessToken,
    refreshToken: ccTokenState.refreshToken
  });
}

function constantContactAuthorizationUrl(state) {
  const params = new URLSearchParams({
    client_id: ccClientId,
    response_type: 'code',
    redirect_uri: ccRedirectUri,
    scope: 'account_read contact_data offline_access',
    state
  });
  return `https://authz.constantcontact.com/oauth2/default/v1/authorize?${params}`;
}

async function exchangeConstantContactAuthorizationCode(code) {
  if (!ccClientId || !ccClientSecret) throw new Error('Constant Contact client credentials are not configured.');
  const credentials = Buffer.from(`${ccClientId}:${ccClientSecret}`).toString('base64');
  const response = await fetch('https://authz.constantcontact.com/oauth2/default/v1/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json'
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: ccRedirectUri
    })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = data.error_description || data.error || '';
    throw new Error(`Constant Contact authorization failed ${response.status}${detail ? `: ${detail}` : ''}`);
  }
  ccTokenState.accessToken = data.access_token || '';
  ccTokenState.refreshToken = data.refresh_token || ccTokenState.refreshToken;
  ccTokenState.expiresAt = Date.now() + Math.max(Number(data.expires_in || 0) - 300, 60) * 1000;
  await saveStoredConstantContactTokens();
  return data;
}

function resourceShouldEmbed(resource) {
  const title = String(resource.title || '').toLowerCase();
  return ![
    'pediatric lunch & learn — videos from 2022 to 2025',
    'ob/gyn and fetal assessment — videos from 2020 to 2024'
  ].includes(title);
}

function resourceIsRetired(resource) {
  return String(resource.title || '').toLowerCase() === 'structural and social antecedents of health — virtual training';
}

function normalizeSection(section) {
  return ['upcoming', 'current', 'archives'].includes(section) ? section : '';
}

function parseVideos(raw) {
  try {
    const videos = JSON.parse(raw || '[]');
    return Array.isArray(videos) ? videos.filter(v => v?.title && v?.url) : [];
  } catch {
    return [];
  }
}

function rowToResource(row) {
  const resource = {
    id: row.id,
    title: row.title,
    type: row.type || 'resource',
    url: row.url,
    group: row.group_name || '',
    presenter: row.presenter || '',
    date: row.item_date || '',
    meta: row.meta || '',
    position: Number(row.position || 0),
    embed: Boolean(row.embed_enabled),
    videos: parseVideos(row.videos_json)
  };
  Object.keys(resource).forEach((key) => {
    if (resource[key] === '' || (Array.isArray(resource[key]) && resource[key].length === 0)) delete resource[key];
  });
  return resource;
}

async function seedLibraryContent() {
  const existing = await db.get('SELECT COUNT(*) AS count FROM library_programs');
  if (Number(existing?.count || 0) > 0) return;

  for (const [programIndex, program] of defaultPrograms.entries()) {
    await db.run(`
      INSERT INTO library_programs (slug, name, short, description, position, enabled)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT(slug) DO UPDATE SET
        name=excluded.name,
        short=excluded.short,
        description=excluded.description,
        position=excluded.position,
        enabled=excluded.enabled,
        updated_at=CURRENT_TIMESTAMP
    `, [program.slug, program.name, program.short || '', program.description || '', programIndex, true]);

    for (const section of ['upcoming', 'current', 'archives']) {
      const resources = program[section] || [];
      for (const [resourceIndex, resource] of resources.entries()) {
        if (resourceIsRetired(resource)) continue;
        await db.run(`
          INSERT INTO library_resources (
            id, program_slug, section, title, type, url, group_name, presenter, item_date, meta, embed_enabled, videos_json, position
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
        `, [
          randomBytes(16).toString('hex'),
          program.slug,
          section,
          resource.title || 'Untitled resource',
          resource.type || 'resource',
          resource.url || '#',
          resource.group || '',
          resource.presenter || '',
          resource.date || '',
          resource.meta || '',
          resourceShouldEmbed(resource),
          JSON.stringify(resource.videos || []),
          resourceIndex
        ]);
      }
    }
  }
}

async function getLibraryPrograms({ includeDisabled = false } = {}) {
  const enabledWhere = includeDisabled ? '' : (db.type === 'postgres' ? 'WHERE enabled=true' : 'WHERE enabled=1');
  const programRows = await db.all(`
    SELECT * FROM library_programs
    ${enabledWhere}
    ORDER BY position ASC, name ASC
  `);
  const resourceRows = await db.all('SELECT * FROM library_resources ORDER BY position ASC, title ASC');
  const byProgram = new Map();
  for (const row of resourceRows) {
    if (!byProgram.has(row.program_slug)) byProgram.set(row.program_slug, []);
    byProgram.get(row.program_slug).push(row);
  }
  return programRows.map((program) => {
    const resources = byProgram.get(program.slug) || [];
    const out = {
      slug: program.slug,
      name: program.name,
      short: program.short || '',
      description: program.description || '',
      position: Number(program.position || 0),
      enabled: program.enabled === true || program.enabled === 1 || program.enabled === '1' || program.enabled === 't',
      upcoming: [],
      current: [],
      archives: []
    };
    for (const row of resources) {
      if (!normalizeSection(row.section)) continue;
      out[row.section].push(rowToResource(row));
    }
    return out;
  });
}

async function saveLibraryProgram(payload = {}) {
  const slug = clean(payload.slug, 100).toLowerCase();
  const name = clean(payload.name, 180);
  if (!slugOk(slug)) throw Object.assign(new Error('Use a URL-safe program slug like faculty-development.'), { status:400 });
  if (!name) throw Object.assign(new Error('Program name is required.'), { status:400 });
  await db.run(`
    INSERT INTO library_programs (slug, name, short, description, position, enabled)
    VALUES ($1, $2, $3, $4, $5, $6)
    ON CONFLICT(slug) DO UPDATE SET
      name=excluded.name,
      short=excluded.short,
      description=excluded.description,
      position=excluded.position,
      enabled=excluded.enabled,
      updated_at=CURRENT_TIMESTAMP
  `, [
    slug,
    name,
    clean(payload.short, 12).toUpperCase(),
    clean(payload.description, 600),
    Number(payload.position || 0) || 0,
    payload.enabled === false || payload.enabled === 'false' ? false : true
  ]);
  return { slug };
}

async function deleteLibraryProgram(slug) {
  slug = clean(slug, 100);
  if (!slugOk(slug)) throw Object.assign(new Error('Program slug is required.'), { status:400 });
  await db.run('DELETE FROM library_resources WHERE program_slug=$1', [slug]);
  await db.run('DELETE FROM library_programs WHERE slug=$1', [slug]);
}

function normalizeResourcePayload(payload = {}) {
  const section = normalizeSection(clean(payload.section, 40));
  const type = clean(payload.type || 'resource', 40);
  return {
    id: clean(payload.id, 80),
    programSlug: clean(payload.programSlug || payload.program_slug, 100),
    section,
    title: clean(payload.title, 240),
    type: ['recording', 'playlist', 'course', 'resource'].includes(type) ? type : 'resource',
    url: clean(payload.url, 1000),
    groupName: clean(payload.group || payload.groupName || payload.group_name, 160),
    presenter: clean(payload.presenter, 500),
    itemDate: clean(payload.date || payload.itemDate || payload.item_date, 120),
    meta: clean(payload.meta, 240),
    embedEnabled: payload.embedEnabled === false || payload.embed_enabled === false || payload.embedEnabled === 'false' ? false : true,
    position: Number(payload.position || 0) || 0
  };
}

async function saveLibraryResource(payload = {}) {
  const item = normalizeResourcePayload(payload);
  if (!slugOk(item.programSlug)) throw Object.assign(new Error('Choose a program for this item.'), { status:400 });
  if (!item.section) throw Object.assign(new Error('Choose upcoming, current, or archive.'), { status:400 });
  if (!item.title) throw Object.assign(new Error('Title is required.'), { status:400 });
  if (!item.url || !/^https?:\/\//i.test(item.url)) throw Object.assign(new Error('Enter a full https:// URL.'), { status:400 });
  const program = await db.get('SELECT slug FROM library_programs WHERE slug=$1', [item.programSlug]);
  if (!program) throw Object.assign(new Error('That program does not exist.'), { status:400 });

  const existing = item.id ? await db.get('SELECT videos_json FROM library_resources WHERE id=$1', [item.id]) : null;
  const id = item.id && existing ? item.id : randomBytes(16).toString('hex');
  const videosJson = existing?.videos_json || '[]';
  await db.run(`
    INSERT INTO library_resources (
      id, program_slug, section, title, type, url, group_name, presenter, item_date, meta, embed_enabled, videos_json, position
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
    ON CONFLICT(id) DO UPDATE SET
      program_slug=excluded.program_slug,
      section=excluded.section,
      title=excluded.title,
      type=excluded.type,
      url=excluded.url,
      group_name=excluded.group_name,
      presenter=excluded.presenter,
      item_date=excluded.item_date,
      meta=excluded.meta,
      embed_enabled=excluded.embed_enabled,
      position=excluded.position,
      updated_at=CURRENT_TIMESTAMP
  `, [
    id,
    item.programSlug,
    item.section,
    item.title,
    item.type,
    item.url,
    item.groupName,
    item.presenter,
    item.itemDate,
    item.meta,
    item.embedEnabled,
    videosJson,
    item.position
  ]);
  return { id };
}

async function deleteLibraryResource(id) {
  id = clean(id, 80);
  if (!id) throw Object.assign(new Error('Resource id is required.'), { status:400 });
  await db.run('DELETE FROM library_resources WHERE id=$1', [id]);
}

await seedLibraryContent();

async function sendEmail({to, subject, html, text=''}) {
  if (!process.env.RESEND_API_KEY) return 'not_configured';
  const payload = { from:process.env.EMAIL_FROM || 'SEMCME Virtual Membership <members@semcme.org>', to:[to], subject, html };
  if (text) payload.text = text;
  const r = await fetch('https://api.resend.com/emails', {
    method:'POST',
    headers:{ Authorization:`Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type':'application/json' },
    body:JSON.stringify(payload)
  });
  if (!r.ok) throw new Error(`Email provider returned ${r.status}`);
  return 'sent';
}

function buildMagicLinkEmail(signInUrl) {
  const safeSignInUrl = escapeHtml(signInUrl);
  const logoUrl = `${magicLinkBaseUrl()}/semcme-logo.png`;
  const subject = 'Your SEMCME Virtual Membership Sign-In Link';
  const text = [
    'Use this secure Sign-In Link to access your SEMCME Virtual Membership program materials:',
    '',
    signInUrl,
    '',
    'This Sign-In Link expires in 30 minutes and can only be used once.',
    '',
    'If you did not request this Sign-In Link, you can ignore this email.',
    '',
    'Southeast Michigan Center for Medical Education',
    'https://semcme.org'
  ].join('\n');
  const html = `
    <!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <meta name="x-apple-disable-message-reformatting">
        <title>SEMCME Virtual Membership Sign-In Link</title>
      </head>
      <body style="margin:0;padding:0;background:#ffffff;color:#262626;font-family:Arial,Helvetica,sans-serif;">
        <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">
          Your secure SEMCME Virtual Membership Sign-In Link expires in 30 minutes.
        </div>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;border-collapse:collapse;">
          <tr>
            <td align="center" style="padding:52px 18px 40px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:720px;background:#ffffff;border-collapse:collapse;">
                <tr>
                  <td align="center" style="padding:0 0 38px;">
                    <img src="${escapeHtml(logoUrl)}" width="292" alt="Southeast Michigan Center for Medical Education" style="display:block;width:292px;max-width:100%;height:auto;border:0;">
                  </td>
                </tr>
                <tr>
                  <td style="height:6px;background:#00519d;font-size:0;line-height:0;">&nbsp;</td>
                </tr>
                <tr>
                  <td style="padding:64px 36px 0;">
                    <h1 style="margin:0;color:#00519d;font-size:34px;line-height:1.2;font-weight:700;">Access Your Virtual Membership</h1>
                  </td>
                </tr>
                <tr>
                  <td style="padding:28px 36px 0;">
                    <p style="margin:0 0 24px;color:#262626;font-size:20px;line-height:1.5;">
                      Use the secure Sign-In Link below to sign in to the SEMCME Virtual Membership program materials.
                    </p>
                    <p style="margin:0;color:#262626;font-size:20px;line-height:1.5;">
                      This Sign-In Link expires in 30 minutes and can only be used once.
                    </p>
                  </td>
                </tr>
                <tr>
                  <td align="center" style="padding:48px 36px 44px;">
                    <a href="${safeSignInUrl}" style="display:inline-block;min-width:260px;padding:18px 28px;border-radius:8px;background:#00519d;color:#ffffff;font-size:20px;line-height:1.2;text-align:center;text-decoration:none;font-weight:700;">
                      Open Virtual Membership
                    </a>
                  </td>
                </tr>
                <tr>
                  <td style="padding:0 36px 18px;">
                    <p style="margin:0 0 24px;color:#555555;font-size:17px;line-height:1.5;">
                      If you did not request this Sign-In Link, you can ignore this email.
                    </p>
                    <p style="margin:0;color:#555555;font-size:17px;line-height:1.5;">
                      &mdash; SEMCME Virtual Membership Team
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </body>
    </html>
  `;
  return { subject, text, html };
}

async function upsertMemberFromContact(contact, source='constant_contact_list') {
  const email = extractEmail(contact);
  if (!emailOk(email)) return null;
  const name = extractName(contact);
  const contactId = clean(contact.contact_id || contact.id || '', 160);
  const institution = await extractInstitution(contact);
  await db.run(`
    INSERT INTO members (email, first_name, last_name, institution, cc_registration_id, cc_status, last_cc_sync_at, updated_at)
    VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    ON CONFLICT(email) DO UPDATE SET
      first_name=COALESCE(NULLIF(excluded.first_name,''), members.first_name),
      last_name=COALESCE(NULLIF(excluded.last_name,''), members.last_name),
      institution=COALESCE(NULLIF(excluded.institution,''), members.institution),
      cc_registration_id=COALESCE(NULLIF(excluded.cc_registration_id,''), members.cc_registration_id),
      cc_status=excluded.cc_status,
      last_cc_sync_at=CURRENT_TIMESTAMP,
      updated_at=CURRENT_TIMESTAMP
  `, [email, name.firstName, name.lastName, institution, contactId, source]);
  return db.get('SELECT * FROM members WHERE email=$1', [email]);
}

function extractEmail(value) {
  const preferred = [
    value?.email_address?.address,
    value?.email_address?.email_address,
    value?.email_address,
    value?.email,
    value?.contact?.email_address?.address,
    value?.contact?.email_address?.email_address,
    value?.contact?.email_address,
    value?.contact?.email
  ];
  for (const item of preferred) {
    if (typeof item === 'string' && emailOk(item)) return clean(item.toLowerCase(), 200);
  }
  const emailCollections = [
    value?.email_addresses,
    value?.emailAddresses,
    value?.contact?.email_addresses,
    value?.contact?.emailAddresses
  ].filter(Array.isArray);
  for (const collection of emailCollections) {
    for (const item of collection) {
      const email = typeof item === 'string'
        ? item
        : item?.address || item?.email_address || item?.email;
      if (typeof email === 'string' && emailOk(email)) return clean(email.toLowerCase(), 200);
    }
  }
  const emails = [];
  const walk = v => {
    if (!v) return;
    if (typeof v === 'string') {
      const found = v.match(/[^\s@"'<>]+@[^\s@"'<>]+\.[^\s@"'<>]+/g);
      if (found) emails.push(...found);
      return;
    }
    if (Array.isArray(v)) return v.forEach(walk);
    if (typeof v === 'object') {
      for (const [key, item] of Object.entries(v)) {
        if (/email/i.test(key) && typeof item === 'string') emails.unshift(item);
        else walk(item);
      }
    }
  };
  walk(value);
  return clean((emails[0] || '').toLowerCase(), 200);
}

function extractName(contact) {
  const firstName = clean(contact.first_name || contact.firstName || contact.contact?.first_name || contact.contact?.firstName || '', 80);
  const lastName = clean(contact.last_name || contact.lastName || contact.contact?.last_name || contact.contact?.lastName || '', 80);
  if (firstName || lastName) return { firstName, lastName };
  const full = clean(contact.name || contact.full_name || contact.contact?.name || '', 180).split(/\s+/);
  return { firstName: full[0] || '', lastName: full.slice(1).join(' ') };
}

function customFieldId(item) {
  return clean(item?.custom_field_id || item?.customFieldId || item?.id || item?.field_id || item?.fieldId || '', 160);
}

function customFieldName(item) {
  return clean(item?.label || item?.name || item?.custom_field_label || item?.customFieldLabel || item?.custom_field_name || item?.customFieldName || item?.field_name || item?.fieldName || '', 200);
}

function customFieldValue(item) {
  const value = item?.value ?? item?.custom_field_value ?? item?.customFieldValue ?? item?.answer ?? item?.field_value ?? item?.fieldValue ?? item?.text ?? item?.choice_label ?? item?.choice_id;
  if (typeof value === 'string' || typeof value === 'number') return clean(value, 200);
  if (Array.isArray(value)) {
    return value
      .map((entry) => typeof entry === 'string' || typeof entry === 'number'
        ? clean(entry, 200)
        : clean(entry?.value || entry?.choice_label || entry?.choice_id || entry?.label || '', 200))
      .filter(Boolean)
      .join(', ');
  }
  if (value && typeof value === 'object') {
    return clean(value.value || value.choice_label || value.choice_id || value.label || '', 200);
  }
  return '';
}

let ccCustomFieldNameCache = null;
let ccVirtualInstitutionResolvedFieldId = '';
const normalizeFieldKey = value => clean(value, 200).toLowerCase().replace(/[^a-z0-9]+/g, '');
async function constantContactCustomFieldDefinitions() {
  if (ccCustomFieldNameCache) return ccCustomFieldNameCache;
  ccCustomFieldNameCache = new Map();
  try {
    let url = `${ccBase}/contact_custom_fields?limit=100`;
    for (let page = 0; page < 10 && url; page += 1) {
      const data = await constantContactGet(url);
      const fields = data.custom_fields || data.records || [];
      for (const field of fields) {
        const id = customFieldId(field);
        const name = customFieldName(field);
        const choiceLabels = new Map();
        for (const choice of field.choices || field.options || field.values || []) {
          const choiceId = clean(choice.choice_id || choice.id || choice.value || choice.option_id || '', 200);
          const choiceLabel = clean(choice.choice_label || choice.label || choice.name || choice.option_label || '', 200);
          if (choiceId && choiceLabel) choiceLabels.set(choiceId, choiceLabel);
        }
        if (id) ccCustomFieldNameCache.set(id, { id, name, label:clean(field.label || '', 200), rawName:clean(field.name || '', 200), choiceLabels });
      }
      url = constantContactNextUrl(data);
    }
  } catch {
    /* Custom field labels are a best-effort enhancement; contact sync can continue without them. */
  }
  return ccCustomFieldNameCache;
}

function fieldDefinitionText(definition) {
  return [definition?.label, definition?.name, definition?.rawName].filter(Boolean).join(' ');
}

async function virtualInstitutionCustomFieldId() {
  if (ccVirtualInstitutionFieldId) return ccVirtualInstitutionFieldId;
  if (ccVirtualInstitutionResolvedFieldId) return ccVirtualInstitutionResolvedFieldId;
  const target = normalizeFieldKey(ccVirtualInstitutionFieldName || virtualInstitutionFieldLabel);
  const fallbackTarget = normalizeFieldKey(virtualInstitutionFieldLabel);
  const definitions = await constantContactCustomFieldDefinitions();
  for (const definition of definitions.values()) {
    const labels = [definition.label, definition.name, definition.rawName].map(normalizeFieldKey);
    if (labels.includes(target) || labels.includes(fallbackTarget)) {
      ccVirtualInstitutionResolvedFieldId = definition.id;
      return definition.id;
    }
  }
  return '';
}

function resolveCustomFieldValue(field, definition) {
  const rawValue = customFieldValue(field);
  if (!rawValue) return '';
  if (!definition?.choiceLabels?.size) return rawValue;
  return rawValue
    .split(',')
    .map((value) => {
      const trimmed = clean(value, 200);
      return definition.choiceLabels.get(trimmed) || trimmed;
    })
    .filter(Boolean)
    .join(', ');
}

function directInstitutionValues(contact) {
  const values = [];
  const walk = (v, path = '') => {
    if (!v) return;
    if (Array.isArray(v)) return v.forEach((item, index) => walk(item, `${path}[${index}]`));
    if (typeof v !== 'object') return;
    for (const [key, item] of Object.entries(v)) {
      const nextPath = path ? `${path}.${key}` : key;
      if (/institution|organization|company|employer/i.test(key) && typeof item === 'string') values.push(item);
      else walk(item, nextPath);
    }
  };
  walk(contact);
  return values.map((value) => clean(value, 200)).filter(Boolean);
}

async function extractInstitution(contact) {
  const customFields = [
    ...(Array.isArray(contact.custom_fields) ? contact.custom_fields : []),
    ...(Array.isArray(contact.customFields) ? contact.customFields : []),
    ...(Array.isArray(contact.contact_custom_fields) ? contact.contact_custom_fields : []),
    ...(Array.isArray(contact.contactCustomFields) ? contact.contactCustomFields : []),
    ...(Array.isArray(contact.contact?.custom_fields) ? contact.contact.custom_fields : []),
    ...(Array.isArray(contact.contact?.customFields) ? contact.contact.customFields : []),
    ...(Array.isArray(contact.contact?.contact_custom_fields) ? contact.contact.contact_custom_fields : [])
  ];
  if (customFields.length) {
    const fieldDefinitions = await constantContactCustomFieldDefinitions();
    const virtualFieldId = await virtualInstitutionCustomFieldId();
    if (!virtualFieldId) return '';
    const field = customFields.find((item) => customFieldId(item) === virtualFieldId);
    const value = field ? resolveCustomFieldValue(field, fieldDefinitions.get(virtualFieldId)) : '';
    if (value) return value;
    return '';
  }
  return '';
}

async function refreshConstantContactAccessToken() {
  await loadStoredConstantContactTokens();
  if (!ccClientId || !ccClientSecret || !ccTokenState.refreshToken) {
    throw new Error('Constant Contact access token expired and refresh credentials are not configured.');
  }
  const credentials = Buffer.from(`${ccClientId}:${ccClientSecret}`).toString('base64');
  const r = await fetch('https://authz.constantcontact.com/oauth2/default/v1/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json'
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: ccTokenState.refreshToken
    })
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const detail = data.error_description || data.error || '';
    throw new Error(`Constant Contact token refresh returned ${r.status}${detail ? `: ${detail}` : '. Reconnect Constant Contact and update the access/refresh token env variables.'}`);
  }
  ccTokenState.accessToken = data.access_token || '';
  ccTokenState.refreshToken = data.refresh_token || ccTokenState.refreshToken;
  ccTokenState.expiresAt = Date.now() + Math.max(Number(data.expires_in || 0) - 300, 60) * 1000;
  await saveStoredConstantContactTokens();
  return ccTokenState.accessToken;
}

async function constantContactAccessToken() {
  await loadStoredConstantContactTokens();
  if (ccTokenState.accessToken && (!ccTokenState.expiresAt || Date.now() < ccTokenState.expiresAt)) {
    return ccTokenState.accessToken;
  }
  return refreshConstantContactAccessToken();
}

async function constantContactGetResponse(url, retry = true) {
  const token = await constantContactAccessToken();
  const r = await fetch(url, { headers:{ Authorization:`Bearer ${token}` } });
  if (r.status === 401 && retry && ccClientId && ccClientSecret && ccTokenState.refreshToken) {
    ccTokenState.accessToken = '';
    await refreshConstantContactAccessToken();
    return constantContactGetResponse(url, false);
  }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Constant Contact returned ${r.status}`);
  return { status:r.status, data };
}

async function constantContactGet(url, retry = true) {
  const response = await constantContactGetResponse(url, retry);
  return response.data;
}

function constantContactNextUrl(data) {
  const next = data._links?.next?.href || data.links?.next || '';
  return next ? (next.startsWith('http') ? next : `${ccBase}${next}`) : '';
}

let resolvedVirtualMembersListId = '';
async function virtualMembersListId() {
  if (resolvedVirtualMembersListId) return resolvedVirtualMembersListId;
  if (ccVirtualMembersListId) {
    resolvedVirtualMembersListId = ccVirtualMembersListId;
    return resolvedVirtualMembersListId;
  }

  const url = `${ccBase}/contact_lists?name=${encodeURIComponent(ccVirtualMembersListName)}&status=active&limit=50`;
  const data = await constantContactGet(url);
  const lists = data.lists || data.contact_lists || [];
  const match = lists.find((list) => list.name === ccVirtualMembersListName) || lists[0];
  if (!match?.list_id) throw new Error(`Constant Contact list not found: ${ccVirtualMembersListName}`);
  resolvedVirtualMembersListId = match.list_id;
  return resolvedVirtualMembersListId;
}

function contactRecords(data) {
  return data.contacts || data.records || [];
}

function normalizeInstitutionKey(value) {
  return clean(value, 240).toLowerCase().replace(/[–—]/g, '-').replace(/[^a-z0-9]+/g, '');
}

function institutionFromSegmentName(name, institutionNames) {
  const segmentLabel = clean(name, 240);
  const conventionMatch = segmentLabel.match(/^Virtual\s+Membership\s*[-–—:]\s*(.*?)\s+Contacts?$/i);
  const conventionValue = clean(conventionMatch?.[1] || '', 120);
  if (conventionValue) {
    return institutionNames.find((institution) => normalizeInstitutionKey(institution) === normalizeInstitutionKey(conventionValue)) || '';
  }

  const segmentKey = normalizeInstitutionKey(name);
  if (!segmentKey) return '';
  const directMatch = [...institutionNames]
    .sort((a, b) => b.length - a.length)
    .find((institution) => segmentKey.includes(normalizeInstitutionKey(institution)));
  if (directMatch) return directMatch;

  const stripped = clean(name, 240)
    .replace(/\b(virtual|member|members|institution|institutions|segment|contacts?|all)\b/gi, ' ')
    .replace(/\s*[-–—:|]\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (normalizeInstitutionKey(stripped) === 'semcme') return 'SEMCME';
  if (!stripped || normalizeInstitutionKey(stripped) === segmentKey) return '';

  return institutionNames.find((institution) => normalizeInstitutionKey(stripped) === normalizeInstitutionKey(institution)) || '';
}

async function constantContactSegments() {
  const segments = [];
  let url = `${ccBase}/segments?limit=1000&sort_by=name`;
  for (let page = 0; page < 10 && url; page += 1) {
    const data = await constantContactGet(url);
    segments.push(...(data.segments || data.records || []));
    url = constantContactNextUrl(data);
  }
  return segments;
}

async function constantContactSegmentContacts(segmentId) {
  const records = [];
  let url = `${ccBase}/contacts?segment_id=${encodeURIComponent(segmentId)}&limit=500`;
  for (let page = 0; page < 20 && url; page += 1) {
    let response = await constantContactGetResponse(url);
    for (let attempt = 0; response.status === 202 && attempt < 5; attempt += 1) {
      await delay(750);
      response = await constantContactGetResponse(url);
    }
    records.push(...contactRecords(response.data));
    url = constantContactNextUrl(response.data);
  }
  return records;
}

async function updateMemberInstitution(email, institution) {
  const cleanEmail = clean(email, 200).toLowerCase();
  const cleanInstitution = clean(institution, 200);
  if (!emailOk(cleanEmail) || !cleanInstitution) return null;
  await db.run(
    'UPDATE members SET institution=$1, updated_at=CURRENT_TIMESTAMP WHERE lower(email)=lower($2)',
    [cleanInstitution, cleanEmail]
  );
  return db.get('SELECT * FROM members WHERE lower(email)=lower($1)', [cleanEmail]);
}

async function findInstitutionForEmailFromSegments(email) {
  const cleanEmail = clean(email, 200).toLowerCase();
  if (!emailOk(cleanEmail)) return '';
  const segments = await constantContactSegments();
  const institutionNames = await getVirtualInstitutionSegmentNames();

  for (const segment of segments) {
    const segmentId = clean(segment.segment_id || segment.id || '', 160);
    const institution = institutionFromSegmentName(segment.name || segment.segment_name || '', institutionNames);
    if (!segmentId || !institution) continue;
    const contacts = await constantContactSegmentContacts(segmentId);
    if (contacts.some((contact) => extractEmail(contact) === cleanEmail)) return institution;
  }
  return '';
}

async function syncMemberInstitutionFromSegments(email) {
  const institution = await findInstitutionForEmailFromSegments(email);
  return institution ? updateMemberInstitution(email, institution) : null;
}

async function syncMemberInstitutionsFromSegments() {
  const segments = await constantContactSegments();
  const institutionNames = await getVirtualInstitutionSegmentNames();
  let matchedSegments = 0;
  let checkedContacts = 0;
  let updated = 0;
  const seen = new Set();

  for (const segment of segments) {
    const segmentId = clean(segment.segment_id || segment.id || '', 160);
    const institution = institutionFromSegmentName(segment.name || segment.segment_name || '', institutionNames);
    if (!segmentId || !institution) continue;
    matchedSegments += 1;

    const contacts = await constantContactSegmentContacts(segmentId);
    for (const contact of contacts) {
      const email = extractEmail(contact);
      if (!email || seen.has(email)) continue;
      seen.add(email);
      checkedContacts += 1;
      const existing = await db.get('SELECT institution FROM members WHERE lower(email)=lower($1)', [email]);
      if (!existing) continue;
      if (clean(existing.institution || '', 200) === institution) continue;
      await updateMemberInstitution(email, institution);
      updated += 1;
    }
  }

  return { institutionSynced:updated, institutionSegments:matchedSegments, institutionContactsChecked:checkedContacts };
}

async function constantContactContactDetail(contact) {
  const contactId = clean(contact?.contact_id || contact?.id || '', 160);
  if (!contactId) return contact;
  const params = new URLSearchParams({ include:'custom_fields' });
  const detail = await constantContactGet(`${ccBase}/contacts/${encodeURIComponent(contactId)}?${params}`);
  return { ...contact, ...detail };
}

async function constantContactListMembershipCount(listId, mode) {
  try {
    const data = await constantContactGet(`${ccBase}/contact_lists/${encodeURIComponent(listId)}?include_membership_count=${mode}`);
    return Number.isFinite(Number(data.membership_count)) ? Number(data.membership_count) : null;
  } catch {
    return null;
  }
}

async function constantContactListSummary(listId) {
  const [allCount, activeCount] = await Promise.all([
    constantContactListMembershipCount(listId, 'all'),
    constantContactListMembershipCount(listId, 'active')
  ]);
  return { allCount, activeCount };
}

async function constantContactListContacts({ email = '' } = {}) {
  if (!constantContactConfigured) return { configured:false, records:[] };
  const listId = await virtualMembersListId();
  const params = new URLSearchParams({
    lists: listId,
    status: 'all',
    include: 'list_memberships,custom_fields',
    include_count: 'true',
    limit: email ? '1' : '500'
  });
  if (email) params.set('email', email);

  let url = `${ccBase}/contacts?${params}`;
  const records = [];
  for (let page = 0; page < 20 && url; page += 1) {
    const data = await constantContactGet(url);
    records.push(...contactRecords(data));
    url = constantContactNextUrl(data);
  }
  return { configured:true, records, listId, listName:ccVirtualMembersListName };
}

async function findConstantContactListMember(email) {
  const result = await constantContactListContacts({ email });
  if (!result.configured) return { configured:false, member:null };
  const match = result.records.find(r => extractEmail(r) === email);
  if (!match) return { configured:true, member:null };
  let member = await upsertMemberFromContact(await constantContactContactDetail(match));
  if (member && !member.institution) {
    try {
      member = await syncMemberInstitutionFromSegments(email) || member;
    } catch (e) {
      console.error(e.message);
    }
  }
  return { configured:true, member };
}

async function syncConstantContactMembers() {
  const result = await constantContactListContacts();
  if (!result.configured) return { configured:false, synced:0, databaseType:db.type };
  const listSummary = await constantContactListSummary(result.listId);
  let synced = 0;
  let skipped = 0;
  let missingInstitutions = 0;
  for (const record of result.records) {
    const detail = await constantContactContactDetail(record);
    const member = await upsertMemberFromContact(detail);
    if (member) {
      synced += 1;
      if (!member.institution) missingInstitutions += 1;
    } else {
      skipped += 1;
    }
  }
  const institutionResult = await syncMemberInstitutionsFromSegments();
  return { configured:true, synced, checked:result.records.length, skipped, missingInstitutions, ...institutionResult, databaseType:db.type, listId:result.listId, listName:result.listName, listAllCount:listSummary.allCount, listActiveCount:listSummary.activeCount };
}

async function createMagicLink(memberRow) {
  const nonce = randomBytes(12).toString('base64url');
  const expiresAt = Date.now() + magicLinkTtlMs;
  const payload = {
    email: memberRow.email,
    first_name: memberRow.first_name || '',
    last_name: memberRow.last_name || '',
    institution: memberRow.institution || '',
    contact_id: memberRow.cc_registration_id || '',
    source: memberRow.cc_status || 'constant_contact_list',
    exp: expiresAt,
    nonce
  };
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = createHmac('sha256', cookieSecret).update(body).digest('base64url');
  const token = `${body}.${sig}`;
  await db.run(
    'INSERT INTO magic_links (member_id, token_hash, expires_at) VALUES ($1, $2, $3)',
    [memberRow.id, tokenHash(token), new Date(expiresAt).toISOString()]
  );
  return `${magicLinkBaseUrl()}/?token=${encodeURIComponent(token)}`;
}

async function requestMagicLink(email) {
  let row = await db.get('SELECT * FROM members WHERE email=$1', [email]);
  let source = row ? 'database' : '';
  if (row && !row.institution && constantContactConfigured) {
    try {
      row = await syncMemberInstitutionFromSegments(email) || row;
    } catch (e) {
      console.error(e.message);
    }
  }
  if (!row) {
    const checked = await findConstantContactListMember(email);
    if (!checked.configured) throw Object.assign(new Error('Constant Contact list lookup is not configured for Virtual Membership yet.'), { status:503 });
    row = checked.member;
    source = row ? 'constant_contact_list' : '';
  }
  if (!row) throw Object.assign(new Error('This email is not registered for SEMCME Virtual Membership.'), { status:404, registrationUrl });
  const signInUrl = await createMagicLink(row);
  const signInEmail = buildMagicLinkEmail(signInUrl);
  const mail = await sendEmail({
    to: email,
    ...signInEmail
  });
  if (mail === 'not_configured' && isProd) {
    throw Object.assign(new Error('Email delivery is not configured yet.'), { status:503 });
  }
  return {
    emailSent: mail === 'sent',
    source,
    signInUrl: mail === 'not_configured' ? signInUrl : undefined,
    message: 'Success. Check your email for a secure Sign-In Link. It expires in 30 minutes, can only be used once, and may take up to 3 minutes to arrive. Please check your spam or junk folder if it does not appear in your inbox.'
  };
}

async function verifyMagicToken(token) {
  const [body, sig] = String(token || '').split('.');
  if (!body || !sig) return null;
  const wanted = createHmac('sha256', cookieSecret).update(body).digest('base64url');
  if (sig.length !== wanted.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(wanted))) return null;

  let payload;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }

  if (!payload?.exp || Date.now() > Number(payload.exp)) return null;
  const consumed = await db.get(
    'UPDATE magic_links SET used_at=CURRENT_TIMESTAMP WHERE token_hash=$1 AND used_at IS NULL RETURNING token_hash',
    [tokenHash(`${body}.${sig}`)]
  );
  if (!consumed) return null;
  const email = clean(payload.email, 200).toLowerCase();
  if (!emailOk(email)) return null;

  return upsertMemberFromContact(
    {
      email,
      first_name: payload.first_name,
      last_name: payload.last_name,
      institution: payload.institution,
      contact_id: payload.contact_id
    },
    payload.source || 'constant_contact_list'
  );
}

let virtualEventsCache = { at: 0, events: [] };
async function getVirtualEvents(force=false) {
  if (!force && virtualEventsCache.at > Date.now() - semcmeHeroRefreshMs) return virtualEventsCache.events;
  const storedEvents = await getSettingJson('virtual_hero_events', []);
  const r = await fetch(semcmeHomeUrl);
  if (!r.ok) throw new Error(`SEMCME homepage returned ${r.status}`);
  const html = await r.text();
  const events = parseSemcmeVirtualSlides(html);
  if (!events.length) {
    const fallbackEvents = storedEvents.length ? storedEvents : defaultEvents;
    virtualEventsCache = { at: Date.now(), events: fallbackEvents };
    return fallbackEvents;
  }
  await setSettingJson('virtual_hero_events', events);
  virtualEventsCache = { at: Date.now(), events };
  return events;
}

function parseSemcmeVirtualSlides(html) {
  const imageByClass = new Map();
  for (const match of html.matchAll(/\.et_pb_slider\s+\.et_pb_slide_(\d+)[^{]*\{[^}]*background-image:url\(([^)]+)\)/g)) {
    imageByClass.set(match[1], match[2].replace(/^['"]|['"]$/g, ''));
  }
  const slides = [];
  const slideRe = /<div class="[^"]*\bet_pb_slide\b[^"]*\bet_pb_slide_(\d+)\b[^"]*"[\s\S]*?(?=<div class="[^"]*\bet_pb_slide\b[^"]*\bet_pb_slide_\d+\b|<\/div>\s*<\/div>\s*<\/div>\s*<\/div>)/g;
  for (const match of html.matchAll(slideRe)) {
    const index = match[1], block = match[0];
    const titleMatch = block.match(/<h2 class="et_pb_slide_title">\s*<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>\s*<\/h2>/);
    const contentMatch = block.match(/<div class="et_pb_slide_content">([\s\S]*?)<\/div>/);
    const buttonMatch = block.match(/<a class="et_pb_button et_pb_more_button"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
    const title = stripHtml(titleMatch?.[2] || '');
    const description = stripHtml(contentMatch?.[1] || '');
    const searchText = `${title}\n${description}`;
    if (!/virtual/i.test(searchText)) continue;
    slides.push({
      id: `semcme-${index}`,
      eyebrow: 'Virtual program',
      title,
      date: '',
      time: '',
      location: '',
      description,
      ctaLabel: stripHtml(buttonMatch?.[2] || 'Register now'),
      ctaUrl: decodeHtml(buttonMatch?.[1] || titleMatch?.[1] || semcmeHomeUrl),
      backgroundImage: imageByClass.get(index) || '',
      published: true
    });
  }
  return slides;
}

async function api(req, res, path) {
  if (path === '/api/config' && req.method === 'GET') return json(res,200,{ authenticated:member(req), emailConfigured:Boolean(process.env.RESEND_API_KEY), constantContactConfigured, registrationUrl });
  if (path === '/api/auth/request-link' && req.method === 'POST') {
    const b=await readBody(req); const email=clean(b.email,200).toLowerCase();
    if (!emailOk(email)) return json(res,400,{error:'Enter a valid email address.'});
    try { return json(res,200,{ok:true, ...(await requestMagicLink(email))}); }
    catch (e) { return json(res,e.status || 500,{error:e.message || 'Unable to send that sign-in link.', registrationUrl:e.registrationUrl}); }
  }
  if (path === '/api/auth/verify' && req.method === 'POST') {
    const b=await readBody(req); const token=clean(b.token,500);
    const row = token ? await verifyMagicToken(token) : null;
    if (!row) return json(res,401,{error:'That sign-in link is invalid or expired.'});
    return json(res,200,{ok:true,email:row.email},{'Set-Cookie':cookie('semcme_member',sign(`member:${row.id}`))});
  }
  if (path === '/api/logout' && req.method === 'POST') return json(res,200,{ok:true},{'Set-Cookie':clearCookie('semcme_member')});
  if (path === '/api/library' && req.method === 'GET') {
    if (!member(req)) return json(res,401,{error:'Member login required.'});
    let events = [];
    try { events = await getVirtualEvents(); } catch(e) { console.error(e.message); }
    return json(res,200,{banner:defaultBanner,events,programs:await getLibraryPrograms()});
  }
  if (path === '/api/virtual-events' && req.method === 'GET') {
    if (!member(req)) return json(res,401,{error:'Member login required.'});
    let events = [];
    try { events = await getVirtualEvents(); } catch(e) { console.error(e.message); }
    return json(res,200,{events,updatedAt:virtualEventsCache.at});
  }
  if (path === '/api/support' && req.method === 'POST') {
    const b=await readBody(req); const x={name:clean(b.name,160),email:clean(b.email,200),topic:clean(b.topic,100),message:clean(b.message,4000)};
    if (!x.name || !emailOk(x.email) || !x.topic || x.message.length<10) return json(res,400,{error:'Please complete all fields and include a little more detail.'});
    await db.run('INSERT INTO support_requests (name,email,topic,message) VALUES ($1,$2,$3,$4)', [x.name,x.email,x.topic,x.message]);
    let delivered=false; try { delivered=(await sendEmail({to:process.env.SUPPORT_EMAIL || 'cszydlowski@semcme.org',subject:`Virtual Membership question: ${x.topic}`,html:`<p><strong>From:</strong> ${escapeHtml(x.name)} (${escapeHtml(x.email)})</p><p>${escapeHtml(x.message).replace(/\n/g,'<br>')}</p>`}))==='sent'; } catch(e) { console.error(e.message); }
    return json(res,201,{ok:true,delivered});
  }
  if (path === '/api/admin/login' && req.method === 'POST') {
    const b=await readBody(req);
    if (adminUsername && clean(b.username,200).toLowerCase()!==adminUsername.toLowerCase()) return json(res,401,{error:'Invalid admin login.'});
    if (clean(b.password,200)!==adminPassword) return json(res,401,{error:'Invalid admin login.'});
    return json(res,200,{ok:true},{'Set-Cookie':cookie('semcme_admin',sign('admin'),1)});
  }
  if (path === '/api/admin/logout' && req.method === 'POST') return json(res,200,{ok:true},{'Set-Cookie':clearCookie('semcme_admin')});
  if (path === '/api/admin/constant-contact/connect' && req.method === 'GET') {
    if (!admin(req)) {
      res.writeHead(302, { Location:'/admin.html' });
      return res.end();
    }
    if (!ccClientId || !ccClientSecret) return json(res,500,{error:'Constant Contact client credentials are not configured.'});
    const state = randomBytes(16).toString('hex');
    res.writeHead(302, {
      Location:constantContactAuthorizationUrl(state),
      'Set-Cookie':cookie('semcme_cc_oauth_state', sign(state), 1 / 144)
    });
    return res.end();
  }
  if (path === '/api/admin/constant-contact/callback' && req.method === 'GET') {
    const url = new URL(req.url, 'http://localhost');
    const returnedState = clean(url.searchParams.get('state') || '', 200);
    const code = clean(url.searchParams.get('code') || '', 1000);
    const expectedState = unsign(cookies(req).semcme_cc_oauth_state);
    const headers = { 'Set-Cookie':clearCookie('semcme_cc_oauth_state') };
    if (!expectedState || returnedState !== expectedState || !code) {
      res.writeHead(302, { ...headers, Location:'/admin.html?cc=failed' });
      return res.end();
    }
    try {
      await exchangeConstantContactAuthorizationCode(code);
      res.writeHead(302, { ...headers, Location:'/admin.html?cc=connected' });
      return res.end();
    } catch(e) {
      console.error(e.message);
      res.writeHead(302, { ...headers, Location:'/admin.html?cc=failed' });
      return res.end();
    }
  }
  if (path === '/api/admin/dashboard' && req.method === 'GET') {
    if (!admin(req)) return json(res,401,{error:'Admin login required.'});
    let heroEvents = [];
    try { heroEvents = await getVirtualEvents(); } catch(e) { console.error(e.message); }
    return json(res,200,{
      heroEvents,
      constantContactConfigured,
      databaseType:db.type,
      constantContactListId:ccVirtualMembersListId || resolvedVirtualMembersListId || '',
      constantContactListName:ccVirtualMembersListName,
      registrationUrl,
      virtualInstitutionSegments:await getVirtualInstitutionSegmentNames(),
      libraryPrograms:await getLibraryPrograms({ includeDisabled:true }),
      members:await db.all('SELECT * FROM members ORDER BY created_at DESC LIMIT 500'),
      support:await db.all('SELECT * FROM support_requests ORDER BY created_at DESC LIMIT 250')
    });
  }
  if (path === '/api/admin/institution-segments' && req.method === 'POST') {
    if (!admin(req)) return json(res,401,{error:'Admin login required.'});
    try {
      const body = await readBody(req);
      return json(res,200,{ok:true, virtualInstitutionSegments:await addVirtualInstitutionSegmentName(body.name)});
    } catch(e) {
      return json(res,e.status || 500,{error:e.message || 'Unable to save that institution.'});
    }
  }
  if (path === '/api/admin/institution-segments' && req.method === 'DELETE') {
    if (!admin(req)) return json(res,401,{error:'Admin login required.'});
    try {
      const name = new URL(req.url, 'http://localhost').searchParams.get('name');
      return json(res,200,{ok:true, virtualInstitutionSegments:await removeVirtualInstitutionSegmentName(name)});
    } catch(e) {
      return json(res,e.status || 500,{error:e.message || 'Unable to remove that institution.'});
    }
  }
  if (path === '/api/admin/library/program' && req.method === 'POST') {
    if (!admin(req)) return json(res,401,{error:'Admin login required.'});
    try { return json(res,200,{ok:true, ...(await saveLibraryProgram(await readBody(req)))}); }
    catch(e) { return json(res,e.status || 500,{error:e.message || 'Unable to save that program.'}); }
  }
  if (path === '/api/admin/library/program' && req.method === 'DELETE') {
    if (!admin(req)) return json(res,401,{error:'Admin login required.'});
    try { await deleteLibraryProgram(new URL(req.url, 'http://localhost').searchParams.get('slug')); return json(res,200,{ok:true}); }
    catch(e) { return json(res,e.status || 500,{error:e.message || 'Unable to delete that program.'}); }
  }
  if (path === '/api/admin/library/resource' && req.method === 'POST') {
    if (!admin(req)) return json(res,401,{error:'Admin login required.'});
    try { return json(res,200,{ok:true, ...(await saveLibraryResource(await readBody(req)))}); }
    catch(e) { return json(res,e.status || 500,{error:e.message || 'Unable to save that library item.'}); }
  }
  if (path === '/api/admin/library/resource' && req.method === 'DELETE') {
    if (!admin(req)) return json(res,401,{error:'Admin login required.'});
    try { await deleteLibraryResource(new URL(req.url, 'http://localhost').searchParams.get('id')); return json(res,200,{ok:true}); }
    catch(e) { return json(res,e.status || 500,{error:e.message || 'Unable to delete that library item.'}); }
  }
  if (path === '/api/admin/sync-members' && req.method === 'POST') {
    if (!admin(req)) return json(res,401,{error:'Admin login required.'});
    try { return json(res,200,{ok:true, ...(await syncConstantContactMembers())}); }
    catch(e) { return json(res,500,{error:e.message || 'Unable to sync Constant Contact members.'}); }
  }
  if (path === '/api/admin/sync-virtual-events' && req.method === 'POST') {
    if (!admin(req)) return json(res,401,{error:'Admin login required.'});
    try { const heroEvents = await getVirtualEvents(true); return json(res,200,{ok:true,count:heroEvents.length,heroEvents}); }
    catch(e) { return json(res,500,{error:e.message || 'Unable to refresh SEMCME virtual programs.'}); }
  }
  return json(res,404,{error:'Not found'});
}

async function serveStatic(res, path) {
  const requested=path==='/'?'/index.html':path; const file=normalize(join(root,'public',requested));
  if (!file.startsWith(join(root,'public'))) return json(res,403,{error:'Forbidden'});
  try { const body=await readFile(file); res.writeHead(200,{'Content-Type':mime[extname(file)]||'application/octet-stream','Cache-Control':isProd?'public, max-age=3600':'no-cache','X-Content-Type-Options':'nosniff'}); res.end(body); }
  catch { const body=await readFile(join(root,'public','index.html')); res.writeHead(200,{'Content-Type':mime['.html'],'Cache-Control':'no-cache'}); res.end(body); }
}

async function handleRequest(req, res) {
  try {
    const path = new URL(req.url, 'http://localhost').pathname;
    if (path.startsWith('/api/')) await api(req, res, path);
    else await serveStatic(res, path);
  } catch(e) {
    console.error(e);
    if(!res.headersSent) json(res,500,{error:'Something went wrong. Please try again.'});
    else res.end();
  }
}

if (!process.env.VERCEL) {
  const server = http.createServer(handleRequest);
  server.listen(port,()=>console.log(`SEMCME Virtual Membership running at http://localhost:${port}`));
}

export default handleRequest;
