import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../server/index.mjs';
import {environment,request} from './helpers.mjs';

const reset=(env,confirmation='ZERAR ESTOQUE')=>worker.fetch(request('/api/inventory/reset',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({confirmation})}),env);

test('administrador zera todo o estoque uma única vez sem afetar CRM ou usuários',async()=>{
 const env=environment(),db=env.sqlite,now='2026-10-20T11:00:00.000Z';
 db.prepare("INSERT INTO history_clients (id,legacy_key,name,state,route_token,created_at) VALUES ('client','cliente|MG','Cliente preservado','MG','route',?)").run(now);
 db.prepare("INSERT INTO inventory_items (id,sku,name,manufacturer,kind,balance,minimum,created_at) VALUES ('item','ITEM','Impressora','Bixolon','equipment',0,0,?)").run(now);
 db.prepare("INSERT INTO inventory_import_batches VALUES ('batch','fingerprint','estoque.xlsx','{}','applied',1,'fixture',?,?)").run(now,now);
 db.prepare("INSERT INTO inventory_import_drafts VALUES ('batch','identity','{}')").run();
 db.prepare("INSERT INTO inventory_import_items VALUES ('item','identity','batch','ready',0,0,'Conferido','{}',1)").run();
 db.prepare("INSERT INTO inventory_import_lines VALUES ('line','batch','item','record','accepted','2026-10-20','{}')").run();
 db.prepare("INSERT INTO inventory_movements VALUES ('movement','item',1,'2026-10-20','entry',NULL,'{}','',1,'fixture',?)").run(now);
 db.prepare("INSERT INTO inventory_movement_notes VALUES ('movement','Conferido',2,'fixture',?)").run(now);
 db.prepare("INSERT INTO inventory_kits VALUES ('kit','Kit teste','[{\"itemId\":\"item\",\"quantity\":1}]',?)").run(now);
 db.prepare("INSERT INTO inventory_serial_receipts VALUES ('receipt','seriais.xlsx','2026-10-20','entry','{}','fixture',?)").run(now);
 db.prepare("INSERT INTO inventory_serial_units (id,item_id,kind,serial,serial_key,receipt_id,payload,created_at) VALUES ('unit','item','equipment','SN-1','SN-1','receipt','{}',?)").run(now);
 db.prepare("INSERT INTO inventory_serial_events VALUES ('event','unit','entry',NULL,NULL,'{}','fixture',?)").run(now);
 db.prepare("INSERT INTO inventory_serial_shortages (id,equipment_id,kind,active_key,created_at) VALUES ('shortage','unit','battery','unit:battery',?)").run(now);
 db.prepare("INSERT INTO inventory_import_trash VALUES ('trash','old-batch','antigo.xlsx','{}','removed','fixture',?,NULL)").run(now);
 db.prepare("INSERT INTO inventory_import_trash_rows VALUES ('trash','inventory_items','old-item','{}')").run();

 const rejected=await reset(env,'confirmar');assert.equal(rejected.status,400);assert.equal(db.prepare('SELECT COUNT(*) n FROM inventory_items').get().n,1);
 const response=await reset(env);assert.equal(response.status,200,await response.clone().text());const result=await response.json();
 assert.deepEqual(result.removed,{items:1,kits:1,movements:1,serialUnits:1,removedImports:1});
 for(const table of ['inventory_serial_events','inventory_serial_shortages','inventory_serial_units','inventory_serial_receipts','inventory_movement_notes','inventory_import_trash_rows','inventory_import_trash','inventory_import_drafts','inventory_import_lines','inventory_import_items','inventory_import_batches','inventory_movements','inventory_kits','inventory_items'])assert.equal(db.prepare('SELECT COUNT(*) n FROM '+table).get().n,0,table);
 assert.equal(db.prepare('SELECT COUNT(*) n FROM history_clients').get().n,1);assert.equal(db.prepare('SELECT COUNT(*) n FROM app_users').get().n,1);
 assert.equal(db.prepare("SELECT COUNT(*) n FROM security_events WHERE action='inventory_reset_2026_10_20_completed'").get().n,1);
 const retry=await reset(env);assert.equal(retry.status,200);assert.equal((await retry.json()).alreadyReset,true);
});

test('perfil de estoque não pode executar a limpeza administrativa',async()=>{
 const env=environment();env.sqlite.prepare("UPDATE app_users SET role='stock'").run();
 const response=await reset(env);assert.equal(response.status,403);
});

test('administrador com troca de senha pendente pode executar somente a zeragem solicitada',async()=>{
 const env=environment();env.sqlite.prepare('UPDATE app_users SET must_change_password=1').run();
 const response=await reset(env);assert.equal(response.status,200,await response.clone().text());
 const blocked=await worker.fetch(request('/api/inventory'),env);assert.equal(blocked.status,403);
});
