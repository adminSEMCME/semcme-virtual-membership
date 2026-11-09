import {eventKey,classifyEvent} from './program-sync.js';
import {materialIdentity} from './library-catalog.js';
export async function syncCatalogEvents(db,events) {
 return db.transaction(async tx=>{
  await tx.get('SELECT pg_advisory_xact_lock(7311942)');
  const keys=[];
  for(const event of events){
   const key=eventKey(event);keys.push(key);
   const identity=materialIdentity(event.ctaUrl);
   let mapping=await tx.get('SELECT * FROM library_event_imports WHERE event_key=$1',[key]);
   if(!mapping){
    const existing=await tx.get('SELECT id FROM library_materials WHERE identity_key=$1',[identity.identityKey]);
    await tx.run('INSERT INTO library_event_imports(event_key,material_id,manual) VALUES($1,$2,$3)',[key,existing?.id||null,Boolean(existing)]);
    mapping=await tx.get('SELECT * FROM library_event_imports WHERE event_key=$1',[key]);
   }
   await tx.run('UPDATE library_event_imports SET active=true WHERE event_key=$1',[key]);
   if(mapping.suppressed || (mapping.manual && mapping.material_id))continue;
   let id=mapping.material_id;
   if(!id){
    const existing=await tx.get('SELECT id FROM library_materials WHERE identity_key=$1',[identity.identityKey]);
    if(existing){await tx.run('UPDATE library_event_imports SET material_id=$1,manual=true WHERE event_key=$2',[existing.id,key]);continue;}
    id='event-'+key;
    await tx.run("INSERT INTO library_materials(id,identity_key,title,url,type,meta,embed_enabled) VALUES($1,$2,$3,$4,'course','Registration',false)",[id,identity.identityKey,event.title,identity.url]);
    await tx.run('UPDATE library_event_imports SET material_id=$1 WHERE event_key=$2',[id,key]);
    const placement=classifyEvent(event);
    const tag=await tx.get("SELECT id FROM library_tags WHERE taxonomy='topic' AND slug=$1",[placement.programSlug]);
    if(tag)await tx.run('INSERT INTO library_material_tags(material_id,tag_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[id,tag.id]);
   }else await tx.run('UPDATE library_materials SET title=$1,url=$2,identity_key=$4,enabled=true,updated_at=CURRENT_TIMESTAMP WHERE id=$3',[event.title,identity.url,id,identity.identityKey]);
  }
  const old=await tx.all('SELECT * FROM library_event_imports');
  for(const m of old)if(!keys.includes(m.event_key)){
   await tx.run('UPDATE library_event_imports SET active=false WHERE event_key=$1',[m.event_key]);
   if(!m.manual&&!m.suppressed&&m.material_id)await tx.run('UPDATE library_materials SET enabled=false,updated_at=CURRENT_TIMESTAMP WHERE id=$1 AND enabled=true',[m.material_id]);
  }
 });
}
