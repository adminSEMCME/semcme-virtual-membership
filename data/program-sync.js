import { createHash } from 'node:crypto';

export function classifyEvent(event, now = new Date()) {
  const text = `${event.title} ${event.description}`;
  const rules = [
    ['pediatrics', /pediatri|functional neurological|eating disorders|addiction medicine/i],
    ['hot-topics', /hot topics|sunny side of stress|\bAI\b|artificial intelligence/i],
    ['jedi', /immigrant|justice|equity|implicit bias|\bjedi\b/i],
    ['faculty-development', /generational|faculty development|medical educat|med ed/i],
    ['well-being', /fatigue|burnout|well.being|wellness/i],
    ['additional-offerings', /preparing for practice|home\s*buy|advocacy/i],
    ['lecture-series', /research workshop|surgery basic science|\behr\b|electronic health/i],
    ['quality-improvement', /quality improvement|\bQI\b/i],
    ['chief-resident', /chief resident/i], ['family-medicine', /family medicine/i],
    ['obgyn', /ob.gyn|fetal|obstetric/i], ['research', /research/i],
    ['residency-coordinators', /coordinator/i], ['transitional-year', /transitional year/i],
  ];
  const match = rules.find(([, pattern]) => pattern.test(text));
  let section = /\behr\b|electronic health|on.demand|recording|watch now|module/i.test(text) ? 'current' : 'upcoming';
  const dates = [...text.matchAll(/\b(January|February|March|April|May|June|July|August|September|October|November|December),?\s+(\d{1,2})(?:st|nd|rd|th)?[,]?\s+(20\d{2})\b/gi)]
    .map(m => Date.parse(`${m[1]} ${m[2]}, ${m[3]} 23:59:59 GMT-0500`)).filter(Number.isFinite);
  if (dates.length && Math.max(...dates) < now.getTime()) {
    const academicYear = now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1;
    section = Math.max(...dates) < new Date(academicYear - 1, 6, 1).getTime() ? 'archives' : 'current';
  }
  return { programSlug: match?.[0] || 'additional-offerings', section, needsReview: !match };
}

export function eventKey(event) {
  const url = new URL(event.ctaUrl);
  if (!['https:', 'http:'].includes(url.protocol)) throw new Error('Invalid event registration URL');
  url.hash = '';
  for (const key of [...url.searchParams.keys()]) if (/^utm_|^fbclid$|^gclid$/i.test(key)) url.searchParams.delete(key);
  url.searchParams.sort();
  return createHash('sha256').update(url.href).digest('hex').slice(0, 32);
}

export async function migratePrograms(db) {
  await db.exec(`CREATE TABLE IF NOT EXISTS imported_programs (
    event_key TEXT PRIMARY KEY, resource_id TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1,
    manual INTEGER NOT NULL DEFAULT 0, suppressed INTEGER NOT NULL DEFAULT 0,
    needs_review INTEGER NOT NULL DEFAULT 0
  )`);
  if (await db.get('SELECT key FROM settings WHERE key=$1', ['program-reorganization-v1'])) return;
  for (const [slug, name, short, position, description] of [
    ['pediatrics', 'Pediatrics', 'PD', 6, 'Pediatric Lunch & Learn programs and recordings.'],
    ['hot-topics', 'Hot Topics', 'HT', 3, 'Timely topics and AI in medicine.'],
    ['additional-offerings', 'Additional Program Offerings', 'AP', 5, 'Preparing for practice, homebuying, and advocacy resources.'],
  ]) await db.run(`INSERT INTO library_programs (slug,name,short,position,description,enabled)
    VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT(slug) DO NOTHING`, [slug,name,short,position,description,true]);
  await db.run('UPDATE library_programs SET name=$1, short=$2 WHERE slug=$3', ['Justice in Healthcare','JH','jedi']);
  await db.run('UPDATE library_programs SET name=$1, description=$2 WHERE slug=$3', ['Lecture Series and Modules','Research Workshop Series, Surgery Basic Science, and EHR modules.','lecture-series']);
  const rows = await db.all('SELECT * FROM library_resources WHERE program_slug=$1', ['lecture-series']);
  for (const row of rows) {
    const text = `${row.title} ${row.group_name}`;
    const target = /pediatric/i.test(text) ? 'pediatrics' : /hot topics|AI in Medicine/i.test(text) ? 'hot-topics' : /preparing for practice|homebuy|advocacy/i.test(text) ? 'additional-offerings' : null;
    if (target) await db.run('UPDATE library_resources SET program_slug=$1 WHERE id=$2', [target,row.id]);
  }
  await db.run('DELETE FROM library_resources WHERE program_slug=$1 AND section=$2 AND title=$3', ['quality-improvement','upcoming','Virtual Fundamentals of Quality Improvement Bootcamp']);
  for (const [id, program, section, title, url, type] of [
    ['ehr-modules', 'lecture-series', 'current', 'EHR Modules — Website and Registration', 'https://ehr.portal.semcme.org/', 'resource'],
    ['advocacy-101', 'additional-offerings', 'archives', 'Advocacy 101', 'https://www.youtube.com/watch?v=fUlXtXUk2l8', 'recording'],
    ['homebuying-qEAfADzdt_I', 'additional-offerings', 'archives', "Physician's Guide to Home Buying — Recording 1", 'https://www.youtube.com/watch?v=qEAfADzdt_I', 'recording'],
    ['homebuying-qElG83GovBw', 'additional-offerings', 'archives', "Physician's Guide to Home Buying — Recording 2", 'https://www.youtube.com/watch?v=qElG83GovBw', 'recording'],
  ]) await db.run(`INSERT INTO library_resources (id,program_slug,section,title,url,type) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT(id) DO NOTHING`, [id,program,section,title,url,type]);
  await db.run('INSERT INTO settings(key,value) VALUES ($1,$2) ON CONFLICT(key) DO NOTHING', ['program-reorganization-v1','applied']);
}

export async function reconcileEvents(db, events) {
  const keys = [];
  for (const event of events) {
    const key = eventKey(event);
    keys.push(key);
    const placement = classifyEvent(event);
    const available = await db.get('SELECT slug FROM library_programs WHERE slug=$1', [placement.programSlug]);
    if (!available) continue;
    const existing = await db.get('SELECT id FROM library_resources WHERE url=$1 ORDER BY created_at ASC', [event.ctaUrl]);
    const id = existing?.id || `hero-${key}`;
    await db.run(`INSERT INTO imported_programs(event_key,resource_id,manual,needs_review) VALUES ($1,$2,$3,$4)
      ON CONFLICT(event_key) DO UPDATE SET active=1`, [key,id,existing ? 1 : 0,placement.needsReview ? 1 : 0]);
    const mapping = await db.get('SELECT * FROM imported_programs WHERE event_key=$1', [key]);
    if (mapping.suppressed || mapping.manual) continue;
    await db.run(`INSERT INTO library_resources(id,program_slug,section,title,type,url,meta,embed_enabled)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(id) DO UPDATE SET
      title=excluded.title,url=excluded.url,meta=excluded.meta,section=excluded.section,updated_at=CURRENT_TIMESTAMP`,
      [mapping.resource_id,placement.programSlug,placement.section,event.title,'course',event.ctaUrl,'Registration',false]);
  }
  const mappings = await db.all('SELECT * FROM imported_programs');
  for (const mapping of mappings) if (!keys.includes(mapping.event_key)) {
    await db.run('UPDATE imported_programs SET active=0 WHERE event_key=$1', [mapping.event_key]);
  }
}
