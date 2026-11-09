import {readFile,writeFile} from 'node:fs/promises';
import pg from 'pg';
const url=process.env.TEST_DATABASE_URL;
if(!url || new URL(url).hostname!=='127.0.0.1') throw Error('Local inspection database required');
const db=new pg.Client({connectionString:url}); await db.connect();
const rows=JSON.parse(await readFile('database/mappings/boss-pdf-20261103.json','utf8'));
const tags=(await db.query('SELECT * FROM vm_library_tags')).rows;
const materials=(await db.query('SELECT m.*,array_agg(DISTINCT r.program_slug) AS locations FROM vm_library_materials m JOIN vm_library_material_sources s ON s.material_id=m.id JOIN vm_library_resources r ON r.id=s.resource_id GROUP BY m.id')).rows;
await db.end();
const norm=s=>s.normalize('NFKD').toLowerCase().replace(/[^a-z0-9]/g,'');
const groups=new Map();
for(const r of rows){r.tagIds=tags.filter(t=>norm(r[t.taxonomy==='competency'?'competency':'survey']).includes(norm(t.name))).map(t=>t.id).sort(); const key=norm(r.title); if(!groups.has(key))groups.set(key,[]);groups.get(key).push(r);}
const assignments=[]; const unresolved=[];
for(const [key,rs] of groups){
 let candidates=materials.filter(m=>norm(m.title)===key);
 if (key===norm('Advocacy 101')) candidates=candidates.filter(m=>m.locations.includes('well-being'));
 const signatures=new Set(rs.map(r=>JSON.stringify(r.tagIds)));
 if(!candidates.length || signatures.size!==1 || (candidates.length>1 && candidates.length>rs.length)) {unresolved.push({title:rs[0].title,pages:rs.map(r=>r.page),reason:!candidates.length?'No exact title match':signatures.size!==1?'Conflicting mappings for repeated title':'Multiple recordings need identification',candidates:candidates.map(m=>({title:m.title,url:m.url,locations:m.locations}))});continue;}
 for(const m of candidates)assignments.push({identityKey:m.identity_key,title:m.title,url:m.url,tagIds:rs[0].tagIds,competencyReviewed:rs.every(r=>!r.competency.includes('Needs Manual Mapping')),surveyReviewed:rs.every(r=>!r.survey.includes('Needs content review')),pages:[...new Set(rs.map(r=>r.page))],notes:[...new Set(rs.map(r=>r.note))]});
}
await writeFile('database/mappings/matched-boss-assignments.json',JSON.stringify({assignments,unresolved},null,2)+'\n');
console.log(JSON.stringify({matched:assignments.length,tagLinks:assignments.reduce((n,a)=>n+a.tagIds.length,0),unresolved},null,2));
const payload=JSON.stringify(assignments);
const sql=`-- Boss-approved assignments from SEMCME PDF revised November 3, 2026.
-- Matches exact material identities, adds tags, and preserves existing edits/tags.
-- Unspecified survey areas stay unfinished. No material is classified as Additional Topics.
BEGIN;
DO $mapping$
DECLARE entry jsonb; material_id text; tag_id text; source_note text;
BEGIN
  FOR entry IN SELECT value FROM jsonb_array_elements($payload$${payload}$payload$::jsonb)
  LOOP
    SELECT id INTO material_id FROM public.vm_library_materials WHERE identity_key=entry->>'identityKey' FOR UPDATE;
    IF material_id IS NULL THEN RAISE EXCEPTION 'Missing material: %. No assignments committed.', entry->>'title'; END IF;
    FOR tag_id IN SELECT jsonb_array_elements_text(entry->'tagIds') LOOP
      IF NOT EXISTS (SELECT 1 FROM public.vm_library_tags WHERE id=tag_id) THEN
        RAISE EXCEPTION 'Missing category: %. No assignments committed.', tag_id;
      END IF;
      INSERT INTO public.vm_library_material_tags(material_id,tag_id) VALUES(material_id,tag_id) ON CONFLICT DO NOTHING;
    END LOOP;
    source_note := '[Boss PDF 2026-11-03] Pages ' || (SELECT string_agg(value, ', ') FROM jsonb_array_elements_text(entry->'pages'))
      || '. ' || (SELECT string_agg(value, ' ') FROM jsonb_array_elements_text(entry->'notes'));
    UPDATE public.vm_library_materials SET
      competency_reviewed=competency_reviewed OR (entry->>'competencyReviewed')::boolean,
      survey_reviewed=survey_reviewed OR (entry->>'surveyReviewed')::boolean,
      review_notes=CASE WHEN position('[Boss PDF 2026-11-03]' in review_notes)>0 THEN review_notes
        ELSE concat_ws(E'\\n',nullif(review_notes,''),source_note) END,
      updated_at=CURRENT_TIMESTAMP
    WHERE id=material_id AND (
      (NOT competency_reviewed AND (entry->>'competencyReviewed')::boolean)
      OR (NOT survey_reviewed AND (entry->>'surveyReviewed')::boolean)
      OR position('[Boss PDF 2026-11-03]' in review_notes)=0);
  END LOOP;
END $mapping$;
COMMIT;
SELECT count(DISTINCT material_id) AS materials_with_categories, count(*) AS category_connections
FROM public.vm_library_material_tags;
`;
await writeFile('database/migrations/20261109-assign-boss-categories.sql',sql);
