import http from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { dirname, extname, join, normalize } from 'node:path';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { programs, defaultBanner } from './data/library.js';

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
const baseUrl = process.env.BASE_URL || `http://localhost:${port}`;
const adminPassword = process.env.ADMIN_PASSWORD || 'admin-demo-2026';
const cookieSecret = process.env.COOKIE_SECRET || 'local-development-only-change-me';
const ccBase = 'https://api.cc.email/v3';
const semcmeHomeUrl = process.env.SEMCME_HOME_URL || 'https://semcme.org/';
const oneDayMs = 24 * 60 * 60 * 1000;
const semcmeHeroRefreshMs = Math.max(Number(process.env.SEMCME_HERO_REFRESH_MS || oneDayMs), oneDayMs);
const ccAccessToken = process.env.CONSTANT_CONTACT_ACCESS_TOKEN || '';
const ccClientId = process.env.CONSTANT_CONTACT_CLIENT_ID || '';
const ccClientSecret = process.env.CONSTANT_CONTACT_CLIENT_SECRET || '';
const ccRefreshToken = process.env.CONSTANT_CONTACT_REFRESH_TOKEN || '';
const ccVirtualMembersListId = process.env.CONSTANT_CONTACT_VIRTUAL_MEMBERSHIP_LIST_ID || '';
const ccVirtualMembersListName = process.env.CONSTANT_CONTACT_VIRTUAL_MEMBERSHIP_LIST_NAME || 'SEMCME - Virtual Members';
const registrationUrl = process.env.VIRTUAL_MEMBERSHIP_REGISTRATION_URL || 'https://lp.constantcontactpages.com/sl/8vmbMa9';
const constantContactConfigured = Boolean((ccAccessToken || (ccClientId && ccClientSecret && ccRefreshToken)) && (ccVirtualMembersListId || ccVirtualMembersListName));
const databaseUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL || '';
const databasePath = process.env.SQLITE_DATABASE_PATH || (process.env.VERCEL ? '/tmp/semcme.db' : join(root, 'data', 'semcme.db'));
const ccTokenState = {
  accessToken: ccAccessToken,
  refreshToken: ccRefreshToken,
  expiresAt: 0
};

function sqliteDatabase() {
  const sqlite = new DatabaseSync(databasePath);
  const bind = (sql, params = []) => {
    let index = 0;
    return {
      sql: sql.replace(/\$\d+/g, () => '?'),
      params: params.map((value) => value ?? '')
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
  CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`);

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

async function sendEmail({to, subject, html}) {
  if (!process.env.RESEND_API_KEY) return 'not_configured';
  const r = await fetch('https://api.resend.com/emails', {
    method:'POST',
    headers:{ Authorization:`Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type':'application/json' },
    body:JSON.stringify({ from:process.env.EMAIL_FROM || 'SEMCME Virtual Membership <members@semcme.org>', to:[to], subject, html })
  });
  if (!r.ok) throw new Error(`Email provider returned ${r.status}`);
  return 'sent';
}

async function upsertMemberFromContact(contact, source='constant_contact_list') {
  const email = extractEmail(contact);
  if (!emailOk(email)) return null;
  const name = extractName(contact);
  const contactId = clean(contact.contact_id || contact.id || '', 160);
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
  `, [email, name.firstName, name.lastName, extractInstitution(contact), contactId, source]);
  return db.get('SELECT * FROM members WHERE email=$1', [email]);
}

function extractEmail(value) {
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

function extractInstitution(contact) {
  const values = [];
  const walk = v => {
    if (!v) return;
    if (Array.isArray(v)) return v.forEach(walk);
    if (typeof v !== 'object') return;
    for (const [key, item] of Object.entries(v)) {
      if (/institution|organization|company/i.test(key) && typeof item === 'string') values.push(item);
      else walk(item);
    }
  };
  walk(contact);
  return clean(values[0] || '', 200);
}

async function refreshConstantContactAccessToken() {
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
  if (!r.ok) throw new Error(`Constant Contact token refresh returned ${r.status}`);
  ccTokenState.accessToken = data.access_token || '';
  ccTokenState.refreshToken = data.refresh_token || ccTokenState.refreshToken;
  ccTokenState.expiresAt = Date.now() + Math.max(Number(data.expires_in || 0) - 300, 60) * 1000;
  return ccTokenState.accessToken;
}

async function constantContactAccessToken() {
  if (ccTokenState.accessToken && (!ccTokenState.expiresAt || Date.now() < ccTokenState.expiresAt)) {
    return ccTokenState.accessToken;
  }
  return refreshConstantContactAccessToken();
}

async function constantContactGet(url, retry = true) {
  const token = await constantContactAccessToken();
  const r = await fetch(url, { headers:{ Authorization:`Bearer ${token}` } });
  if (r.status === 401 && retry && ccClientId && ccClientSecret && ccTokenState.refreshToken) {
    ccTokenState.accessToken = '';
    await refreshConstantContactAccessToken();
    return constantContactGet(url, false);
  }
  if (!r.ok) throw new Error(`Constant Contact returned ${r.status}`);
  return r.json();
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

async function constantContactListContacts({ email = '' } = {}) {
  if (!constantContactConfigured) return { configured:false, records:[] };
  const listId = await virtualMembersListId();
  const params = new URLSearchParams({
    lists: listId,
    status: 'active',
    include: 'list_memberships',
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
  return { configured:true, records };
}

async function findConstantContactListMember(email) {
  const result = await constantContactListContacts({ email });
  if (!result.configured) return { configured:false, member:null };
  const match = result.records.find(r => extractEmail(r) === email);
  return { configured:true, member: match ? await upsertMemberFromContact(match) : null };
}

async function syncConstantContactMembers() {
  const result = await constantContactListContacts();
  if (!result.configured) return { configured:false, synced:0 };
  let synced = 0;
  for (const record of result.records) {
    if (await upsertMemberFromContact(record)) synced += 1;
  }
  return { configured:true, synced };
}

function createMagicLink(memberRow) {
  const payload = {
    email: memberRow.email,
    first_name: memberRow.first_name || '',
    last_name: memberRow.last_name || '',
    institution: memberRow.institution || '',
    contact_id: memberRow.cc_registration_id || '',
    source: memberRow.cc_status || 'constant_contact_list',
    exp: Date.now() + 30 * 60 * 1000,
    nonce: randomBytes(12).toString('base64url')
  };
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = createHmac('sha256', cookieSecret).update(body).digest('base64url');
  const token = `${body}.${sig}`;
  return `${baseUrl}/?token=${encodeURIComponent(token)}`;
}

async function requestMagicLink(email) {
  let row = await db.get('SELECT * FROM members WHERE email=$1', [email]);
  let source = row ? 'database' : '';
  if (!row) {
    const checked = await findConstantContactListMember(email);
    if (!checked.configured) throw Object.assign(new Error('Constant Contact list lookup is not configured for Virtual Membership yet.'), { status:503 });
    row = checked.member;
    source = row ? 'constant_contact_list' : '';
  }
  if (!row) throw Object.assign(new Error('That email is not on the SEMCME Virtual Membership member list. Please register first.'), { status:404, registrationUrl });
  const signInUrl = createMagicLink(row);
  const mail = await sendEmail({
    to: email,
    subject: 'Your SEMCME Virtual Membership sign-in link',
    html: `<p>Use this secure link to sign in to the SEMCME Virtual Membership:</p><p><a href="${escapeHtml(signInUrl)}">Sign in to SEMCME Virtual Membership</a></p><p>This link expires in 30 minutes.</p>`
  });
  if (mail === 'not_configured' && isProd) {
    throw Object.assign(new Error('Email delivery is not configured yet.'), { status:503 });
  }
  return { emailSent: mail === 'sent', source, signInUrl: mail === 'not_configured' ? signInUrl : undefined };
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
  const r = await fetch(semcmeHomeUrl);
  if (!r.ok) throw new Error(`SEMCME homepage returned ${r.status}`);
  const html = await r.text();
  const events = parseSemcmeVirtualSlides(html);
  virtualEventsCache = { at: Date.now(), events };
  return events;
}

function parseSemcmeVirtualSlides(html) {
  const imageByClass = new Map();
  for (const match of html.matchAll(/\.et_pb_slider\s+\.et_pb_slide_(\d+)[^{]*\{[^}]*background-image:url\(([^)]+)\)/g)) {
    imageByClass.set(match[1], match[2].replace(/^['"]|['"]$/g, ''));
  }
  const slides = [];
  const slideRe = /<div class="et_pb_slide et_pb_slide_(\d+)[\s\S]*?(?=<div class="et_pb_slide et_pb_slide_\d+|<\/div>\s*<\/div>\s*<\/div>\s*<\/div>)/g;
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
    return json(res,200,{banner:defaultBanner,events,programs});
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
    const b=await readBody(req); if (clean(b.password,200)!==adminPassword) return json(res,401,{error:'Invalid admin password.'});
    return json(res,200,{ok:true},{'Set-Cookie':cookie('semcme_admin',sign('admin'),1)});
  }
  if (path === '/api/admin/dashboard' && req.method === 'GET') {
    if (!admin(req)) return json(res,401,{error:'Admin login required.'});
    let heroEvents = [];
    try { heroEvents = await getVirtualEvents(); } catch(e) { console.error(e.message); }
    return json(res,200,{
      heroEvents,
      constantContactConfigured,
      registrationUrl,
      members:await db.all('SELECT * FROM members ORDER BY created_at DESC LIMIT 500'),
      support:await db.all('SELECT * FROM support_requests ORDER BY created_at DESC LIMIT 250')
    });
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
