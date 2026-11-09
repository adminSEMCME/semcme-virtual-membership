import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import pg from 'pg';

const url = process.env.TEST_DATABASE_URL;
if (!url || new URL(url).hostname !== '127.0.0.1' || !new URL(url).pathname.includes('test')) {
  throw new Error('Use an isolated local test database, never the live database.');
}
const db = new pg.Client({ connectionString: url });
await db.connect();
const schema = await readFile(new URL('../database/migrations/20261109-library-categories.sql', import.meta.url), 'utf8');
const rows = async (sql, params = []) => (await db.query(sql, params)).rows;
const expectCode = async (sql, params, code) => assert.rejects(db.query(sql, params), error => error.code === code);
try {
  const before = await rows('SELECT row_to_json(r)::text AS row FROM vm_library_resources r ORDER BY id');
  await db.query('CREATE TABLE public.rws_test_sentinel (id integer); INSERT INTO public.rws_test_sentinel VALUES (42)');
  await db.query(schema);
  assert.deepEqual(await rows('SELECT taxonomy,count(*)::int AS n FROM vm_library_tags GROUP BY taxonomy ORDER BY taxonomy'), [
    { taxonomy: 'competency', n: 6 }, { taxonomy: 'survey', n: 8 },
  ]);
  assert.deepEqual(await rows('SELECT row_to_json(r)::text AS row FROM vm_library_resources r ORDER BY id'), before);
  assert.equal((await rows('SELECT id FROM rws_test_sentinel'))[0].id, 42);

  await db.query("INSERT INTO vm_library_materials(id,identity_key,title,url) VALUES ('test-video','youtube:test','Test recording','https://example.org/video')");
  const initial = (await rows("SELECT competency_reviewed,survey_reviewed FROM vm_library_materials WHERE id='test-video'"))[0];
  assert.deepEqual(initial, { competency_reviewed: false, survey_reviewed: false });
  await expectCode("INSERT INTO vm_library_materials(id,identity_key,title,url) VALUES ('duplicate','youtube:test','Different title','https://example.org/video')", [], '23505');
  await expectCode("INSERT INTO vm_library_materials(id,identity_key,title,url) VALUES ('invalid','invalid','Test','javascript:alert(1)')", [], '23514');
  const tags = ['competency-communication', 'competency-professionalism', 'survey-evaluation'];
  for (const id of tags) await db.query('INSERT INTO vm_library_material_tags(material_id,tag_id) VALUES ($1,$2)', ['test-video', id]);
  assert.equal((await rows("SELECT count(*)::int AS n FROM vm_library_material_tags WHERE material_id='test-video'"))[0].n, 3);
  await expectCode('INSERT INTO vm_library_material_tags(material_id,tag_id) VALUES ($1,$2)', ['test-video', tags[0]], '23505');
  await expectCode('INSERT INTO vm_library_material_tags(material_id,tag_id) VALUES ($1,$2)', ['missing-video', tags[0]], '23503');
  await expectCode('DELETE FROM vm_library_tags WHERE id=$1', [tags[0]], '23503');

  const resource = (await rows('SELECT id FROM vm_library_resources ORDER BY id LIMIT 1'))[0];
  assert.ok(resource);
  await db.query('INSERT INTO vm_library_material_sources(material_id,resource_id) VALUES ($1,$2)', ['test-video', resource.id]);
  await db.query("INSERT INTO vm_library_series(id,title) VALUES ('test-series','Test sessions')");
  await db.query("UPDATE vm_library_materials SET series_id='test-series',session_position=1,competency_reviewed=true,survey_reviewed=true WHERE id='test-video'");
  await db.query("DELETE FROM vm_library_series WHERE id='test-series'");
  assert.equal((await rows("SELECT series_id FROM vm_library_materials WHERE id='test-video'"))[0].series_id, null);

  await db.query("UPDATE vm_library_tags SET name='Admin-edited label' WHERE id='survey-evaluation'");
  await db.query(schema); // Rerunning must preserve admin changes, mappings, and review status.
  assert.equal((await rows("SELECT name FROM vm_library_tags WHERE id='survey-evaluation'"))[0].name, 'Admin-edited label');
  assert.equal((await rows('SELECT count(*)::int AS n FROM vm_library_material_tags'))[0].n, 3);
  assert.equal((await rows("SELECT survey_reviewed FROM vm_library_materials WHERE id='test-video'"))[0].survey_reviewed, true);
  for (const name of ['vm_library_series', 'vm_library_materials', 'vm_library_tags', 'vm_library_material_tags', 'vm_library_material_sources']) {
    assert.equal((await rows('SELECT rowsecurity FROM pg_tables WHERE schemaname=$1 AND tablename=$2', ['public', name]))[0].rowsecurity, true);
    for (const role of ['anon', 'authenticated']) {
      assert.equal((await rows("SELECT has_table_privilege($1,$2,'SELECT') AS allowed", [role, 'public.' + name]))[0].allowed, false);
    }
  }
  await db.query("DELETE FROM vm_library_materials WHERE id='test-video'");
  assert.equal((await rows('SELECT count(*)::int AS n FROM vm_library_material_tags'))[0].n, 0);
  assert.equal((await rows('SELECT count(*)::int AS n FROM vm_library_material_sources'))[0].n, 0);
  assert.deepEqual(await rows('SELECT row_to_json(r)::text AS row FROM vm_library_resources r ORDER BY id'), before);
  console.log('PASS: category seeds, unchanged existing library, unrelated table isolation, multi-tag connections, review defaults, identity uniqueness, series deletion, referential integrity, safe reruns, and access restrictions.');
} finally {
  await db.end();
}
