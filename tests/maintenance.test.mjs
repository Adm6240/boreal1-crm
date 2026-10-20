import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import fs from 'node:fs';
import worker from '../server/index.mjs';
import {environment,request} from './helpers.mjs';
import {addMonths,calendarDate,warrantyState,validateSerials} from '../server/maintenance.mjs';
const origin={recipient:'Cliente Teste',postalCode:'30100000',street:'Rua A',number:'12',complement:'',district:'Centro',city:'Belo Horizonte',state:'MG'};
const input=()=>({requestKey:crypto.randomUUID(),serial:'XM-100',enteredAt:'2027-10-14',client:'Cliente Teste',model:'XM7-40',contact:'Maria',phone:'3130000000',email:'',defect:'Não imprime',physical:'Sem avaria externa',accessories:'1 bateria; 1 capa',origin,inboundTracking:'Entrega em mãos'});
const post=(env,path,b)=>worker.fetch(request(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)}),env);
function equipment(env,extra={}){env.sqlite.prepare('INSERT INTO service_equipment (id,serial_key,serial,payload,created_at) VALUES (?,?,?,?,?)').run(crypto.randomUUID(),'XM-100','XM-100',JSON.stringify({saleAt:'2026-10-14',warrantyMonths:36,model:'XM7-40',client:'Cliente Teste',...extra}),'2026-10-14');}
async function create(env,b=input()){const r=await post(env,'/api/maintenance',b);assert.equal(r.status,200,await r.clone().text());return (await r.json()).order;}
async function move(env,o,action,extra={}){const r=await post(env,'/api/maintenance/'+o.id,{revision:o.revision,action,...extra});assert.equal(r.status,200,await r.clone().text());return (await r.json()).order;}
test('Warranty calendar handles sale example, inclusive expiry, leap years and three calendar months',()=>{
 assert.equal(addMonths('2026-10-14',36),'2029-10-14');assert.equal(addMonths('2028-02-29',12),'2029-02-28');assert.equal(addMonths('2026-01-31',3),'2026-04-30');assert.throws(()=>calendarDate('2026-02-30'));assert.throws(()=>calendarDate('2026-99-99'));
 assert.equal(warrantyState({saleAt:'2026-10-14',warrantyMonths:36},[],'2027-10-14').saleActive,true);
 assert.equal(warrantyState({saleAt:'2026-10-14',warrantyMonths:36},[],'2029-10-14').saleActive,true);
 assert.equal(warrantyState({saleAt:'2026-10-14',warrantyMonths:36},[],'2029-10-15').saleActive,false);
 assert.equal(warrantyState({saleAt:'2026-10-14',warrantyMonths:0},[],'2026-10-14').classification,'budget');
});
test('Shipping serials enforce exact quantities and normalized uniqueness',()=>{const items=[{kind:'equipment',quantity:2,description:'XM7-40'}];assert.throws(()=>validateSerials([{itemIndex:0,serial:'X'}],items));assert.throws(()=>validateSerials([{itemIndex:0,serial:' X'},{itemIndex:0,serial:'x'}],items));assert.equal(validateSerials([{itemIndex:0,serial:'X'},{itemIndex:0,serial:'Y'}],items).length,2);});
test('Reception is idempotent, blocks another active OS and preserves addresses/accessories through warranty repair',async()=>{
 const env=environment();equipment(env);const b=input();let o=await create(env,b);assert.equal(o.payload.classification,'sale_warranty');assert.equal((await create(env,b)).id,o.id);assert.equal((await post(env,'/api/maintenance',input())).status,409);
 assert.equal((await post(env,'/api/maintenance/'+o.id,{revision:o.revision,action:'start'})).status,400);
 o=await move(env,o,'release');const stale=o;o=await move(env,o,'start');assert.equal((await post(env,'/api/maintenance/'+o.id,{revision:stale.revision,action:'diagnose'})).status,409);
 o=await move(env,o,'diagnose',{diagnosis:'Cabeça de impressão',service:'Trocar cabeça'});assert.equal(o.status,'analysis');o=await move(env,o,'queue',{priority:'normal',priorityReason:'Ordem de chegada'});o=await move(env,o,'begin_repair');
 o=await move(env,o,'finish',{service:'Cabeça substituída',tests:'Impressão e comunicação aprovadas',passed:true,finishedAt:'2027-10-15'});assert.equal(o.payload.repairWarranty,undefined);
 const send={destination:{...origin,number:'44'},outboundTracking:'BR123',carrier:'Correios',sentAt:'2027-10-16',returnedAccessories:'1 bateria; 1 capa',confirmAddress:true,confirmAccessories:true};
 assert.equal((await post(env,'/api/maintenance/'+o.id,{revision:o.revision,action:'send',...send})).status,400);
 o=await move(env,o,'send',{...send,reason:'Maria autorizou por e-mail'});assert.equal(o.payload.origin.number,'12');assert.equal(o.payload.destination.number,'44');assert.equal(o.payload.inboundTracking,'Entrega em mãos');assert.equal(o.payload.outboundTracking,'BR123');assert.equal(o.status,'sent');
 const next=await create(env,input());assert.notEqual(next.id,o.id);const r=await worker.fetch(request('/api/maintenance/lookup?serial=xm-100&on=2027-10-17'),env);assert.equal((await r.json()).history.length,2);
});
test('Expired sale requires approval and creates three-month repair warranty; related return links original OS',async()=>{
 const env=environment();equipment(env,{warrantyMonths:1});let o=await create(env);assert.equal(o.payload.classification,'budget');o=await move(env,o,'release');o=await move(env,o,'start');o=await move(env,o,'diagnose',{diagnosis:'Rolamento gasto',service:'Troca do rolamento',budgetAmount:230.50});assert.equal(o.status,'waiting_approval');
 assert.equal((await post(env,'/api/maintenance/'+o.id,{revision:o.revision,action:'finish',service:'Feito',tests:'Ok',passed:true,finishedAt:'2027-10-15'})).status,400);
 o=await move(env,o,'approve',{approver:'Maria',evidence:'E-mail de 14/10/2027'});o=await move(env,o,'waiting_piece',{reason:'Rolamento'});o=await move(env,o,'resume');o=await move(env,o,'queue',{priority:'high',priorityReason:'Cliente com operação parada'});o=await move(env,o,'begin_repair');o=await move(env,o,'finish',{service:'Rolamento substituído',tests:'Teste impressão',passed:true,finishedAt:'2027-10-15'});assert.deepEqual(o.payload.repairWarranty,{start:'2027-10-15',end:'2028-01-15'});
 o=await move(env,o,'send',{destination:origin,carrier:'Correios',outboundTracking:'BR567',sentAt:'2027-10-16',returnedAccessories:'1 bateria; 1 capa',confirmAddress:true,confirmAccessories:true});
 let next=await create(env,{...input(),enteredAt:'2027-11-01'});assert.equal(next.payload.classification,'repair_review');next=await move(env,next,'release');next=await move(env,next,'start');next=await move(env,next,'diagnose',{diagnosis:'Rolamento com falha',service:'Revisar rolamento',related:true,sourceOs:o.id,reason:'Mesmo componente do reparo anterior'});assert.equal(next.payload.classification,'repair_warranty');assert.equal(next.payload.sourceOs,o.id);
});
test('Unknown serial remains pending until documentation is checked; sector permissions are enforced',async()=>{
 const env=environment();let o=await create(env);assert.equal(o.payload.classification,'pending');assert.equal((await post(env,'/api/maintenance/'+o.id,{revision:o.revision,action:'release'})).status,400);
 o=await move(env,o,'verify',{classification:'sale_warranty',saleAt:'2026-10-14',warrantyMonths:36,reason:'NF 123 verificada'});o=await move(env,o,'release');
 env.sqlite.prepare("UPDATE app_users SET role='maintenance' WHERE role='admin'").run();assert.equal((await post(env,'/api/maintenance',{...input(),serial:'OTHER'})).status,403);assert.equal((await post(env,'/api/maintenance/'+o.id,{revision:o.revision,action:'send'})).status,403);
});
test('Reception UI displays existing history, prefills customer and submits origin without errors',async()=>{
 const env=environment();equipment(env);const dom=new JSDOM('<section id="maintenance"></section><section id="dispatch"></section>',{url:'https://boreal.test/',runScripts:'outside-only'}),w=dom.window;
 w.BorealAuth={user:{role:'admin'}};w.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','')};w.HTMLDialogElement.prototype.close=function(){this.removeAttribute('open')};w.fetch=async(path,opts={})=>worker.fetch(request(path,opts),env);
 w.eval(fs.readFileSync('public/assets/maintenance.js','utf8'));w.document.querySelector('[data-service-new]').click();const f=w.document.getElementById('serviceForm');f.elements.serial.value='XM-100';f.elements.enteredAt.value='2027-10-14';w.document.getElementById('serviceLookup').click();for(let i=0;i<50&&!f.elements.client.value;i++)await new Promise(r=>setTimeout(r,5));assert.equal(f.elements.client.value,'Cliente Teste');assert.match(w.document.getElementById('serviceLookupResult').textContent,/vigente/);
 for(const [k,v]of Object.entries({contact:'Maria',phone:'3130000000',defect:'Não imprime',physical:'Sem avaria',accessories:'1 bateria',inboundTracking:'Entrega em mãos'}))f.elements[k].value=v;
 for(const [k,v]of Object.entries(origin))f.elements['origin_'+k].value=v;
 f.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
 for(let i=0;i<80&&!w.document.getElementById('serviceTitle').textContent.startsWith('OS-');i++)await new Promise(r=>setTimeout(r,5));
 assert.equal(w.document.getElementById('serviceTitle').textContent,'OS-000001');assert.equal(w.document.getElementById('serviceError').textContent,'');assert.equal(env.sqlite.prepare('SELECT COUNT(*) AS n FROM service_orders').get().n,1);dom.window.close();
});

test('Technical queue requires priority, keeps both budget and part pending, and enforces authorization before starting',async()=>{
 const env=environment();equipment(env,{warrantyMonths:1});let o=await create(env);o=await move(env,o,'release');o=await move(env,o,'start');o=await move(env,o,'diagnose',{diagnosis:'Placa avariada',service:'Troca da placa',budgetAmount:500,piecePending:'Placa controladora'});assert.equal(o.status,'waiting_approval');assert.equal(o.payload.piecePending,'Placa controladora');
 for(const action of ['queue','begin_repair','finish'])assert.equal((await post(env,'/api/maintenance/'+o.id,{revision:o.revision,action,priority:'urgent',priorityReason:'Operação parada'})).status,400);
 o=await move(env,o,'approve',{approver:'Maria',evidence:'E-mail confirmado'});assert.equal(o.status,'waiting_piece');assert.equal((await post(env,'/api/maintenance/'+o.id,{revision:o.revision,action:'queue',priority:'normal',priorityReason:'Ordem'})).status,400);
 o=await move(env,o,'resume');assert.equal(o.status,'analysis');assert.equal(o.payload.piecePending,'');for(const extra of [{},{priority:'other',priorityReason:'Teste'},{priority:'urgent',priorityReason:''}])assert.equal((await post(env,'/api/maintenance/'+o.id,{revision:o.revision,action:'queue',...extra})).status,400);
 env.sqlite.prepare("UPDATE app_users SET role='dispatch' WHERE role='admin'").run();assert.equal((await post(env,'/api/maintenance/'+o.id,{revision:o.revision,action:'queue',priority:'normal',priorityReason:'Ordem'})).status,403);env.sqlite.prepare("UPDATE app_users SET role='maintenance' WHERE role='dispatch'").run();
 o=await move(env,o,'queue',{priority:'urgent',priorityReason:'Cliente sem equipamento reserva'});assert.equal(o.status,'repair_queue');assert.equal(o.payload.priority.by,'Administrador Exemplo');assert.ok(o.payload.priority.at);const first=o.payload.priority;
 o=await move(env,o,'queue',{priority:'high',priorityReason:'Equipamento reserva entregue'});assert.deepEqual(o.payload.events.filter(e=>e.action==='queue').map(e=>e.priority.level),['urgent','high']);assert.equal(first.reason,'Cliente sem equipamento reserva');
 o=await move(env,o,'begin_repair');assert.equal(o.status,'repair');assert.ok(o.payload.repairStartedAt);o=await move(env,o,'finish',{service:'Placa trocada',tests:'Teste de impressão aprovado',passed:true,finishedAt:'2027-10-15'});assert.equal(o.status,'finished');
});
test('Part arrival before budget approval does not release repair or clear the authorization pending',async()=>{
 const env=environment();equipment(env,{warrantyMonths:1});let o=await create(env);o=await move(env,o,'release');o=await move(env,o,'start');o=await move(env,o,'diagnose',{diagnosis:'Cabeça queimada',service:'Troca de cabeça',budgetAmount:900});o=await move(env,o,'waiting_piece',{reason:'Cabeça'});assert.equal(o.status,'waiting_approval');o=await move(env,o,'resume');assert.equal(o.status,'waiting_approval');assert.equal(o.payload.piecePending,'');assert.equal((await post(env,'/api/maintenance/'+o.id,{revision:o.revision,action:'begin_repair'})).status,400);
});
test('Technical list orders repair queue by priority then oldest entry and opens the priority classifier',async()=>{
 const env=environment();equipment(env);let o=await create(env);o=await move(env,o,'release');o=await move(env,o,'start');o=await move(env,o,'diagnose',{diagnosis:'Falha',service:'Ajuste'});o=await move(env,o,'queue',{priority:'normal',priorityReason:'Sequência de entrada'});
 const row=env.sqlite.prepare('SELECT * FROM service_orders WHERE id=?').get(o.id);const insert=(serial,level,date)=>{const p=JSON.parse(row.payload);p.serial=serial;p.enteredAt=date;p.priority.level=level;env.sqlite.prepare('INSERT INTO service_orders (request_key,serial_key,status,active_key,payload,revision,created_at,updated_at) VALUES (?,?,?,?,?,1,?,?)').run(crypto.randomUUID(),serial,'repair_queue',serial,JSON.stringify(p),date,date);};insert('URGENT-LATER','urgent','2027-10-14');insert('URGENT-OLDER','urgent','2027-10-12');
 const dom=new JSDOM('<section id="maintenance"></section><section id="dispatch"></section>',{url:'https://boreal.test/',runScripts:'outside-only'}),w=dom.window,d=w.document;try{w.BorealAuth={user:{role:'maintenance'}};w.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','')};w.HTMLDialogElement.prototype.close=function(){this.removeAttribute('open')};w.fetch=async(path,opts={})=>worker.fetch(request(path,opts),env);w.eval(fs.readFileSync('public/assets/maintenance.js','utf8'));d.querySelector('[data-service-refresh]').click();for(let i=0;i<80&&!d.querySelector('[data-service-open]');i++)await new Promise(r=>setTimeout(r,5));const buttons=[...d.querySelector('#maintenance tbody').querySelectorAll('[data-service-open]')];assert.deepEqual(buttons.map(b=>Number(b.dataset.serviceOpen)),[3,2,1]);buttons[0].click();const f=d.getElementById('serviceForm');f.elements.action.value='queue';f.elements.action.dispatchEvent(new w.Event('change'));assert.equal(f.elements.priority.required,true);assert.equal(f.elements.priorityReason.required,true);assert.equal(f.elements.priority.options.length,5);assert.match(d.getElementById('serviceSummary').textContent,/Sequência de entrada/);const filter=d.querySelector('[data-service-priority]');filter.value='normal';filter.dispatchEvent(new w.Event('input'));assert.equal(d.querySelectorAll('#maintenance tbody [data-service-open]').length,1);}finally{w.close();}
});
