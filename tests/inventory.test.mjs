import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../server/index.mjs';
import {environment,request} from './helpers.mjs';
const post=(env,path,body,method='POST')=>worker.fetch(request(path,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),env);
async function item(env,name,quantity=10){const id=crypto.randomUUID();assert.equal((await post(env,'/api/inventory/items',{id,sku:name,name,kind:'accessory',minimum:2})).status,200);const b={id:crypto.randomUUID(),itemId:id,quantity,date:'2026-10-15',reference:'Saldo inicial',note:''};assert.equal((await post(env,'/api/inventory/entries',b)).status,200);assert.equal((await post(env,'/api/inventory/entries',b)).status,200);return id;}
async function order(env){const id=crypto.randomUUID(),p={id,revision:0,snapshot:{project:'Projeto estoque',consultant:'Consultor',value:100},movement:'Venda',orderValue:100,delivery:{recipient:'Cliente',postalCode:'30100000',street:'Rua A',number:'1',complement:'',district:'Centro',city:'Belo Horizonte',state:'MG'},items:[{kind:'accessory',description:'Bateria',quantity:2}],notes:''};const r=await post(env,'/api/client-orders?client=Cliente%20Estoque&state=MG',p);assert.equal(r.status,201,await r.clone().text());return {id,p};}
const move=(env,id,body)=>post(env,'/api/orders/workflow/'+id,body);
test('Entries are idempotent, kits share individual balances and notes use revisions',async()=>{
 const env=environment(),printer=await item(env,'Impressora'),battery=await item(env,'Bateria',4);
 assert.equal(env.sqlite.prepare('SELECT balance FROM inventory_items WHERE id=?').get(printer).balance,10);
 const kit={id:crypto.randomUUID(),name:'Kit XM7-40',components:[{itemId:printer,quantity:1},{itemId:battery,quantity:1}]};assert.equal((await post(env,'/api/inventory/kits',kit)).status,200);
 const read=await (await worker.fetch(request('/api/inventory'),env)).json();assert.equal(read.kits[0].components.length,2);assert.equal(read.items.length,2);
 const duplicate=await post(env,'/api/inventory/kits',{...kit,id:crypto.randomUUID(),name:'Impressora XM7-40'});assert.equal(duplicate.status,409);assert.match(await duplicate.text(),/mesma composição/);
 assert.equal((await post(env,'/api/inventory/kits/'+kit.id,{name:'Bixolon XM7-40',components:[{itemId:printer,quantity:1},{itemId:battery,quantity:2}]},'PATCH')).status,200);
 const kitEntry={id:crypto.randomUUID(),kitId:kit.id,condition:'used',quantity:3,date:'2026-10-16',reference:'NF fabricante',note:'Kits fechados'};assert.equal((await post(env,'/api/inventory/kit-entries',kitEntry)).status,200);assert.equal((await post(env,'/api/inventory/kit-entries',kitEntry)).status,200);
 assert.equal(env.sqlite.prepare('SELECT balance FROM inventory_items WHERE id=?').get(printer).balance,13);assert.equal(env.sqlite.prepare('SELECT balance FROM inventory_items WHERE id=?').get(battery).balance,10);assert.equal(env.sqlite.prepare("SELECT COUNT(*) n FROM inventory_movements WHERE json_extract(context,'$.kitId')=?").get(kit.id).n,2);
 assert.equal(env.sqlite.prepare("SELECT json_extract(context,'$.condition') condition FROM inventory_movements WHERE json_extract(context,'$.kitId')=? LIMIT 1").get(kit.id).condition,'used');
 assert.equal((await post(env,'/api/inventory/kit-entries',{...kitEntry,id:crypto.randomUUID(),condition:''})).status,400);
 assert.equal((await post(env,'/api/inventory/kits/'+kit.id,{},'DELETE')).status,200);assert.equal(env.sqlite.prepare('SELECT balance FROM inventory_items WHERE id=?').get(printer).balance,13);
 const entries=(await (await worker.fetch(request('/api/inventory/movements?q=Bateria'),env)).json()).movements,initial=entries.find(entry=>entry.context.reference==='Saldo inicial');assert.equal(entries.length,2);assert.equal(initial.delta,4);
 const path='/api/inventory/movements/'+initial.id;assert.equal((await post(env,path,{note:'Conferido',revision:1},'PATCH')).status,200);assert.equal((await post(env,path,{note:'Antigo',revision:1},'PATCH')).status,409);
 for(const quantity of [-1,0,1.2,1000001])assert.equal((await post(env,'/api/inventory/entries',{id:crypto.randomUUID(),itemId:printer,quantity,date:'2026-10-15',reference:'NF'})).status,400);
 assert.equal((await post(env,'/api/inventory/kits',{...kit,id:crypto.randomUUID(),components:[{itemId:printer,quantity:1},{itemId:printer,quantity:2}]})).status,400);
 env.sqlite.prepare("UPDATE app_users SET role='dispatch'").run();assert.equal((await worker.fetch(request('/api/inventory'),env)).status,200);assert.equal((await post(env,'/api/inventory/items',{id:'x'})).status,403);
 env.sqlite.prepare("UPDATE app_users SET role='commercial'").run();assert.equal((await worker.fetch(request('/api/inventory'),env)).status,403);
 assert.equal((await worker.fetch(new Request('https://boreal.test/api/inventory'),env)).status,401);
});
test('Inventory keeps item name and manufacturer in separate fields',async()=>{
 const env=environment(),id=crypto.randomUUID(),response=await post(env,'/api/inventory/items',{id,sku:'XM7-40',name:'Impressora XM7-40',manufacturer:'Bixolon',kind:'equipment',condition:'new',minimum:0});assert.equal(response.status,200,await response.clone().text());const result=await (await worker.fetch(request('/api/inventory'),env)).json();assert.equal(result.items[0].name,'Impressora XM7-40');assert.equal(result.items[0].manufacturer,'Bixolon');assert.doesNotMatch(result.items[0].name,/Bixolon|Novo/);
});
test('Accessory-only order goes straight to dispatch; insufficient stock rolls back the whole dispatch and retry cannot debit twice',async()=>{
 const env=environment(),battery=await item(env,'Bateria',3),cable=await item(env,'Cabo',1),o=await order(env);
 let r=await move(env,o.id,{action:'stock_intake',module:'stock',revision:1,available:true,orderRef:'EST-1',warrantyMonths:0,saleAt:'2026-10-15'});assert.equal(r.status,200);assert.equal((await r.json()).order.status,'dispatch_pending');
 assert.equal((await move(env,o.id,{action:'dispatch_prepare',module:'dispatch',revision:2})).status,200);
 const shipping={action:'dispatch_save',module:'dispatch',revision:3,documentType:'declaration',invoiceNumber:'',carrier:'Interna',carrierName:'',volumeCount:1,serialChecked:true,equipmentSerials:[],serialNotes:'',stockLines:[{itemId:battery,quantity:2},{itemId:cable,quantity:2}]};
 assert.equal((await move(env,o.id,{...shipping,stockLines:[]})).status,400);assert.equal((await move(env,o.id,shipping)).status,200);
 const dispatch={action:'dispatch',module:'dispatch',revision:4,approved:true,dispatchAt:'2026-10-15'};
 const failed=await move(env,o.id,dispatch);assert.equal(failed.status,409,await failed.clone().text());
 assert.equal(env.sqlite.prepare('SELECT balance FROM inventory_items WHERE id=?').get(battery).balance,3);assert.equal(env.sqlite.prepare('SELECT status FROM client_orders WHERE id=?').get(o.id).status,'dispatch_preparing');assert.equal(env.sqlite.prepare("SELECT count(*) n FROM inventory_movements WHERE kind='dispatch'").get().n,0);
 await post(env,'/api/inventory/entries',{id:crypto.randomUUID(),itemId:cable,quantity:2,date:'2026-10-15',reference:'NF nova'});
 const results=await Promise.all([move(env,o.id,dispatch),move(env,o.id,dispatch)]);assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
 assert.equal(env.sqlite.prepare('SELECT balance FROM inventory_items WHERE id=?').get(battery).balance,1);assert.equal(env.sqlite.prepare('SELECT balance FROM inventory_items WHERE id=?').get(cable).balance,1);
 const read=await (await worker.fetch(request('/api/inventory/movements?q=EST-1'),env)).json();assert.equal(read.movements.length,2);const m=read.movements[0];assert.equal(m.note,'');assert.deepEqual(m.context,{client:'Cliente Estoque',model:'Venda',number:'EST-1',project:'Projeto estoque',contact:'',consultant:'Consultor'});
 assert.equal((await move(env,o.id,dispatch)).status,409);
 const edited=await post(env,'/api/client-orders?client=Cliente%20Estoque&state=MG',{...o.p,revision:5,notes:'Alterado'});assert.equal(edited.status,409);
});
