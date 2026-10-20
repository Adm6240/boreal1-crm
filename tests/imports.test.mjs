import test from 'node:test';
import assert from 'node:assert/strict';
import {environment} from './helpers.mjs';
import {planImport,applyImport,importedData,updateImported} from '../server/imports.mjs';
import {listProfiles} from '../server/clients.mjs';
const admin={role:'admin',authId:'fixture',consultantName:'Danielle'};
const row=(kind,line,data)=>({kind,line,row:{importar:'SIM',consultor_destino:'Danielle',...data}});
const client=row('Clientes',2,{cliente_id:'CLI-1',nome:'Cliente importado'});
const contact=row('Contatos',2,{contato_id:'CON-1',cliente_id:'CLI-1',nome:'Contato',email:'contato@example.test'});
const activity=row('Atividades',2,{atividade_id:'ATI-1',cliente_id:'CLI-1',assunto:'Retorno',concluida:'NÃO',data_vencimento:'2026-10-02',nota:'Descrição'});
test('imports require administrator including preview',async()=>{await assert.rejects(planImport(environment(),{rows:[client]},{role:'commercial'}),e=>e.status===403);});
test('preview is read only, reports unresolved clients and owners',async()=>{const env=environment();const p=await planImport(env,{rows:[client,activity,row('Atividades',3,{atividade_id:'ATI-2',cliente_id:'missing',assunto:'Pendente'}),row('Clientes',3,{cliente_id:'CLI-2',nome:'Outro',consultor_destino:'Inexistente'})]},admin);assert.equal(p.counts.ready,2);assert.equal(p.counts.issues,2);assert.equal(env.sqlite.prepare('SELECT count(*) AS n FROM client_profiles').get().n,0);});
test('imports link contacts and activities, preserve missing fiscal data and ignore duplicates',async()=>{const env=environment();const body={filename:'base.xlsx',rows:[activity,contact,client]};const p=await applyImport(env,body,admin);assert.equal(p.counts.ready,3);const profiles=await listProfiles(env);assert.equal(profiles.length,1);assert.equal(profiles[0].cnpj,'');assert.equal(profiles[0].state,'');assert.equal(profiles[0].commercial.name,'Contato');const d=await importedData(env,admin);assert.equal(d.activities.length,1);assert.equal(d.activities[0].clientProfileId,profiles[0].id);assert.equal(d.activities[0].email,'contato@example.test');const again=await applyImport(env,body,admin);assert.equal(again.counts.ready,0);assert.equal(again.counts.duplicates,3);});
test('lost Pipedrive deals remain available as real dashboard records',async()=>{const env=environment(),lost=row('Negócios',3,{negocio_id:'NEG-LOST',cliente_id:'CLI-1',titulo:'Projeto perdido',status:'Perdido',proxima_atividade:'2026-10-10'});await applyImport(env,{filename:'perdidos.xlsx',rows:[client,lost]},admin);const data=await importedData(env,admin);assert.equal(data.projects.length,1);assert.equal(data.projects[0].stage,'Perdido');assert.equal(data.projects[0].project,'Projeto perdido');});
test('updates persist with revision conflict and owner protection',async()=>{const env=environment();await applyImport(env,{rows:[client,activity]},admin);const a=(await importedData(env,admin)).activities[0];assert.equal((await updateImported(env,a.importRecordId,{activity:{...a,completed:true},revision:1},admin)).revision,2);assert.equal((await importedData(env,admin)).activities[0].completed,true);await assert.rejects(updateImported(env,a.importRecordId,{activity:a,revision:1},admin),e=>e.status===409);await assert.rejects(updateImported(env,a.importRecordId,{activity:a,revision:2},{role:'commercial',consultantName:'Outro'}),e=>e.status===403);});
test('excluded rows and failed batches do not write partial clients',async()=>{const env=environment();const p=await applyImport(env,{rows:[{...client,row:{...client.row,importar:'REVISAR'}}]},admin);assert.equal(p.counts.excluded,1);assert.equal(env.sqlite.prepare('SELECT count(*) AS n FROM client_profiles').get().n,0);const bad={...activity,row:{...activity.row,nota:'x'.repeat(65000)}};await assert.rejects(applyImport(env,{rows:[client,bad]},admin));assert.equal(env.sqlite.prepare('SELECT count(*) AS n FROM client_profiles').get().n,0);});

test('Existing imported descriptions compact excessive blank lines and preserve edited rich notes',async()=>{
 const env=environment();
 const source='18/01 Feito contato pelo site'+ '\n'.repeat(19)+'<div>01/02 Apresentação enviada&nbsp;ao contato</div>'+ '\n'.repeat(17)+'<div>02/03 novo e-mail enviado<br><div>15/03 Retornar depois</div></div>';
 const imported={...activity,row:{...activity.row,nota:source}};
 await applyImport(env,{rows:[client,imported]},admin);
 const a=(await importedData(env,admin)).activities[0];
 assert.equal(a.description,'18/01 Feito contato pelo site\n\n01/02 Apresentação enviada ao contato\n\n02/03 novo e-mail enviado\n\n15/03 Retornar depois');
 assert.equal(a.descriptionHtml,'');
 const raw=JSON.parse(env.sqlite.prepare("SELECT payload FROM import_records WHERE kind='Atividades'").get().payload);
 assert.equal(raw.row.nota,source,'Source history remains intact');
 const edited={...a,description:'Histórico corrigido no Farid\nPróximo contato',descriptionHtml:'<div>Histórico <strong>corrigido</strong> no Farid</div><div>Próximo contato</div>'};
 await updateImported(env,a.importRecordId,{activity:edited,revision:a.revision},admin);
 const reload=(await importedData(env,admin)).activities[0];
 assert.equal(reload.description,edited.description);assert.equal(reload.descriptionHtml,edited.descriptionHtml);
});

test('Imported retail group resolves each company and keeps identity after project edits and note saves',async()=>{
 const env=environment(),group=row('Clientes',2,{cliente_id:'GROUP',nome:'Varejo',estado:'GO'}),a=row('Atividades',3,{atividade_id:'SUP',cliente_id:'GROUP',assunto:'FUP 2026',negocio_titulo:'Supermedica Hospitalar',contato_nome:'Janine',nota:'Nota Supermedica'}),b=row('Atividades',4,{atividade_id:'LEV',cliente_id:'GROUP',assunto:'FUP 2026',negocio_titulo:'Leveros Refrigelo',contato_nome:'Flavio',nota:'Nota Leveros'});
 await applyImport(env,{rows:[group,a,b]},admin);let data=await importedData(env,admin);assert.deepEqual(data.activities.map(x=>x.client),['Supermedica Hospitalar','Leveros Refrigelo']);assert.equal(data.activities[0].organization,'Varejo');assert.equal(data.activities[0].clientProfileId,null);assert.equal(data.activities[0].contact,'Janine');assert.equal(data.activities[1].contact,'Flavio');
 const first=data.activities[0];await updateImported(env,first.importRecordId,{revision:first.revision,activity:{...first,project:'Novo projeto',notes:[{date:'14/10/2026',author:'Felipe',text:'Nota individual'}]}},admin);data=await importedData(env,admin);assert.equal(data.activities[0].client,'Supermedica Hospitalar');assert.equal(data.activities[0].project,'Novo projeto');assert.equal(data.activities[0].notes.length,1);assert.equal(data.activities[1].notes.length,0);assert.equal(data.activities[1].client,'Leveros Refrigelo');
});

test('Legacy water organization labels split real clients and never appear in the client registry',async()=>{
 const env=environment(),water=row('Clientes',2,{cliente_id:'WATER-ES',nome:'Agua_ES',estado:'ES',setor:'Saneamento'}),stateGroup=row('Clientes',3,{cliente_id:'STATE-MG',nome:'MG',estado:'MG'}),rows=[water,stateGroup,row('Atividades',4,{atividade_id:'COLATINA',cliente_id:'WATER-ES',assunto:'FUP',negocio_titulo:'Prefeitura de Colatina _ Sanear',contato_nome:'Geral'}),row('Atividades',5,{atividade_id:'SAAE',cliente_id:'WATER-ES',assunto:'Contrato',negocio_titulo:'Saae São Mateus',contato_nome:'Luiz'}),row('Atividades',6,{atividade_id:'CENTURY',cliente_id:'STATE-MG',assunto:'Reunião',negocio_titulo:'Century Telecom',contato_nome:'Cássia'})];
 await applyImport(env,{filename:'agua.xlsx',rows},admin);let data=await importedData(env,admin);
 assert.deepEqual(data.activities.map(activity=>activity.client),['Prefeitura de Colatina _ Sanear','Saae São Mateus','Century Telecom']);
 assert.deepEqual(data.activities.map(activity=>activity.organization),['Concessionária','Concessionária','Não informado']);
 assert.ok(data.activities.every(activity=>activity.clientProfileId===null));assert.equal((await listProfiles(env)).length,0);
 const actualId='22222222-2222-4222-8222-222222222222',now='2026-10-20T00:00:00.000Z',profile={legalName:'Saae São Mateus',tradeName:'SAAE São Mateus',segment:'Concessionária',state:'ES',commercial:{name:'Luiz',email:'',phone:''},financial:{},delivery:{},equipment:'',software:'',hasBought:'no'};
 env.sqlite.prepare('INSERT INTO history_clients (id,legacy_key,name,state,route_token,created_at) VALUES (?,?,?,?,?,?)').run(actualId,'saae sao mateus|ES','Saae São Mateus','ES','saae-route',now);
 env.sqlite.prepare('INSERT INTO client_profiles (id,payload,revision,author_id,updated_by,created_at,updated_at) VALUES (?,?,1,?,?,?,?)').run(actualId,JSON.stringify(profile),'fixture','fixture',now,now);
 data=await importedData(env,admin);assert.equal(data.activities.find(activity=>activity.client==='Saae São Mateus').clientProfileId,actualId);assert.equal((await listProfiles(env))[0].legalName,'Saae São Mateus');
});
