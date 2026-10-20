import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../server/index.mjs';
import {environment,request} from './helpers.mjs';
import {historyLine,kitHistory} from './inventory-movement-fixtures.mjs';
const read=async(env,params={})=>{const r=await worker.fetch(request('/api/inventory/movements?'+new URLSearchParams({grouped:'1',...params})),env);assert.equal(r.status,200,await r.clone().text());return r.json();};
test('Order number is exact; search returns the printer and its linked accessories, including legacy contact',async()=>{
 const env=environment();kitHistory(env,{legacy:true});kitHistory(env,{number:'59470',condition:'new'});
 const result=await read(env,{number:'5947',q:'Cliente de teste'});assert.equal(result.movements.length,1);const parent=result.movements[0];assert.equal(parent.name,'Impressora');assert.equal(parent.children.length,4);assert.deepEqual(parent.children.map(c=>c.name).sort(),['Bateria','Cabo tipo C','Capa de proteção','Carregador'].sort());assert.equal(parent.context.contact,'Solicitante de teste');assert.ok(parent.children.every(c=>c.context.number==='5947'&&c.itemCondition==='used'));
 const searchAccessory=await read(env,{q:'Cabo tipo C',number:'5947'});assert.equal(searchAccessory.movements[0].name,'Impressora');assert.equal(searchAccessory.movements[0].children.length,4);
 const exactAccessory=await read(env,{itemId:'Cabo tipo C-used-XM7-40',number:'5947',direction:'exit'});assert.equal(exactAccessory.movements.length,1);assert.equal(exactAccessory.movements[0].name,'Cabo tipo C');assert.equal(exactAccessory.movements[0].children.length,0);
 const exactPrinter=await read(env,{itemId:'Impressora-used-XM7-40',number:'5947'});assert.equal(exactPrinter.movements.length,1);assert.equal(exactPrinter.movements[0].name,'Impressora');
 assert.equal((await read(env,{itemId:'Cabo tipo C-used-XM7-40',number:'5947',direction:'entry'})).movements.length,0);
 assert.equal((await read(env,{q:'Solicitante de teste',number:'5947'})).movements.length,1);
 assert.equal((await read(env,{number:'5947',condition:'new'})).movements.length,0);
 assert.equal((await read(env,{condition:'new'})).movements[0].context.number,'59470');
 assert.equal((await worker.fetch(request('/api/inventory/movements?condition=bad'),env)).status,400);
 assert.equal((await worker.fetch(request('/api/inventory/movements?direction=bad'),env)).status,400);
});
test('Grouping keeps dates, customers, projects and standalone accessories separate and avoids ambiguous parents',async()=>{
 const env=environment();kitHistory(env);kitHistory(env,{date:'2026-10-12'});kitHistory(env,{client:'Outro cliente'});kitHistory(env,{project:'Outro projeto'});historyLine(env,{number:'Avulso',part:'Bateria'});
 let result=await read(env);assert.equal(result.movements.length,5);assert.equal(result.movements.find(m=>m.context.number==='Avulso').children.length,0);
 historyLine(env,{part:'Impressora segunda'});result=await read(env,{number:'5947',from:'2026-10-13',to:'2026-10-13',q:'Cliente de teste'});const ambiguous=result.movements.filter(m=>m.context.project==='Testes'&&m.context.client==='Cliente de teste');assert.equal(ambiguous.length,6);assert.ok(ambiguous.every(m=>m.children.length===0));
});
test('Pagination counts complete movements rather than splitting the kit across pages',async()=>{
 const env=environment();for(let i=0;i<52;i++)kitHistory(env,{number:String(i)});
 const first=await read(env);assert.equal(first.movements.length,50);assert.equal(first.hasMore,true);assert.ok(first.movements.every(m=>m.name==='Impressora'&&m.children.length===4));
 const last=await read(env,{offset:'50'});assert.equal(last.movements.length,2);assert.equal(last.hasMore,false);assert.ok(last.movements.every(m=>m.children.length===4));assert.equal(new Set([...first.movements,...last.movements].map(m=>m.context.number)).size,52);
 assert.equal(env.sqlite.prepare('SELECT SUM(balance) n FROM inventory_items').get().n,0);
});
test('Flat history preserves individual quantities and condition is recorded for manually registered items',async()=>{
 const env=environment();kitHistory(env);const flat=await read(env,{grouped:'0'});assert.equal(flat.movements.length,5);assert.equal(flat.movements.reduce((s,m)=>s+m.delta,0),-5);
 const r=await worker.fetch(request('/api/inventory/items',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:'manual',sku:'manual',name:'Manual',kind:'equipment',minimum:0,condition:'new'})}),env);assert.equal(r.status,200);
 const inventory=await (await worker.fetch(request('/api/inventory'),env)).json();assert.equal(inventory.items.find(i=>i.id==='manual').condition,'new');
});

test('Historical observations persist across reads, preserve source notes and reject stale concurrent edits',async()=>{
 const env=environment(),id=historyLine(env);const original=env.sqlite.prepare('SELECT payload FROM inventory_import_lines WHERE id=?').get(id).payload;
 const save=(note,revision)=>worker.fetch(request('/api/inventory/movements/'+id,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({note,revision})}),env);
 const responses=await Promise.all([save('Primeira anotação',1),save('Edição concorrente',1)]);assert.deepEqual(responses.map(r=>r.status).sort(),[200,409]);
 const saved=await responses.find(r=>r.status===200).json();assert.equal(saved.revision,2);assert.equal(saved.note,'Primeira anotação');
 let fresh=(await read(env)).movements[0];assert.equal(fresh.note,'Primeira anotação');assert.equal(fresh.revision,2);
 assert.equal((await save('',2)).status,200);fresh=(await read(env)).movements[0];assert.equal(fresh.note,'');assert.equal(fresh.revision,3);
 assert.equal(env.sqlite.prepare('SELECT payload FROM inventory_import_lines WHERE id=?').get(id).payload,original);assert.equal(env.sqlite.prepare('SELECT COUNT(*) n FROM inventory_movements').get().n,0);
 env.sqlite.prepare("UPDATE app_users SET role='dispatch'").run();assert.equal((await save('Não permitido',3)).status,403);
});
