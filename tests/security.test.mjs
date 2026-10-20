import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import worker from '../server/index.mjs';
import {environment,request,upload,eml} from './helpers.mjs';
const userId='88888888-8888-4888-8888-888888888888';
function consultant(env){
 env.sqlite.prepare('INSERT INTO app_users (id,email,name,role,consultant_name,password_hash,must_change_password,active,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,0,1,?,?,?)').run(userId,'consultant@example.test','Consultor A','commercial','Consultor A','fixture-user-hash','fixture','2026-10-14','2026-10-14');
 env.sqlite.prepare('INSERT INTO app_sessions VALUES (?,?,?)').run(createHash('sha256').update('fixture-commercial').digest('hex'),userId,Date.now()+60000);
 return (path,data,method='PUT')=>new Request('https://boreal.test'+path,{method:data?method:'GET',headers:{cookie:'__Host-boreal-session=fixture-commercial',...(data?{'Content-Type':'application/json'}:{})},...(data?{body:JSON.stringify(data)}:{})});
}
test('Wallet checks deny unrelated messages and files; an admin grant permits them',async()=>{
 const env=environment(),call=consultant(env);const imported=await worker.fetch(upload(eml(),'fixture.eml','Outro cliente'),env);assert.equal(imported.status,201);const id=(await imported.json()).id;
 for(const path of ['/api/client-history/messages/'+id,'/api/client-history/original/'+id,'/api/client-history?client=Outro%20cliente&state=MG'])assert.equal((await worker.fetch(call(path),env)).status,403);
 const client=env.sqlite.prepare('SELECT client_id FROM history_emails WHERE id=?').get(id);
 assert.equal((await worker.fetch(call('/api/clients/'+client.client_id+'/access',{userId,grant:true}),env)).status,403);
 const grant=await worker.fetch(request('/api/clients/'+client.client_id+'/access',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({userId,grant:true})}),env);assert.equal(grant.status,200);
 assert.equal((await worker.fetch(call('/api/client-history/messages/'+id),env)).status,200);
 assert.equal((await worker.fetch(call('/api/client-history/original/'+id),env)).status,200);
});
test('Personal activities survive requests, enforce revision and cannot forge the commercial owner',async()=>{
 const env=environment(),call=consultant(env);const record={id:1,subject:'Atividade',client:'Cliente',priority:'Normal',owner:'Outro consultor'};
 let response=await worker.fetch(call('/api/activities',{revision:0,records:[record]}),env);assert.equal(response.status,200);assert.equal((await response.json()).revision,1);
 const saved=await (await worker.fetch(call('/api/activities'),env)).json();assert.equal(saved.records[0].owner,'Consultor A');
 const admin=await (await worker.fetch(request('/api/activities'),env)).json();assert.deepEqual(admin.records,[]);
 assert.equal((await worker.fetch(call('/api/activities',{revision:0,records:[]}),env)).status,409);
 assert.equal((await worker.fetch(call('/api/activities',{revision:1,records:[{...record,priority:'Normal" onclick="evil'}]}),env)).status,400);
 assert.equal(env.sqlite.prepare("SELECT count(*) AS n FROM security_events WHERE action='activities_saved'").get().n,1);
});
test('A new commercial history client grants only its creator access',async()=>{
 const env=environment(),call=consultant(env);const path='/api/project-stages?client=Cliente%20novo&state=MG';
 assert.equal((await worker.fetch(call(path,{project:'Projeto novo',stage:'Contato'}),env)).status,200);
 assert.equal((await worker.fetch(call(path),env)).status,200);
});
test('Public assets contain no contact fixtures and HTML carries a restrictive CSP',async()=>{
 const env=environment();for(const path of ['/assets/activities.js','/assets/app.js']){const response=await worker.fetch(new Request('https://boreal.test'+path),env);assert.equal(response.status,200);const source=await response.text();assert.doesNotMatch(source,/eduardo@artedelimpar|Solicitada atualização das datas do projeto|31 9941-2210/);}
 const page=await worker.fetch(new Request('https://boreal.test/'),env);assert.match(page.headers.get('content-security-policy'),/script-src 'self'/);assert.match(page.headers.get('content-security-policy'),/frame-ancestors/);assert.equal(page.headers.get('permissions-policy'),'camera=(), microphone=(), geolocation=()');
 assert.equal((await worker.fetch(new Request('https://boreal.test/tests/fixtures/ui-data.json'),env)).status,404);
});
test('Security migration revokes shared-password sessions and preserves client records',()=>{
 const db=new DatabaseSync(':memory:');db.exec('PRAGMA foreign_keys=ON');for(const f of fs.readdirSync('drizzle').filter(f=>f.endsWith('.sql')&&f<'0015_security_hardening.sql').sort())db.exec(fs.readFileSync('drizzle/'+f,'utf8'));
 db.prepare('INSERT INTO auth_settings VALUES (1,?)').run('shared-hash');
 for(const [id,hash] of [['one','shared-hash'],['two','shared-hash'],['three','personal-hash']]){db.prepare('INSERT INTO app_users (id,email,name,role,password_hash,must_change_password,active,created_by,created_at,updated_at) VALUES (?,?,?,?,?,0,1,?,?,?)').run(id,id+'@example.test',id,'commercial',hash,'fixture','date','date');db.prepare('INSERT INTO app_sessions VALUES (?,?,?)').run(id,id,Date.now()+60000);}
 db.prepare('INSERT INTO history_clients VALUES (?,?,?,?,?,?)').run('client','key','Cliente preservado','MG','token','date');
 db.exec(fs.readFileSync('drizzle/0015_security_hardening.sql','utf8'));
 assert.equal(db.prepare('SELECT count(*) AS n FROM app_sessions').get().n,0);assert.equal(db.prepare('SELECT must_change_password FROM app_users WHERE id=?').get('one').must_change_password,1);assert.equal(db.prepare('SELECT name FROM history_clients').get().name,'Cliente preservado');
});
test('Fixed dependencies and bundled spreadsheet reader use corrected versions',async()=>{
 const lock=JSON.parse(fs.readFileSync('package-lock.json','utf8'));assert.equal(lock.packages['node_modules/xlsx'].version,'0.20.3');
 const reader=await worker.fetch(new Request('https://boreal.test/assets/xlsx.min.js'),environment());assert.match(await reader.text(),/0\.20\.3/);
 assert.ok(Number(lock.packages['node_modules/drizzle-orm'].version.split('.')[1])>=45);
});
