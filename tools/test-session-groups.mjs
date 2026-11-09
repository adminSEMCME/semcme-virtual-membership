import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import pg from 'pg';
const url=process.env.TEST_DATABASE_URL;
if(!url||new URL(url).hostname!=='127.0.0.1'||!new URL(url).pathname.includes('test'))throw Error('Local test database required');
const db=new pg.Client({connectionString:url});await db.connect();
try{
const sql=await readFile('database/migrations/20261109-group-sessions.sql','utf8');
const groups=JSON.parse(await readFile('database/mappings/session-series.json','utf8'));
const preserved=async()=>({materials:(await db.query('SELECT id,title,url,competency_reviewed,survey_reviewed,review_notes FROM vm_library_materials ORDER BY id')).rows,tags:(await db.query('SELECT * FROM vm_library_material_tags ORDER BY material_id,tag_id')).rows});
const before=await preserved();await db.query(sql);assert.deepEqual(await preserved(),before);
const snapshot=async()=>({materials:(await db.query('SELECT * FROM vm_library_materials ORDER BY id')).rows,series:(await db.query('SELECT * FROM vm_library_series ORDER BY id')).rows});
const first=await snapshot();await db.query(sql);assert.deepEqual(await snapshot(),first);
for(const g of groups)for(const [i,id]of g.videos.entries()){const m=first.materials.find(m=>m.identity_key==='youtube:'+id);assert.equal(m.series_id,g.id);assert.equal(m.session_position,i+1);}
assert.equal(first.materials.filter(m=>m.series_id).length,42);
await db.query("INSERT INTO vm_library_series(id,title) VALUES('test-conflict','Existing grouping')");
await db.query("UPDATE vm_library_materials SET series_id='test-conflict' WHERE identity_key=$1",['youtube:'+groups[0].videos[0]]);
await assert.rejects(db.query(sql),/different series/);await db.query('ROLLBACK');
await db.query('UPDATE vm_library_materials SET series_id=$1 WHERE identity_key=$2',[groups[0].id,'youtube:'+groups[0].videos[0]]);
await db.query("DELETE FROM vm_library_series WHERE id='test-conflict'");
console.log('PASS: 42 recordings grouped into 15 ordered series, existing tags and review decisions preserved, rerun unchanged, conflicting assignments rejected.');
}finally{await db.end();}
