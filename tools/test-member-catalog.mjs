import assert from 'node:assert/strict';
import http from 'node:http';
import {createHmac} from 'node:crypto';
import {memberCatalog} from '../data/library-taxonomy.js';
import {embeddedVideo,selectMaterials} from '../public/member-catalog.js';
const t={id:'c',taxonomy:'competency',name:'Communication',enabled:true};
const hidden={id:'h',taxonomy:'survey',name:'Hidden',enabled:false};
const base={id:'a',title:'A video',url:'https://youtu.be/abcdefghijk',enabled:true,tags:[t],reviewNotes:'PRIVATE',sources:[{title:'PRIVATE'}],position:0};
const projection=memberCatalog({tags:[t,hidden],series:[],materials:[base,{...base,id:'pending',tags:[]},{...base,id:'additional',tags:[],competencyReviewed:true,surveyReviewed:true},{...base,id:'hidden',enabled:false},{...base,id:'hidden-tag',tags:[hidden],competencyReviewed:true,surveyReviewed:true}]});
assert.equal(projection.materials.length,4);
assert.equal(projection.tags.length,1);
assert.ok(!JSON.stringify(projection).includes('PRIVATE'));
assert.deepEqual(selectMaterials(projection,'additional','').map(m=>m.id),['additional']);
assert.deepEqual(selectMaterials(projection,'competency','c').map(m=>m.id),['a']);
assert.equal(selectMaterials(projection,'all','').length,4);
assert.equal(selectMaterials(projection,'all','','no match').length,0);
assert.equal(embeddedVideo('https://youtube.com.evil.example/watch?v=abcdefghijk','recording'),'');
assert.equal(embeddedVideo('https://www.youtube.com/shorts/abcdefghijk','recording'),'https://www.youtube.com/embed/abcdefghijk');
const url=process.env.TEST_DATABASE_URL;
if(!url || new URL(url).hostname!=='127.0.0.1' || !new URL(url).pathname.includes('test'))throw Error('Isolated local test database required');
Object.assign(process.env,{VERCEL:'1',DATABASE_URL:url,DATABASE_PROVIDER:'postgres',DATABASE_TABLE_PREFIX:'vm_',COOKIE_SECRET:'member-test-only',CONSTANT_CONTACT_ACCESS_TOKEN:'',CONSTANT_CONTACT_CLIENT_ID:'',CONSTANT_CONTACT_CLIENT_SECRET:'',CONSTANT_CONTACT_REFRESH_TOKEN:''});
const realFetch=globalThis.fetch;globalThis.fetch=async()=>{throw Error('External network disabled');};
const {default:handler}=await import('../server.js');
const server=http.createServer(handler);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
try{
const baseUrl=`http://127.0.0.1:${server.address().port}`;
assert.equal((await realFetch(baseUrl+'/api/catalog')).status,401);
const value='member:1';const signed=value+'.'+createHmac('sha256','member-test-only').update(value).digest('base64url');
const res=await realFetch(baseUrl+'/api/catalog',{headers:{cookie:'semcme_member='+encodeURIComponent(signed)}});assert.equal(res.status,200);
const data=await res.json();assert.ok(data.materials.length>100);assert.equal(data.tags.length,14);
for(const m of data.materials){for(const privateKey of ['reviewNotes','sources','competencyReviewed','surveyReviewed','updatedAt'])assert.ok(!(privateKey in m));for(const tag of m.tags)assert.ok(selectMaterials(data,tag.taxonomy,tag.id).some(x=>x.id===m.id));}
console.log('PASS: member authentication, private review-data exclusion, all assigned category placements, search, Additional Topics, hidden content, and safe YouTube embedding.');
}finally{globalThis.fetch=realFetch;await new Promise(resolve=>server.close(resolve));}
