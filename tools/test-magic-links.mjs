import assert from 'node:assert/strict';
import http from 'node:http';
import {createHmac,createHash,randomBytes} from 'node:crypto';
import pg from 'pg';
const url=process.env.TEST_DATABASE_URL;
if(!url||new URL(url).hostname!=='127.0.0.1'||!new URL(url).pathname.includes('test'))throw Error('Local test database required');
Object.assign(process.env,{VERCEL:'1',DATABASE_URL:url,DATABASE_PROVIDER:'postgres',DATABASE_TABLE_PREFIX:'vm_',COOKIE_SECRET:'auth-regression-test',CONSTANT_CONTACT_ACCESS_TOKEN:'',CONSTANT_CONTACT_CLIENT_ID:'',CONSTANT_CONTACT_CLIENT_SECRET:'',CONSTANT_CONTACT_REFRESH_TOKEN:''});
const db=new pg.Client({connectionString:url});await db.connect();
const originalFetch=globalThis.fetch;globalThis.fetch=async()=>{throw Error('External requests disabled');};
const {default:handler}=await import('../server.js');const server=http.createServer(handler);await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base=`http://127.0.0.1:${server.address().port}`;
async function token(exp=Date.now()+900000){const payload={email:'auth-regression@example.org',first_name:'Test',last_name:'Member',institution:'Long institution name '.repeat(12),contact_id:'',source:'test',exp,nonce:randomBytes(12).toString('base64url')};const body=Buffer.from(JSON.stringify(payload)).toString('base64url');const value=body+'.'+createHmac('sha256','auth-regression-test').update(body).digest('base64url');await db.query('INSERT INTO vm_magic_links(member_id,token_hash,expires_at) VALUES ($1,$2,$3)',[id,createHash('sha256').update(value).digest('base64url'),new Date(exp)]);return value;}
const verify=t=>originalFetch(base+'/api/auth/verify',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:t})});
let id;
try{
id=(await db.query("INSERT INTO vm_members(email) VALUES('auth-regression@example.org') ON CONFLICT(email) DO UPDATE SET email=excluded.email RETURNING id")).rows[0].id;
const long=await token();assert.ok(long.length>500);const valid=await verify(long);assert.equal(valid.status,200,'valid token longer than 500 characters must work');assert.ok(valid.headers.get('set-cookie')?.includes('semcme_member='));assert.equal((await verify(long)).status,401,'replay rejected');
assert.equal((await verify(await token(Date.now()-1000))).status,401,'expired rejected');const fresh=await token();assert.equal((await verify(fresh+'.extra')).status,401,'extra segments rejected');assert.equal((await verify(fresh.slice(0,-2)+'XX')).status,401,'tampering rejected');assert.equal((await verify(fresh)).status,200,'rejected attempts do not consume valid link');
console.log('PASS: long sign-in links, session cookie, single-use enforcement, expiration, malformed and tampered tokens.');
}finally{await db.query('DELETE FROM vm_magic_links WHERE member_id=$1',[id]);await db.query('DELETE FROM vm_members WHERE id=$1',[id]);await db.end();globalThis.fetch=originalFetch;await new Promise(r=>server.close(r));}
