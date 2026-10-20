import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../server/index.mjs';
import {environment,request} from './helpers.mjs';

const path='/api/client-orders?client=Cliente%20de%20teste&state=MG';
function payload(){return {id:crypto.randomUUID(),revision:0,snapshot:{project:'Projeto de teste',consultant:'Consultora de teste',contact:'Contato de teste',email:'test@example.test',phone:'3130000000',value:12000,software:null},movement:'Venda',orderValue:11950.75,delivery:{recipient:'Cliente de teste',postalCode:'30100-000',street:'Rua de teste',number:'S/N',complement:'Sala 2',district:'Centro',city:'Belo Horizonte',state:'MG'},items:[{kind:'equipment',brand:'Marca de teste',description:'Modelo A',quantity:2},{kind:'accessory',brand:'',description:'Cabo',quantity:4}],notes:'Aguardar configuração do fluxo.'};}
const save=(env,body,url=path)=>worker.fetch(request(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),env);
test('Orders persist with delivery/items, retry safely, allow independent orders on the same project and isolate clients',async()=>{
  const env=environment(),body=payload();const response=await save(env,body);assert.equal(response.status,201,await response.clone().text());
  const {order}=await response.json();assert.equal(order.status,'awaiting_setup');assert.equal(order.snapshot.software,null);assert.equal(order.snapshot.client,'Cliente de teste');assert.equal(order.movement,'Venda');assert.equal(order.orderValue,11950.75);assert.equal(order.delivery.postalCode,'30100000');assert.equal(order.items[1].quantity,4);
  assert.equal(env.sqlite.prepare('SELECT stage FROM project_stages').get().stage,'Aprovado');
  const stages=await (await worker.fetch(request('/api/project-stages?client=Cliente%20de%20teste&state=MG'),env)).json();assert.equal(stages.stages[0].value,11950.75);
  assert.equal((await save(env,body)).status,200);
  const list=await (await worker.fetch(request(path),env)).json();assert.equal(list.orders.length,1);assert.equal(list.orders[0].id,order.id);assert.equal(list.orders[0].delivery.complement,'Sala 2');
  const duplicate={...body,id:crypto.randomUUID(),snapshot:{...body.snapshot,project:'  PROJETO   DE TESTE  '}};assert.equal((await save(env,duplicate)).status,201);assert.equal(env.sqlite.prepare('SELECT COUNT(*) AS n FROM client_orders').get().n,2);assert.equal((await save(env,duplicate)).status,200);const totals=await (await worker.fetch(request('/api/project-stages?client=Cliente%20de%20teste&state=MG'),env)).json();assert.equal(totals.stages[0].value,23901.50);
  const other=await (await worker.fetch(request('/api/client-orders?client=Outro&state=MG'),env)).json();assert.deepEqual(other.orders,[]);
  assert.equal(env.sqlite.prepare('SELECT author_id FROM client_orders').get().author_id,'11111111-1111-4111-8111-111111111111');
});
test('Updating a saved order retains its identity and rejects stale overwrites',async()=>{
  const env=environment(),body=payload();await save(env,body);const edited={...body,revision:1,movement:'Locação simples (CL100)',orderValue:12500,notes:'Entrega pela manhã.'};
  const changed=await save(env,edited);assert.equal(changed.status,200);const {order}=await changed.json();assert.equal(order.revision,2);assert.equal(order.id,body.id);
  assert.equal((await save(env,edited)).status,200); // Retry after a lost response.
  assert.equal((await save(env,{...edited,notes:'Outra sessão tentou sobrescrever.'})).status,409);
  const current=await (await worker.fetch(request(path),env)).json();assert.equal(current.orders[0].notes,'Entrega pela manhã.');assert.equal(current.orders[0].movement,'Locação simples (CL100)');assert.equal(current.orders[0].orderValue,12500);assert.equal(current.orders[0].revision,2);
});
test('Coverage counts dispatched equipment by delivery city once, including completed orders',async()=>{
  const env=environment(),body={...payload(),items:[{kind:'equipment',brand:'Bixolon',description:'XM7-40',quantity:150},{kind:'accessory',brand:'',description:'Cabo',quantity:10}]};
  await save(env,body);
  const coverage=async()=>(await (await worker.fetch(request('/api/coverage'),env)).json()).entries;
  assert.deepEqual(await coverage(),[]);
  assert.equal((await worker.fetch(new Request('https://boreal.test/api/coverage'),env)).status,401);
  env.sqlite.prepare("UPDATE client_orders SET status = 'dispatched' WHERE id = ?").run(body.id);
  assert.deepEqual(await coverage(),[{state:'MG',city:'Belo Horizonte',brand:'Bixolon',category:'Impressora móvel',quantity:150}]);
  env.sqlite.prepare("UPDATE client_orders SET status = 'completed' WHERE id = ?").run(body.id);
  assert.equal((await coverage())[0].quantity,150);
  const second={...payload(),id:crypto.randomUUID(),snapshot:{...body.snapshot,project:'Outro projeto'},delivery:{...body.delivery,city:'Uberlândia'},items:[{kind:'equipment',brand:'Zebra',description:'TC-22',category:'Coletor de dados',quantity:7}]};
  await save(env,second);env.sqlite.prepare("UPDATE client_orders SET status = 'dispatched' WHERE id = ?").run(second.id);
  assert.deepEqual(await coverage(),[{state:'MG',city:'Belo Horizonte',brand:'Bixolon',category:'Impressora móvel',quantity:150},{state:'MG',city:'Uberlândia',brand:'Zebra',category:'Coletor de dados',quantity:7}]);
});
test('Order validation rejects invalid quantities, missing delivery, forged status and unauthorized requests',async()=>{
  const env=environment(),body=payload();
  assert.equal((await worker.fetch(new Request('https://boreal.test'+path),env)).status,401);
  const foreign=request(path,{method:'POST',headers:{'Content-Type':'application/json',origin:'https://untrusted.invalid'},body:JSON.stringify(body)});assert.equal((await worker.fetch(foreign,env)).status,403);
  for(const quantity of [0,-1,1.5,100001,'2'])assert.equal((await save(env,{...body,items:[{...body.items[0],quantity}]})).status,400);
  assert.equal((await save(env,{...body,delivery:{...body.delivery,street:''}})).status,400);
  assert.equal((await save(env,{...body,delivery:{...body.delivery,postalCode:'123'}})).status,400);
  assert.equal((await save(env,{...body,items:[]})).status,400);
  for(const movement of ['', 'Troca', 'CL300'])assert.equal((await save(env,{...body,movement})).status,400);
  for(const orderValue of [null,'12000',-1,1.234,1e13])assert.equal((await save(env,{...body,orderValue})).status,400);
  assert.equal(env.sqlite.prepare('SELECT COUNT(*) AS n FROM history_clients').get().n,0);
  const forged=await save(env,{...body,status:'sent_to_departments',authorId:'forged'});assert.equal((await forged.json()).order.status,'awaiting_setup');
  assert.equal((await worker.fetch(request(path,{method:'POST',headers:{'Content-Type':'application/json'},body:' '.repeat(70000)}),env)).status,413);
});
test('All movement types are accepted and free movements may have a zero order value',async()=>{
  for(const movement of ['Venda','Locação simples (CL100)','Locação com compras (CL200)','Empréstimo','Doação','Substituição']){
    const env=environment(),body={...payload(),movement,orderValue:0};
    const response=await save(env,body);assert.equal(response.status,201,await response.clone().text());
    const {order}=await response.json();assert.equal(order.movement,movement);assert.equal(order.orderValue,0);
  }
});
test('Goal actuals include generated paid orders once, grouped by consultant and Brazil month',async()=>{
  const env=environment(),url='/api/goals/actuals?year=2026';
  assert.equal((await worker.fetch(new Request('https://boreal.test'+url),env)).status,401);
  assert.equal((await worker.fetch(request('/api/goals/actuals?year=xyz'),env)).status,400);
  const original={...payload(),orderValue:100000,snapshot:{...payload().snapshot,consultant:'Consultor Exemplo'}};
  assert.equal((await save(env,original)).status,201);assert.equal((await save(env,original)).status,200);
  const read=async()=>((await worker.fetch(request(url),env)).json());
  assert.equal((await read()).orderCount,1);
  const edited={...original,revision:1,orderValue:120000};assert.equal((await save(env,edited)).status,200);
  const second={...payload(),id:crypto.randomUUID(),movement:'Locação simples (CL100)',orderValue:50000.25,snapshot:{...payload().snapshot,project:'Outro projeto',consultant:'Danielle'}};
  assert.equal((await save(env,second)).status,201);
  const third={...payload(),id:crypto.randomUUID(),movement:'Locação com compras (CL200)',orderValue:25000,snapshot:{...payload().snapshot,project:'Mais um projeto',consultant:'Danielle'}};
  assert.equal((await save(env,third)).status,201);
  for(const movement of ['Empréstimo','Doação','Substituição']){
    const excluded={...payload(),id:crypto.randomUUID(),movement,orderValue:999999,snapshot:{...payload().snapshot,project:'Projeto '+movement,consultant:'Consultor Exemplo'}};
    assert.equal((await save(env,excluded)).status,201);
  }
  const result=await read();assert.equal(result.orderCount,3);
  const month=Number(new Intl.DateTimeFormat('en-US',{timeZone:'America/Sao_Paulo',month:'2-digit'}).format(new Date()))-1;
  assert.equal(result.monthly['Consultor Exemplo'][month],120000);
  assert.equal(result.monthly.Danielle[month],75000.25);
  assert.equal(result.monthly['Consultor Exemplo'].reduce((a,b)=>a+b,0),120000);
  env.sqlite.prepare('UPDATE client_orders SET created_at = ? WHERE id = ?').run('2026-10-01T01:00:00.000Z',original.id);
  const boundary=await read();assert.equal(boundary.monthly['Consultor Exemplo'][8],120000);
  assert.equal((await (await worker.fetch(request('/api/goals/actuals?year=2025'),env)).json()).orderCount,0);
});
test('A generated order moves across Stock, Maintenance and Dispatch with one shared history',async()=>{
  const env=environment(),body=payload();await save(env,body);
  const url=`/api/orders/workflow/${body.id}`;
  const move=(data)=>worker.fetch(request(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}),env);
  const initial=await (await worker.fetch(request('/api/orders/workflow'),env)).json();
  assert.equal(initial.orders.length,1);assert.equal(initial.orders[0].status,'awaiting_setup');
  assert.equal((await move({module:'stock',action:'maintenance_finish',revision:1,configurationNotes:'Teste'})).status,403);
  assert.equal((await move({module:'stock',action:'stock_intake',revision:1,orderRef:'PED 100/2026',available:false,warrantyMonths:36,saleAt:'2026-09-24'})).status,200);
  let current=await (await worker.fetch(request('/api/orders/workflow'),env)).json();assert.equal(current.orders[0].status,'awaiting_goods');assert.equal(current.orders[0].number,'PED 100/2026');
  const second={...payload(),id:crypto.randomUUID(),snapshot:{...payload().snapshot,project:'Outro projeto'}};await save(env,second);
  const duplicate=await move({module:'stock',action:'stock_arrived',revision:1});assert.equal(duplicate.status,409);
  assert.equal((await worker.fetch(request(`/api/orders/workflow/${second.id}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({module:'stock',action:'stock_intake',revision:1,orderRef:'PED 100/2026',available:true})}),env)).status,409);
  const arrived=await move({module:'stock',action:'stock_arrived',revision:2});assert.equal(arrived.status,200);
  assert.equal((await move({module:'dispatch',action:'dispatch',revision:3,approved:true,dispatchAt:'2026-09-25'})).status,409);
  assert.equal((await move({module:'maintenance',action:'maintenance_finish',revision:3,configurationNotes:'Teste'})).status,409);
  for(const technicians of [[],['Nome não cadastrado'],['Daniel','Daniel']])assert.equal((await move({module:'maintenance',action:'maintenance_start',revision:3,technicians})).status,400);
  const started=await move({module:'maintenance',action:'maintenance_start',revision:3,technicians:['Daniel','Vitor']});assert.equal(started.status,200);
  const startedOrder=(await started.json()).order;assert.equal(startedOrder.status,'maintenance_in_progress');assert.deepEqual(startedOrder.workflow.technicians,['Daniel','Vitor']);
  assert.equal((await move({module:'maintenance',action:'maintenance_finish',revision:4,configurationNotes:''})).status,400);
  assert.equal((await move({module:'maintenance',action:'maintenance_finish',revision:4,configurationNotes:'Software instalado e teste realizado'})).status,200);
  const forDispatch=await (await worker.fetch(request('/api/orders/workflow'),env)).json();assert.deepEqual(forDispatch.orders.find(order=>order.id===body.id).workflow.technicians,['Daniel','Vitor']);
  assert.equal((await move({module:'dispatch',action:'dispatch',revision:5,approved:true,dispatchAt:'2026-09-25'})).status,409);
  assert.equal((await move({module:'dispatch',action:'dispatch_prepare',revision:5})).status,200);
  env.sqlite.prepare("INSERT INTO inventory_items (id,sku,name,kind,balance,minimum,created_at) VALUES ('fixture-stock','FIXTURE','XM7-40','equipment',0,0,'2026-01-01')").run();
  env.sqlite.prepare("INSERT INTO inventory_movements VALUES ('initial','fixture-stock',10,'2026-01-01','entry',NULL,'{}','',1,'fixture','2026-01-01')").run();
  const serialRows=[{itemIndex:0,unitIndex:0,equipment:'S100',seal:'L100',battery:'B100',charger:'F100'},{itemIndex:0,unitIndex:1,equipment:'S101',seal:'L101',battery:'B101',charger:'F101'}];
  const base={stockLines:[{itemId:'fixture-stock',quantity:2}],module:'dispatch',action:'dispatch_save',revision:6,documentType:'invoice',invoiceNumber:'NF-1234',carrier:'Transportadora',carrierName:'Transportes MG',volumeCount:3,serialChecked:false,equipmentSerials:[{itemIndex:0,serial:'S100'},{itemIndex:0,serial:'S101'}],serialRows,serialNotes:'Série conferida no lote A'};
  for(const bad of [{documentType:'outro'},{invoiceNumber:''},{carrier:'Táxi'},{carrierName:''},{volumeCount:0},{serialChecked:null},{serialRows:serialRows.map((row,index)=>index?row:{...row,charger:''})}]){
    assert.equal((await move({...base,...bad})).status,400);
  }
  assert.equal((await move(base)).status,200);
  assert.equal((await move({module:'dispatch',action:'dispatch',revision:7,approved:true,dispatchAt:'2026-09-25'})).status,400);
  const prepared=await move({...base,revision:7,serialChecked:true});assert.equal(prepared.status,200);
  const shipping=(await prepared.json()).order.workflow.shipping;assert.equal(shipping.invoiceNumber,'NF-1234');assert.equal(shipping.carrierName,'Transportes MG');assert.equal(shipping.volumeCount,3);assert.equal(shipping.serialChecked,true);assert.deepEqual(shipping.serialRows,serialRows);
  const declaration=await move({...base,revision:8,documentType:'declaration',invoiceNumber:'',carrier:'Latam',carrierName:'',serialChecked:true});assert.equal(declaration.status,200);
  const changedShipping=(await declaration.json()).order.workflow.shipping;assert.equal(changedShipping.invoiceNumber,null);assert.equal(changedShipping.carrier,'Latam');
  assert.equal((await move({module:'dispatch',action:'dispatch',revision:9,approved:true,dispatchAt:'2026-09-25'})).status,200);
  assert.equal((await move({module:'stock',action:'stock_complete',revision:10,receivedAt:'2026-09-24'})).status,400);
  const completed=await move({module:'stock',action:'stock_complete',revision:10,receivedAt:'2026-09-28'});assert.equal(completed.status,200);
  current=await completed.json();assert.equal(current.order.status,'completed');assert.equal(current.order.workflow.receivedAt,'2026-09-28');
  assert.equal(env.sqlite.prepare('SELECT stage FROM project_stages WHERE project_name=?').get('Projeto de teste').stage,'Concluído');
  assert.equal(current.order.workflow.events.length,10);assert.equal(current.order.workflow.events[2].status,'maintenance_in_progress');assert.equal(current.order.workflow.events[3].status,'dispatch_pending');assert.equal(current.order.workflow.events[4].status,'dispatch_preparing');
  assert.equal((await move({module:'stock',action:'stock_complete',revision:10,receivedAt:'2026-09-28'})).status,409);
  const history=await (await worker.fetch(request(path),env)).json();assert.equal(history.orders.find(order=>order.id===body.id).status,'completed');assert.equal(history.orders.find(order=>order.id===body.id).number,'PED 100/2026');
});
test('Project phase can be moved manually and remains available to every session',async()=>{
  const env=environment(),url='/api/project-stages?client=Cliente%20de%20teste&state=MG';
  const changed=await worker.fetch(request(url,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({project:'Projeto 10 DT-40',stage:'Proposta'})}),env);
  assert.equal(changed.status,200,await changed.clone().text());assert.equal((await changed.json()).project.stage,'Proposta');
  const read=await (await worker.fetch(request(url),env)).json();assert.deepEqual(read.stages.map(item=>[item.project,item.stage]),[['Projeto 10 DT-40','Proposta']]);
  assert.equal((await worker.fetch(request(url,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({project:'Projeto 10 DT-40',stage:'Inválido'})}),env)).status,400);
});

test('Multiple purchases sum project value and a completed delivery does not close pending purchases',async()=>{
 const env=environment(),a=payload(),b={...payload(),snapshot:{...a.snapshot},orderValue:500};await save(env,a);await save(env,b);env.sqlite.prepare("UPDATE client_orders SET status='completed' WHERE id=?").run(a.id);
 const read=async()=> (await (await worker.fetch(request('/api/project-stages?client=Cliente%20de%20teste&state=MG'),env)).json()).stages[0];let p=await read();assert.equal(p.stage,'Aprovado');assert.equal(p.value,12450.75);env.sqlite.prepare("UPDATE client_orders SET status='completed' WHERE id=?").run(b.id);assert.equal((await read()).stage,'Concluído');const c={...payload(),snapshot:{...a.snapshot},orderValue:300};await save(env,c);p=await read();assert.equal(p.stage,'Aprovado');assert.equal(p.value,12750.75);
});
