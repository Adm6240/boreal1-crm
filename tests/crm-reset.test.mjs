import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../server/index.mjs';
import {environment,request} from './helpers.mjs';
import {resetCrm,crmEpoch,resetId} from '../server/crm-reset.mjs';
import {digest} from '../server/email.mjs';
const post=(env,path,body,token=null)=>worker.fetch(token?new Request('https://boreal.test'+path,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify(body)}):request(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),env);
const maintenance='/api/maintenance/crm-reset-20261020';
function seed(env){const d=env.sqlite,now='2026-10-20T12:00:00.000Z',user='11111111-1111-4111-8111-111111111111';
 d.prepare("INSERT INTO history_clients VALUES ('client','cliente|MG','Cliente','MG','route',?)").run(now);
 d.prepare("INSERT INTO client_profiles (id,payload,revision,author_id,updated_by,created_at,updated_at) VALUES ('client',?,1,'fixture','fixture',?,?)").run(JSON.stringify({legalName:'Cliente',state:'MG',commercial:{},financial:{},delivery:{}}),now,now);
 for(const [id,kind,key] of [[1,'Clientes','CLI-1'],[2,'Atividades','ACT-1'],[3,'Contatos','CONTACT-1'],[4,'Negócios','DEAL-1']])d.prepare("INSERT INTO import_records VALUES (?,?,?,'client',?,1,'fixture',?)").run(id,kind,key,JSON.stringify({row:{nota:'Histórico',assunto:'Atividade',importar:'SIM'},owner:'Danielle',label:'Cliente'}),now);
 d.prepare("INSERT INTO import_batches VALUES ('batch','anterior.xlsx','{}','fixture',?)").run(now);d.prepare("INSERT INTO client_access VALUES ('client',?,'fixture')").run(user);
 d.prepare("INSERT INTO user_activities (user_id,cache_key,payload,revision,updated_at) VALUES (?,'old-cache',?,7,?)").run(user,JSON.stringify([{id:1,subject:'Atividade local',client:'Cliente',priority:'Normal'}]),now);
 d.prepare("INSERT INTO inventory_items (id,sku,name,kind,created_at) VALUES ('item','ITEM','Impressora','equipment',?)").run(now);d.prepare("INSERT INTO goal_settings VALUES (2026,'{}','fixture',?)").run(now);
 return {now,user};
}
test('one-time CRM reset archives all target data, preserves users, orders, stock and history links, and cannot erase a later import',async()=>{
 const env=environment(),{now,user}=seed(env),d=env.sqlite;
 d.prepare("INSERT INTO client_orders (id,client_id,project_key,payload,status,workflow,revision,author_id,updated_by,created_at,updated_at) VALUES ('order','client','project','{}','awaiting_setup','{}',1,'fixture','fixture',?,?)").run(now,now);
 d.prepare("INSERT INTO project_stages VALUES ('client','project','Projeto','Contato','manual',1,'fixture',?)").run(now);
 const r=await resetCrm(env,'owner');assert.equal(r.removed.clients,1);assert.equal(r.removed.importedActivities,1);assert.equal(r.removed.personalActivities,1);
 for(const t of ['client_profiles','client_access','import_records','import_batches'])assert.equal(d.prepare('SELECT COUNT(*) n FROM '+t).get().n,0,t);
 for(const t of ['client_orders','history_clients','inventory_items','goal_settings','app_users','app_sessions','project_stages'])assert.equal(d.prepare('SELECT COUNT(*) n FROM '+t).get().n,1,t);
 const a=d.prepare('SELECT * FROM user_activities WHERE user_id=?').get(user);assert.equal(a.payload,'[]');assert.equal(a.revision,8);assert.equal(a.cache_key,null);assert.ok(d.prepare('SELECT COUNT(*) n FROM crm_reset_rows').get().n>0);
 d.prepare("INSERT INTO import_batches VALUES ('new','nova.xlsx','{}','fixture',?)").run(now);assert.equal((await resetCrm(env,'owner')).alreadyProcessed,true);assert.equal(d.prepare('SELECT COUNT(*) n FROM import_batches').get().n,1);
});
test('maintenance endpoint requires the expiring scoped credential and exact job confirmation',async()=>{
 const env=environment();seed(env);const token='a'.repeat(64);env.BOREAL_CRM_RESET_TOKEN_SHA256=await digest(new TextEncoder().encode(token));env.BOREAL_CRM_RESET_EXPIRES_AT=new Date(Date.now()+60000).toISOString();const body={confirmation:'ZERAR ATIVIDADES E CLIENTES',job:resetId};
 assert.equal((await post(env,maintenance,body)).status,403);assert.equal((await post(env,maintenance,body,'b'.repeat(64))).status,403);assert.equal((await post(env,maintenance,{...body,job:'other'},token)).status,400);
 env.BOREAL_CRM_RESET_EXPIRES_AT=new Date(Date.now()-1).toISOString();assert.equal((await post(env,maintenance,body,token)).status,403);env.BOREAL_CRM_RESET_EXPIRES_AT=new Date(Date.now()+60000).toISOString();assert.equal((await post(env,maintenance,body,token)).status,200);assert.equal((await post(env,maintenance,body,token)).status,200);
});
test('old activity snapshots and stale import previews cannot repopulate the cleared base',async()=>{
 const env=environment(),{user}=seed(env);await resetCrm(env,'owner');const epoch=await crmEpoch(env);
 const stale=await worker.fetch(request('/api/activities',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({revision:7,records:[{id:2,subject:'Antiga',client:'Cliente',priority:'Normal'}]})}),env);assert.equal(stale.status,409);
 assert.equal((await post(env,'/api/imports/apply',{rows:[]})).status,409);
 const response=await worker.fetch(request('/api/activities'),env),current=await response.json();assert.equal(current.epoch,epoch);assert.equal(current.records.length,0);assert.notEqual(current.cacheKey,'old-cache');
 const saved=await worker.fetch(request('/api/activities',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({revision:current.revision,records:[{id:3,subject:'Nova',client:'Novo cliente',priority:'Normal'}],epoch})}),env);assert.equal(saved.status,200,await saved.clone().text());assert.equal(JSON.parse(env.sqlite.prepare('SELECT payload FROM user_activities WHERE user_id=?').get(user).payload).length,1);
});
test('administrator can recover the archived base while empty, with new revisions and keys; later data blocks restoration',async()=>{
 const env=environment(),{user}=seed(env);await resetCrm(env,'owner');const body={confirmation:'RESTAURAR BASE ANTERIOR'};
 env.sqlite.prepare("UPDATE app_users SET role='commercial'").run();assert.equal((await post(env,'/api/crm-reset',body)).status,403);env.sqlite.prepare("UPDATE app_users SET role='admin'").run();const response=await post(env,'/api/crm-reset',body);assert.equal(response.status,200,await response.clone().text());assert.equal(env.sqlite.prepare('SELECT COUNT(*) n FROM client_profiles').get().n,1);assert.equal(env.sqlite.prepare('SELECT COUNT(*) n FROM import_records').get().n,4);const a=env.sqlite.prepare('SELECT * FROM user_activities WHERE user_id=?').get(user);assert.equal(a.revision,9);assert.equal(a.cache_key,null);assert.equal(JSON.parse(a.payload)[0].subject,'Atividade local');assert.match(await crmEpoch(env),/:restored$/);assert.equal((await post(env,'/api/crm-reset',body)).status,200);
 const other=environment();seed(other);await resetCrm(other,'owner');other.sqlite.prepare("INSERT INTO history_clients VALUES ('new','new|MG','Novo','MG','new-route','2026-10-20')").run();other.sqlite.prepare("INSERT INTO client_profiles (id,payload,revision,author_id,updated_by,created_at,updated_at) VALUES ('new','{}',1,'fixture','fixture','2026-10-20','2026-10-20')").run();assert.equal((await post(other,'/api/crm-reset',body)).status,409);assert.equal(other.sqlite.prepare('SELECT COUNT(*) n FROM client_profiles').get().n,1);
});
