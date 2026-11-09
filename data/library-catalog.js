import { createHash, randomUUID } from 'node:crypto';
import { materialReviewState } from './library-taxonomy.js';

const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
const text = (value, label, max = 1000, required = false) => {
  if (value != null && typeof value !== 'string') fail(`${label} must be text.`);
  const result = (value || '').trim();
  if (result.length > max || (required && !result)) fail(`${label} ${result ? 'is too long' : 'is required'}.`);
  return result;
};
const integer = (value, label, min = -100000) => {
  const n = value === '' || value == null ? 0 : Number(value);
  if (!Number.isSafeInteger(n) || n < min || n > 100000) fail(`${label} must be a whole number between ${min} and 100000.`);
  return n;
};
const flag = (value, fallback = false) => value == null ? fallback : value === true;
const stamp = value => new Date(value).toISOString();
const tagRecord = row => ({ id: row.id, taxonomy: row.taxonomy, slug: row.slug, name: row.name, description: row.description, position: row.position, enabled: row.enabled, updatedAt: stamp(row.updated_at) });
const seriesRecord = row => ({ id: row.id, title: row.title, description: row.description, position: row.position, updatedAt: stamp(row.updated_at) });

export function materialIdentity(rawUrl) {
  let url;
  try { url = new URL(text(rawUrl, 'URL', 4000, true)); } catch { fail('Enter a complete http or https URL.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) fail('Enter an http or https URL without a username or password.');
  url.hash = '';
  const host = url.hostname.replace(/^(www\.|m\.)/, '');
  if (host === 'youtu.be' || host === 'youtube.com') {
    const video = host === 'youtu.be' ? url.pathname.slice(1).split('/')[0] : url.searchParams.get('v') || url.pathname.match(/^\/(?:embed|shorts|live)\/([^/]+)/)?.[1];
    if (video && /^[\w-]{11}$/.test(video)) return { url: url.href, identityKey: `youtube:${video}` };
    const list = url.searchParams.get('list');
    if (list) return { url: url.href, identityKey: `playlist:${list}` };
  }
  return { url: url.href, identityKey: `url:${createHash('sha256').update(url.href).digest('hex')}` };
}

export function createLibraryCatalog(db) {
  async function lock(tx, table, id, updatedAt) {
    if (!id) return null;
    const row = await tx.get(`SELECT * FROM ${table} WHERE id=$1 FOR UPDATE`, [id]);
    if (!row) fail('This item no longer exists. Refresh the list.', 404);
    if (updatedAt !== stamp(row.updated_at)) fail('This item changed since you opened it. Refresh and reopen it before saving.', 409);
    return row;
  }
  async function write(work) {
    if (!db.transaction) fail('Library organization requires the PostgreSQL connection.', 503);
    try { return await db.transaction(work); }
    catch (error) {
      if (error.code === '23505') fail('That material URL or category already exists. Edit the existing item instead.', 409);
      if (error.code === '23503') fail('This item is still in use, or a selected category or series no longer exists. Refresh and try again.', 409);
      throw error;
    }
  }
  return {
    async read() {
      const [materialRows, tagRows, links, seriesRows, sources] = await Promise.all([
        db.all('SELECT * FROM library_materials ORDER BY position, lower(title), id'),
        db.all('SELECT * FROM library_tags ORDER BY taxonomy, position, lower(name), id'),
        db.all('SELECT * FROM library_material_tags'),
        db.all('SELECT * FROM library_series ORDER BY position, lower(title), id'),
        db.all('SELECT s.material_id, s.source_title, r.program_slug, r.section FROM library_material_sources s JOIN library_resources r ON r.id=s.resource_id'),
      ]);
      const tags = tagRows.map(tagRecord);
      const byId = new Map(tags.map(tag => [tag.id, tag]));
      const tagsByMaterial = new Map();
      for (const link of links) {
        if (!tagsByMaterial.has(link.material_id)) tagsByMaterial.set(link.material_id, []);
        const tag = byId.get(link.tag_id);
        if (tag) tagsByMaterial.get(link.material_id).push(tag);
      }
      const materials = materialRows.map(row => {
        const material = {
          id: row.id, title: row.title, url: row.url, type: row.type, presenter: row.presenter,
          itemDate: row.item_date, description: row.description, meta: row.meta,
          embedEnabled: row.embed_enabled, enabled: row.enabled,
          competencyReviewed: row.competency_reviewed, surveyReviewed: row.survey_reviewed,
          reviewNotes: row.review_notes, seriesId: row.series_id || '', sessionPosition: row.session_position,
          position: row.position, updatedAt: stamp(row.updated_at), tags: tagsByMaterial.get(row.id) || [],
          sources: sources.filter(source => source.material_id === row.id).map(source => ({ title: source.source_title, program: source.program_slug, section: source.section })),
        };
        return { ...material, ...materialReviewState(material) };
      });
      return { materials, tags, series: seriesRows.map(seriesRecord) };
    },
    async saveMaterial(body) {
      const id = text(body.id, 'Material ID', 200) || randomUUID();
      const title = text(body.title, 'Title', 500, true);
      const identity = materialIdentity(body.url);
      if (!['recording', 'playlist', 'course', 'resource'].includes(body.type)) fail('Choose a valid material type.');
      if (!Array.isArray(body.tagIds) || body.tagIds.length > 100 || body.tagIds.some(id => typeof id !== 'string')) fail('Choose valid categories.');
      const tagIds = [...new Set(body.tagIds)];
      const seriesId = text(body.seriesId, 'Series', 200) || null;
      const values = [id, identity.identityKey, title, identity.url, body.type,
        text(body.presenter, 'Presenter', 1000), text(body.itemDate, 'Date', 150), text(body.description, 'Description', 5000),
        text(body.meta, 'Note', 1000), flag(body.embedEnabled, true), flag(body.enabled, true),
        flag(body.competencyReviewed), flag(body.surveyReviewed), text(body.reviewNotes, 'Review notes', 10000),
        seriesId, integer(body.sessionPosition, 'Session order', 0), integer(body.position, 'Display order')];
      return write(async tx => {
        await lock(tx, 'library_materials', body.id, body.updatedAt);
        const selected = await tx.all('SELECT id FROM library_tags WHERE id=ANY($1::text[])', [tagIds]);
        if (selected.length !== tagIds.length) fail('One of the selected categories no longer exists. Refresh the list.', 409);
        if (seriesId && !await tx.get('SELECT id FROM library_series WHERE id=$1', [seriesId])) fail('Choose an existing series.');
        await tx.run(`INSERT INTO library_materials
          (id,identity_key,title,url,type,presenter,item_date,description,meta,embed_enabled,enabled,competency_reviewed,survey_reviewed,review_notes,series_id,session_position,position)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
          ON CONFLICT(id) DO UPDATE SET identity_key=excluded.identity_key,title=excluded.title,url=excluded.url,type=excluded.type,
          presenter=excluded.presenter,item_date=excluded.item_date,description=excluded.description,meta=excluded.meta,
          embed_enabled=excluded.embed_enabled,enabled=excluded.enabled,competency_reviewed=excluded.competency_reviewed,
          survey_reviewed=excluded.survey_reviewed,review_notes=excluded.review_notes,series_id=excluded.series_id,
          session_position=excluded.session_position,position=excluded.position,updated_at=CURRENT_TIMESTAMP`, values);
        await tx.run('DELETE FROM library_material_tags WHERE material_id=$1', [id]);
        for (const tagId of tagIds) await tx.run('INSERT INTO library_material_tags(material_id,tag_id) VALUES ($1,$2)', [id, tagId]);
        await tx.run('UPDATE library_event_imports SET manual=true WHERE material_id=$1', [id]);
        return { id };
      });
    },
    async saveTag(body) {
      const id = text(body.id, 'Category ID', 200) || randomUUID();
      const name = text(body.name, 'Category name', 200, true);
      if (!['competency', 'survey', 'topic'].includes(body.taxonomy)) fail('Choose Competency, Survey Area, or Subject Topic.');
      return write(async tx => {
        const existing = await lock(tx, 'library_tags', body.id, body.updatedAt);
        if (existing && existing.taxonomy !== body.taxonomy) fail('An existing category cannot be moved between category groups.');
        const slug = existing?.slug || name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
        if (!slug) fail('Use at least one letter or number in the category name.');
        await tx.run(`INSERT INTO library_tags(id,taxonomy,slug,name,description,position,enabled)
          VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(id) DO UPDATE SET name=excluded.name,description=excluded.description,
          position=excluded.position,enabled=excluded.enabled,updated_at=CURRENT_TIMESTAMP`,
        [id, body.taxonomy, slug, name, text(body.description, 'Description', 3000), integer(body.position, 'Display order'), flag(body.enabled, true)]);
        return { id };
      });
    },
    async saveSeries(body) {
      const id = text(body.id, 'Series ID', 200) || randomUUID();
      return write(async tx => {
        await lock(tx, 'library_series', body.id, body.updatedAt);
        await tx.run(`INSERT INTO library_series(id,title,description,position) VALUES ($1,$2,$3,$4)
          ON CONFLICT(id) DO UPDATE SET title=excluded.title,description=excluded.description,position=excluded.position,updated_at=CURRENT_TIMESTAMP`,
        [id, text(body.title, 'Series title', 500, true), text(body.description, 'Description', 5000), integer(body.position, 'Display order')]);
        return { id };
      });
    },
    async remove(kind, body) {
      const table = { material: 'library_materials', tag: 'library_tags', series: 'library_series' }[kind];
      if (!table) fail('Unknown library item.');
      const id = text(body.id, 'Item ID', 200, true);
      return write(async tx => {
        await lock(tx, table, id, body.updatedAt);
        if (kind === 'tag' && await tx.get('SELECT material_id FROM library_material_tags WHERE tag_id=$1 LIMIT 1', [id])) {
          fail('Materials still use this category. Remove those assignments first, or hide the category instead.', 409);
        }
        if (kind === 'material') await tx.run('UPDATE library_event_imports SET suppressed=true WHERE material_id=$1', [id]);
        await tx.run(`DELETE FROM ${table} WHERE id=$1`, [id]);
        return { id };
      });
    },
  };
}
