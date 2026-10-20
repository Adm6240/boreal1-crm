import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import worker from '../server/index.mjs';
import {environment,request,upload,eml} from './helpers.mjs';

function profile(){return {legalName:'Arte de Limpar Ltda',tradeName:'Arte de Limpar',segment:'Varejo',state:'MG',icmsStatus:'taxpayer',cnpj:'11.222.333/0001-81',stateRegistration:'ISENTO',municipalRegistration:'123',delivery:{recipient:'Almoxarifado',postalCode:'30100-000',street:'Rua A',number:'57',complement:'Sala 2',district:'Centro',city:'Belo Horizonte',state:'MG'},commercial:{name:'Eduardo',email:'eduardo@example.test',phone:'31999999999'},financial:{name:'Marina',email:'marina@example.test',phone:'3133333333'},equipment:'DT-40',software:'Sistema Zebra',hasBought:'yes',lastSaleDate:'2026-09-01',lastSaleDescription:'Duas impressoras'};}
const write=(env,path,body,method='POST')=>worker.fetch(request(path,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),env);
test('Client fiscal/contact data persist, and renaming preserves the same e-mail history',async()=>{
  const env=environment();assert.equal((await worker.fetch(upload(eml(),'mail.eml','Arte de Limpar Ltda'),env)).status,201);
  const body={revision:0,origin:{name:'Arte de Limpar Ltda',state:'MG'},profile:profile()};const created=await write(env,'/api/clients',body);assert.equal(created.status,201,await created.clone().text());const {client}=await created.json();
  assert.equal(client.id,env.sqlite.prepare('SELECT id FROM history_clients').get().id);assert.equal(client.cnpj,'11222333000181');assert.equal(client.delivery.postalCode,'30100000');
  const updated={...client,legalName:'Arte de Limpar S/A',state:'SP',software:'Novo sistema',financial:{...client.financial,phone:'3122222222'}};
  const saved=await write(env,`/api/clients/${client.id}`,{revision:1,profile:updated},'PUT');assert.equal(saved.status,200,await saved.clone().text());assert.equal((await saved.json()).client.revision,2);
  const list=await (await worker.fetch(request('/api/clients'),env)).json();assert.equal(list.clients.length,1);assert.equal(list.clients[0].software,'Novo sistema');
  const mail=await (await worker.fetch(request('/api/client-history?client=Arte%20de%20Limpar%20S%2FA&state=SP'),env)).json();assert.equal(mail.emails.length,1);
  assert.equal((await write(env,`/api/clients/${client.id}`,{revision:1,profile:{...updated,software:'Velho'}},'PUT')).status,409);
  assert.equal((await write(env,'/api/clients',{revision:0,profile:{...profile(),legalName:'Outro cliente'}})).status,409);
});
test('Client registration rejects invalid CNPJ and last sale, stores ICMS exemption, and requires authentication',async()=>{
  const env=environment(),base=profile();
  assert.equal((await worker.fetch(new Request('https://boreal.test/api/clients'),env)).status,401);
  const cross=request('/api/clients',{method:'POST',headers:{'Content-Type':'application/json',origin:'https://untrusted.invalid'},body:JSON.stringify({revision:0,profile:base})});assert.equal((await worker.fetch(cross,env)).status,403);
  assert.equal((await write(env,'/api/clients',{revision:0,profile:{...base,cnpj:'11.111.111/1111-11'}})).status,400);
  assert.equal((await write(env,'/api/clients',{revision:0,profile:{...base,lastSaleDate:'',lastSaleDescription:''}})).status,400);
  assert.equal(env.sqlite.prepare('SELECT COUNT(*) AS n FROM client_profiles').get().n,0);
  const exempt={...base,legalName:'Órgão isento',icmsStatus:'exempt',cnpj:'45.723.174/0001-10',hasBought:'no',lastSaleDate:'',lastSaleDescription:''};const response=await write(env,'/api/clients',{revision:0,profile:exempt});assert.equal(response.status,201,await response.clone().text());const saved=await response.json();assert.equal(saved.client.cnpj,'45723174000110');assert.equal(saved.client.icmsStatus,'exempt');
});
test('Activity pre-registration creates one incomplete client, assigns its consultant and is completed on the same record',async()=>{
  const env=environment(),now='2026-10-19T00:00:00.000Z',consultantId='33333333-3333-4333-8333-333333333333';
  env.sqlite.prepare("INSERT INTO app_users (id,email,name,role,consultant_name,active,must_change_password,password_hash,created_by,created_at,updated_at) VALUES (?,?,?,?,?,1,0,?,?,?,?)").run(consultantId,'felipe@example.test','Consultor Exemplo','commercial','Consultor Exemplo','hash','fixture',now,now);
  const draft={revision:0,client:'Cliente rápido',state:'MG',owner:'Consultor Exemplo',segment:'Indústria',profile:{borealCustomer:'no',equipment:'XM7-40',software:'Sistema de campo',delivery:{postalCode:'30100-000',street:'Rua A',number:'10',complement:'Sala 2',district:'Centro',city:'Belo Horizonte',state:'MG'},commercial:{name:'Ana Compras',email:'ana@example.test',phone:'31999999999'}}};
  const response=await write(env,'/api/clients/pre-registration',draft);assert.equal(response.status,200,await response.clone().text());const {client}=await response.json();
  assert.equal(client.registrationStatus,'incomplete');assert.equal(client.equipment,'XM7-40');assert.equal(client.delivery.postalCode,'30100000');assert.equal(client.commercial.name,'Ana Compras');assert.equal(client.consultant,'Consultor Exemplo');assert.equal(env.sqlite.prepare('SELECT COUNT(*) n FROM client_profiles').get().n,1);assert.equal(env.sqlite.prepare('SELECT user_id FROM client_access WHERE client_id=?').get(client.id).user_id,consultantId);
  const completed={...profile(),legalName:'Cliente rápido',tradeName:'Cliente rápido',state:'MG',hasBought:'no',lastSaleDate:'',lastSaleDescription:'',equipment:client.equipment,software:client.software,delivery:client.delivery,commercial:client.commercial};
  const saved=await write(env,`/api/clients/${client.id}`,{revision:client.revision,profile:completed},'PUT');assert.equal(saved.status,200,await saved.clone().text());const finished=(await saved.json()).client;assert.equal(finished.id,client.id);assert.equal(finished.registrationStatus,undefined);assert.equal(env.sqlite.prepare('SELECT COUNT(*) n FROM client_profiles').get().n,1);
});
test('Quick classification updates an incomplete client without opening or validating the full profile',async()=>{
  const env=environment(),id='44444444-4444-4444-8444-444444444444',now='2026-10-13T00:00:00.000Z',payload={legalName:'Cliente importado',state:'MG',segment:'',commercial:{name:''},financial:{name:''},delivery:{},hasBought:'no',imported:true};
  env.sqlite.prepare('INSERT INTO history_clients (id,legacy_key,name,state,route_token,created_at) VALUES (?,?,?,?,?,?)').run(id,'mg|cliente importado',payload.legalName,'MG','classify-route',now);
  env.sqlite.prepare('INSERT INTO client_profiles (id,payload,revision,author_id,updated_by,created_at,updated_at) VALUES (?,?,1,?,?,?,?)').run(id,JSON.stringify(payload),'fixture','fixture',now,now);
  const classified=await write(env,`/api/clients/${id}/classification`,{revision:1,classification:'Indústria'},'PATCH');assert.equal(classified.status,200,await classified.clone().text());const {client}=await classified.json();assert.equal(client.segment,'Indústria');assert.equal(client.revision,2);assert.equal(JSON.parse(env.sqlite.prepare('SELECT payload FROM client_profiles WHERE id = ?').get(id).payload).segment,'Indústria');
  assert.equal((await write(env,`/api/clients/${id}/classification`,{revision:2,classification:'Parceiro'},'PATCH')).status,400);
  assert.equal((await write(env,`/api/clients/${id}/classification`,{revision:1,classification:'Varejo'},'PATCH')).status,409);
});
test('Administrator changes the client consultant and all imported ownership atomically',async()=>{
  const env=environment(),now='2026-10-20T12:00:00.000Z',consultantId='55555555-5555-4555-8555-555555555555';
  env.sqlite.prepare("INSERT INTO app_users (id,email,name,role,consultant_name,active,must_change_password,password_hash,created_by,created_at,updated_at) VALUES (?,?,?,?,?,1,0,?,?,?,?)").run(consultantId,'nicholas@example.test','Nicholas','commercial','Nicholas','hash','fixture',now,now);
  const created=await write(env,'/api/clients',{revision:0,origin:{name:'Arte de Limpar Ltda',state:'MG'},profile:profile()});const {client}=await created.json();
  env.sqlite.prepare('INSERT INTO import_records (kind,source_key,client_id,payload,revision,author_id,created_at) VALUES (?,?,?,?,1,?,?)').run('Atividades','activity-owner',client.id,JSON.stringify({owner:'Danielle',label:'Ligação',row:{}}),'fixture',now);
  env.sqlite.prepare('INSERT INTO client_access (client_id,user_id,granted_by) VALUES (?,?,?)').run(client.id,'11111111-1111-4111-8111-111111111111','fixture');
  const response=await write(env,`/api/clients/${client.id}/consultant`,{revision:client.revision,consultant:'Nicholas'},'PATCH');assert.equal(response.status,200,await response.clone().text());const changed=await response.json();
  assert.equal(changed.client.consultant,'Nicholas');assert.equal(changed.client.revision,2);assert.deepEqual(changed.activities.map(item=>item.revision),[2]);
  assert.equal(JSON.parse(env.sqlite.prepare('SELECT payload FROM import_records WHERE client_id=?').get(client.id).payload).owner,'Nicholas');
  assert.deepEqual(env.sqlite.prepare('SELECT user_id FROM client_access WHERE client_id=?').all(client.id).map(row=>row.user_id),[consultantId]);
  assert.equal((await write(env,`/api/clients/${client.id}/consultant`,{revision:1,consultant:'Danielle'},'PATCH')).status,409);
});
test('Only administrators can permanently delete a client and all linked server data',async()=>{
  const env=environment();assert.equal((await worker.fetch(upload(eml('delete-fixture'),'mail.eml','Arte de Limpar Ltda'),env)).status,201);
  const created=await write(env,'/api/clients',{revision:0,origin:{name:'Arte de Limpar Ltda',state:'MG'},profile:profile()});const {client}=await created.json();
  const now='2026-10-13T00:00:00.000Z';
  env.sqlite.prepare('INSERT INTO client_orders (id,client_id,project_key,payload,status,revision,author_id,updated_by,created_at,updated_at) VALUES (?,?,?,?,?,1,?,?,?,?)').run('order-delete',client.id,'projeto',JSON.stringify({snapshot:{project:'Projeto'}}),'awaiting_setup','fixture','fixture',now,now);
  env.sqlite.prepare('INSERT INTO import_records (kind,source_key,client_id,payload,author_id,created_at) VALUES (?,?,?,?,?,?)').run('Atividades','activity-delete',client.id,'{}','fixture',now);
  const commercialId='22222222-2222-4222-8222-222222222222',token='fixture-commercial-session';
  env.sqlite.prepare("INSERT INTO app_users (id,email,name,role,consultant_name,active,must_change_password,password_hash,created_by,created_at,updated_at) VALUES (?,?,?,?,?,1,0,?,?,?,?)").run(commercialId,'consultor@example.test','Consultor','commercial','Consultor','hash','fixture',now,now);
  env.sqlite.prepare('INSERT INTO app_sessions VALUES (?,?,?)').run(createHash('sha256').update(token).digest('hex'),commercialId,Date.now()+3600000);
  const body=JSON.stringify({revision:client.revision}),headers={'Content-Type':'application/json',cookie:`__Host-boreal-session=${token}`,'oai-authenticated-user-id':'commercial-test','oai-authenticated-user-email':'consultor@example.test'};
  assert.equal((await worker.fetch(new Request(`https://boreal.test/api/clients/${client.id}`,{method:'DELETE',headers,body}),env)).status,403);
  const deleted=await worker.fetch(request(`/api/clients/${client.id}`,{method:'DELETE',headers:{'Content-Type':'application/json'},body}),env);assert.equal(deleted.status,200,await deleted.clone().text());assert.equal((await deleted.json()).deleted,true);
  for(const table of ['history_attachments','history_emails','client_orders','import_records','client_profiles','history_clients'])assert.equal(env.sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n,0,table);
  assert.equal(env.objects.size,0);
  assert.equal((await worker.fetch(request(`/api/clients/${client.id}`,{method:'DELETE',headers:{'Content-Type':'application/json'},body}),env)).status,404);
});
test('CEP lookup returns only address fields and handles missing or unavailable postal codes',async()=>{
  const env=environment(),original=globalThis.fetch;
  assert.equal((await worker.fetch(new Request('https://boreal.test/api/cep/01001000'),env)).status,401);
  try{
    globalThis.fetch=async url=>{assert.equal(url,'https://viacep.com.br/ws/01001000/json/');return Response.json({cep:'01001-000',logradouro:'Praça da Sé',bairro:'Sé',localidade:'São Paulo',uf:'SP',ibge:'3550308'});};
    const response=await worker.fetch(request('/api/cep/01001000'),env);
    assert.equal(response.status,200);assert.deepEqual(await response.json(),{street:'Praça da Sé',district:'Sé',city:'São Paulo',state:'SP'});
    globalThis.fetch=async()=>Response.json({erro:true});
    assert.equal((await worker.fetch(request('/api/cep/01001000'),env)).status,404);
    globalThis.fetch=async()=>{throw new Error('offline');};
    assert.equal((await worker.fetch(request('/api/cep/01001000'),env)).status,503);
  }finally{globalThis.fetch=original;}
});
