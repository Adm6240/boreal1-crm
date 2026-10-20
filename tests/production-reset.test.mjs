import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import fs from 'node:fs';

function databaseBeforeReset(){
 const db=new DatabaseSync(':memory:');db.exec('PRAGMA foreign_keys=ON;');
 for(const file of fs.readdirSync('drizzle').filter(name=>name.endsWith('.sql')&&name<'0026_production_order_reset.sql').sort())db.exec(fs.readFileSync('drizzle/'+file,'utf8'));
 return db;
}

test('virada para produção remove pedidos beta e reverte seus efeitos',()=>{
 const db=databaseBeforeReset(),now='2026-10-19T12:00:00.000Z';
 db.prepare("INSERT INTO history_clients (id,legacy_key,name,state,route_token,created_at) VALUES ('client','cliente-real|MG','Cliente Real','MG','route-real',?)").run(now);
 db.prepare("INSERT INTO client_orders (id,client_id,project_key,payload,status,workflow,revision,author_id,updated_by,created_at,updated_at) VALUES ('order','client','projeto-beta','{}','dispatched','{}',1,'fixture','fixture',?,?)").run(now,now);
 for(const [id,kind] of [['eq','equipment'],['bat','accessory'],['chg','accessory']])db.prepare('INSERT INTO inventory_items (id,sku,name,manufacturer,kind,balance,minimum,created_at) VALUES (?,?,?,?,?,0,0,?)').run(id,id.toUpperCase(),id,'Fabricante',kind,now);
 for(const id of ['eq','bat','chg'])db.prepare("INSERT INTO inventory_movements (id,item_id,delta,date,kind,context,note,revision,author_id,created_at) VALUES (?,?,2,'2026-10-01','entry','{}','',1,'fixture',?)").run('entry-'+id,id,now);
 db.prepare("INSERT INTO inventory_serial_receipts VALUES ('receipt','seriais.xlsx','2026-10-01','entry','{}','fixture',?)").run(now);
 const unit=db.prepare("INSERT INTO inventory_serial_units (id,item_id,kind,serial,serial_key,parent_id,origin_id,receipt_id,payload,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)");
 const equipmentPayload=JSON.stringify({batteryItemId:'bat',chargerItemId:'chg'});unit.run('eq-1','eq','equipment','EQ-1','EQ-1',null,null,'receipt',equipmentPayload,now);unit.run('eq-2','eq','equipment','EQ-2','EQ-2',null,null,'receipt',equipmentPayload,now);
 unit.run('bat-1','bat','battery','BAT-1','BAT-1','eq-1','eq-1','receipt','{}',now);unit.run('bat-2','bat','battery','BAT-2','BAT-2','eq-2','eq-2','receipt','{}',now);
 unit.run('chg-1','chg','charger','CHG-1','CHG-1','eq-1','eq-1','receipt','{}',now);unit.run('chg-2','chg','charger','CHG-2','CHG-2','eq-2','eq-2','receipt','{}',now);
 const event=db.prepare("INSERT INTO inventory_serial_events (id,unit_id,action,order_id,payload,author_id,created_at) VALUES (?,?,?,?,?,'fixture',?)");
 event.run('event-eq','eq-1','dispatch','order',JSON.stringify({fromParent:null}),now);event.run('event-bat-1','bat-1','detach','order',JSON.stringify({fromParent:'eq-1'}),now);event.run('event-chg-1','chg-1','detach','order',JSON.stringify({fromParent:'eq-1'}),now);event.run('event-bat-2','bat-2','dispatch','order',JSON.stringify({fromParent:'eq-2'}),now);event.run('event-eq-2','eq-2','kit_split','order',JSON.stringify({fromParent:null}),now);
 db.prepare("UPDATE inventory_serial_units SET status='dispatched',parent_id=NULL,order_id='order' WHERE id IN ('eq-1','bat-2')").run();
 db.prepare("UPDATE inventory_serial_units SET parent_id=NULL WHERE id IN ('bat-1','chg-1')").run();
 db.prepare("INSERT INTO inventory_movements (id,item_id,delta,date,kind,order_id,context,note,revision,author_id,created_at) VALUES ('dispatch-eq','eq',-1,'2026-10-19','dispatch','order','{}','',1,'fixture',?)").run(now);
 db.prepare("INSERT INTO inventory_movements (id,item_id,delta,date,kind,order_id,context,note,revision,author_id,created_at) VALUES ('dispatch-bat','bat',-1,'2026-10-19','dispatch','order','{}','',1,'fixture',?)").run(now);
 db.prepare("INSERT INTO inventory_movement_notes VALUES ('dispatch-eq','teste',2,'fixture',?)").run(now);
 db.prepare("INSERT INTO inventory_serial_shortages (id,equipment_id,kind,active_key,removed_id,order_id,created_at) VALUES ('shortage','eq-2','battery','eq-2:battery','bat-2','order',?)").run(now);
 db.prepare("INSERT INTO service_equipment VALUES ('service-beta','EQ-1','EQ-1','order','client','{}',?)").run(now);db.prepare("INSERT INTO service_equipment VALUES ('service-real','OTHER','OTHER',NULL,'client','{}',?)").run(now);
 db.prepare("INSERT INTO service_orders (request_key,serial_key,status,active_key,payload,revision,created_at,updated_at) VALUES ('request-beta','EQ-1','received','EQ-1','{}',1,?,?)").run(now,now);db.prepare("INSERT INTO service_orders (request_key,serial_key,status,active_key,payload,revision,created_at,updated_at) VALUES ('request-real','OTHER','received','OTHER','{}',1,?,?)").run(now,now);
 db.prepare("INSERT INTO project_stages VALUES ('client','projeto-beta','Projeto beta','Aprovado','workflow',1,'fixture',?)").run(now);db.prepare("INSERT INTO project_stages VALUES ('client','projeto-real','Projeto real','Contato','manual',1,'fixture',?)").run(now);

 db.exec(fs.readFileSync('drizzle/0026_production_order_reset.sql','utf8'));

 assert.equal(db.prepare('SELECT COUNT(*) n FROM client_orders').get().n,0);
 assert.equal(db.prepare("SELECT COUNT(*) n FROM inventory_movements WHERE kind='dispatch'").get().n,0);
 assert.deepEqual(db.prepare('SELECT id,balance FROM inventory_items ORDER BY id').all().map(row=>({...row})),[{id:'bat',balance:2},{id:'chg',balance:2},{id:'eq',balance:2}]);
 assert.equal(db.prepare('SELECT COUNT(*) n FROM inventory_movement_notes').get().n,0);
 assert.equal(db.prepare("SELECT COUNT(*) n FROM inventory_serial_units WHERE status!='available' OR order_id IS NOT NULL").get().n,0);
 assert.deepEqual(db.prepare("SELECT id,parent_id FROM inventory_serial_units WHERE kind!='equipment' ORDER BY id").all().map(row=>({...row})),[{id:'bat-1',parent_id:'eq-1'},{id:'bat-2',parent_id:'eq-2'},{id:'chg-1',parent_id:'eq-1'},{id:'chg-2',parent_id:'eq-2'}]);
 assert.equal(db.prepare('SELECT COUNT(*) n FROM inventory_serial_events').get().n,0);assert.equal(db.prepare('SELECT COUNT(*) n FROM inventory_serial_shortages').get().n,0);
 assert.deepEqual(db.prepare('SELECT serial_key FROM service_equipment').all().map(row=>({...row})),[{serial_key:'OTHER'}]);assert.deepEqual(db.prepare('SELECT serial_key FROM service_orders').all().map(row=>({...row})),[{serial_key:'OTHER'}]);
 assert.deepEqual(db.prepare('SELECT project_key,source FROM project_stages').all().map(row=>({...row})),[{project_key:'projeto-real',source:'manual'}]);
});

test('interface identifica a versão de produção com pulso verde acessível',()=>{
 const html=fs.readFileSync('public/index.html','utf8'),css=fs.readFileSync('public/assets/sidebar-menu.css','utf8');
 assert.match(html,/aria-label="Versão 1\.00"/);assert.match(html,/>Versão 1\.00</);assert.match(html,/>v1\.00</);
 assert.match(css,/@keyframes version-live-pulse/);assert.match(css,/prefers-reduced-motion:reduce/);assert.match(css,/color:#16805d/);
});
