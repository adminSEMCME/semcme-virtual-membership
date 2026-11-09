import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { materialIdentity } from '../data/library-catalog.js';

const url = process.env.TEST_DATABASE_URL;
if (!url || new URL(url).hostname !== '127.0.0.1' || !new URL(url).pathname.includes('test')) throw new Error('Use an isolated local test database.');
const db = new pg.Client({ connectionString: url });
await db.connect();
const migration = await readFile(new URL('../database/migrations/20261109-import-library-materials.sql', import.meta.url), 'utf8');
try {
  await db.query(await readFile(new URL('../database/migrations/20261109-library-categories.sql', import.meta.url), 'utf8'));
  const original = (await db.query('SELECT * FROM vm_library_resources ORDER BY id')).rows;
  const programs = new Map((await db.query('SELECT slug,enabled FROM vm_library_programs')).rows.map(p => [p.slug,p.enabled]));
  const expected = new Map();
  let placements = 0;
  for (const row of original) {
    const videos = JSON.parse(row.videos_json || '[]');
    for (const item of videos.length ? videos : [row]) {
      const key = materialIdentity(item.url).identityKey;
      if (!expected.has(key)) expected.set(key, new Set());
      expected.get(key).add(row.id);
      placements++;
    }
  }
  await db.query(migration);
  const imported = (await db.query('SELECT * FROM vm_library_materials ORDER BY id')).rows;
  assert.equal(imported.length, expected.size);
  const links = (await db.query('SELECT * FROM vm_library_material_sources')).rows;
  for (const material of imported) {
    assert.equal(material.identity_key, materialIdentity(material.url).identityKey);
    assert.deepEqual(new Set(links.filter(l => l.material_id === material.id).map(l => l.resource_id)), expected.get(material.identity_key));
    assert.equal(material.competency_reviewed, false);
    assert.equal(material.survey_reviewed, false);
    assert.equal(material.enabled, original.some(r => expected.get(material.identity_key).has(r.id) && programs.get(r.program_slug)));
  }
  assert.deepEqual((await db.query('SELECT * FROM vm_library_resources ORDER BY id')).rows, original);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM vm_library_material_tags')).rows[0].n, 0);
  const first = imported[0];
  await db.query("UPDATE vm_library_materials SET title='Admin edited title',competency_reviewed=true WHERE id=$1", [first.id]);
  await db.query("INSERT INTO vm_library_material_tags(material_id,tag_id) VALUES ($1,'competency-communication')", [first.id]);
  const beforeRerun = (await db.query('SELECT * FROM vm_library_materials ORDER BY id')).rows;
  await db.query(migration);
  assert.deepEqual((await db.query('SELECT * FROM vm_library_materials ORDER BY id')).rows, beforeRerun);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM vm_library_material_tags')).rows[0].n, 1);
  // Malformed source records abort the entire import, leaving the catalog intact.
  await db.query("UPDATE vm_library_resources SET url='invalid' WHERE id=$1", [original.find(r => !JSON.parse(r.videos_json || '[]').length).id]);
  await assert.rejects(db.query(migration), /invalid title, URL, or type/);
  await db.query('ROLLBACK');
  assert.deepEqual((await db.query('SELECT * FROM vm_library_materials ORDER BY id')).rows, beforeRerun);
  const source = original.find(r => !JSON.parse(r.videos_json || '[]').length);
  await db.query('UPDATE vm_library_resources SET url=$1 WHERE id=$2', [source.url,source.id]);
  // Restore the local preview to its initial imported state after proving preservation.
  await db.query('UPDATE vm_library_materials SET title=$1,competency_reviewed=false WHERE id=$2', [first.title, first.id]);
  await db.query('DELETE FROM vm_library_material_tags WHERE material_id=$1', [first.id]);
  console.log(JSON.stringify({ originalEntries: original.length, listings: placements, uniqueMaterials: imported.length, repeatedListingsCombined: placements-imported.length, sourceConnections: links.length }));
  console.log('PASS: complete source coverage, playlist expansion, matching admin identity keys, deduplication, unfinished reviews, unchanged original library, and rerun preserving admin edits and tags.');
} finally { await db.end(); }
