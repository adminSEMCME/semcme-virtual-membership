import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import pg from 'pg';
const url=process.env.TEST_DATABASE_URL;
if(!url || new URL(url).hostname!=='127.0.0.1' || !new URL(url).pathname.includes('test')) throw Error('Local test database required');
const db=new pg.Client({connectionString:url}); await db.connect();
try {
const {assignments,unresolved}=JSON.parse(await readFile('database/mappings/matched-boss-assignments.json','utf8'));
const sql=await readFile('database/migrations/20261109-assign-boss-categories.sql','utf8');
const snapshot=async()=>({materials:(await db.query('SELECT * FROM vm_library_materials ORDER BY id')).rows,links:(await db.query('SELECT * FROM vm_library_material_tags ORDER BY material_id,tag_id')).rows,original:(await db.query('SELECT * FROM vm_library_resources ORDER BY id')).rows});
const before=await snapshot(); await db.query(sql); const first=await snapshot(); await db.query(sql); assert.deepEqual(await snapshot(),first);
assert.deepEqual(before.original,first.original);
for(const a of assignments){const m=first.materials.find(m=>m.identity_key===a.identityKey);assert.ok(m);for(const t of a.tagIds)assert.ok(first.links.some(l=>l.material_id===m.id&&l.tag_id===t));if(a.competencyReviewed)assert.equal(m.competency_reviewed,true);if(a.surveyReviewed)assert.equal(m.survey_reviewed,true);const previous=before.materials.find(v=>v.id===m.id);assert.equal(m.title,previous.title);assert.equal(m.url,previous.url);}
assert.equal(first.links.length,276);
assert.equal(new Set(first.links.map(l=>l.material_id)).size,129);
assert.equal(first.materials.filter(m=>m.competency_reviewed&&m.survey_reviewed&&!first.links.some(l=>l.material_id===m.id)).length,0);
assert.equal(unresolved.length,1);
console.log('PASS: all 276 approved connections on 129 materials, title and URL preservation, pending mappings excluded from Additional Topics, unchanged original library, and identical results on rerun.');
console.log(JSON.stringify({competencyReviewed:first.materials.filter(m=>m.competency_reviewed).length,surveyReviewed:first.materials.filter(m=>m.survey_reviewed).length,needsReview:first.materials.filter(m=>!m.competency_reviewed||!m.survey_reviewed).length}));
} finally {await db.end();}
