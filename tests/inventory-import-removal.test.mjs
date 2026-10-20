import test from 'node:test';import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import worker from '../server/index.mjs';import {environment,request} from './helpers.mjs';import {historyLine} from './inventory-movement-fixtures.mjs';
const batch='movement-fixture';
const call=(env,path,data)=>worker.fetch(request('/api/inventory/'+path,{method:data?'POST':'GET',headers:data?{'Content-Type':'application/json'}:{},body:data?JSON.stringify(data):undefined}),env);
async function json(r){assert.equal(r.status,200,await r.clone().text());return r.json();}
function fixture(){const env=environment();const line=historyLine(env),free=historyLine(env,{part:'Capa'});env.sqlite.exec('PRAGMA foreign_keys=OFF');for(const item of env.sqlite.prepare('SELECT id FROM inventory_items').all()){const identity=createHash('sha256').update(item.id).digest('hex'),id='imp-'+identity.slice(0,40);env.sqlite.prepare('UPDATE inventory_items SET id=? WHERE id=?').run(id,item.id);env.sqlite.prepare('UPDATE inventory_import_items SET item_id=?,identity_key=? WHERE item_id=?').run(id,identity,item.id);env.sqlite.prepare('UPDATE inventory_import_lines SET item_id=? WHERE item_id=?').run(id,item.id);}env.sqlite.exec('PRAGMA foreign_keys=ON');const parent=env.sqlite.prepare('SELECT item_id FROM inventory_import_lines WHERE id=?').get(line).item_id;
 env.sqlite.prepare('UPDATE inventory_items SET balance=10 WHERE id=?').run(parent);env.sqlite.prepare('UPDATE inventory_import_items SET source_balance=10 WHERE item_id=?').run(parent);
 env.sqlite.prepare('INSERT INTO inventory_kits VALUES (?,?,?,?)').run('kit','Kit configurado',JSON.stringify([{itemId:parent,quantity:1}]),'2026-10-16');
 for(const [id,delta,kind]of [['manual-entry',3,'entry'],['manual-dispatch',-1,'dispatch']])env.sqlite.prepare('INSERT INTO inventory_movements VALUES (?,?,?,? ,?,NULL,?,?,1,?,?)').run(id,parent,delta,'2026-10-16',kind,'{}','Nota manual','fixture','2026-10-16');
 env.sqlite.prepare("INSERT INTO inventory_items (id,sku,name,kind,balance,minimum,created_at) VALUES ('manual','MANUAL','Cadastro manual','equipment',7,0,'2026-10-16')").run();
 env.sqlite.prepare('INSERT INTO inventory_movement_notes VALUES (?,?,2,?,?)').run(line,'Anotação do histórico','fixture','2026-10-16');return {env,line,free,parent};}
test('Removing one import preserves manual movements, positive manual stock, kits and unrelated data; restore is exact',async()=>{
 const {env,line,parent}=fixture(),snapshot=Object.fromEntries(['inventory_import_batches','inventory_import_items','inventory_import_lines','inventory_items','inventory_movements','inventory_kits','inventory_movement_notes'].map(t=>[t,env.sqlite.prepare('SELECT * FROM '+t+' ORDER BY 1').all()]));
 const info=await json(await call(env,'imports/'+batch+'/removal'));assert.equal(info.summary.items,2);assert.equal(info.summary.retainedItems,1);assert.equal(info.summary.preservedMovements,2);assert.equal(info.summary.preservedKits,1);
 assert.equal((await call(env,'imports/'+batch+'/removal',{revision:1})).status,409);
 const removed=await json(await call(env,'imports/'+batch+'/removal',{confirmed:true,revision:info.revision}));assert.equal(removed.removed,true);
 for(const t of ['inventory_import_batches','inventory_import_items','inventory_import_lines','inventory_movement_notes'])assert.equal(env.sqlite.prepare('SELECT COUNT(*) n FROM '+t).get().n,0,t);
 assert.equal(env.sqlite.prepare('SELECT balance FROM inventory_items WHERE id=?').get(parent).balance,2);assert.equal(env.sqlite.prepare("SELECT balance FROM inventory_items WHERE id='manual'").get().balance,7);assert.equal(env.sqlite.prepare('SELECT COUNT(*) n FROM inventory_movements').get().n,2);assert.equal(env.sqlite.prepare('SELECT COUNT(*) n FROM inventory_kits').get().n,1);
 assert.equal((await json(await call(env,'imports/'+batch+'/removal',{confirmed:true,revision:1}))).alreadyRemoved,true);
 assert.equal((await json(await call(env,'import-trash'))).removed.length,1);
 const restored=await json(await call(env,'import-trash/'+removed.id+'/restore',{confirmed:true}));assert.equal(restored.restored,true);
 for(const [t,rows]of Object.entries(snapshot))assert.deepEqual(env.sqlite.prepare('SELECT * FROM '+t+' ORDER BY 1').all(),rows,t);
 assert.equal((await json(await call(env,'import-trash/'+removed.id+'/restore',{confirmed:true}))).alreadyRestored,true);
 assert.equal((await json(await call(env,'import-trash'))).removed.length,0);
});
test('Restore refuses to overwrite a changed stock; only administrators can remove import data',async()=>{
 const {env,parent}=fixture();for(const role of ['stock','dispatch','coordinator','commercial']){env.sqlite.prepare('UPDATE app_users SET role=?').run(role);assert.equal((await call(env,'imports/'+batch+'/removal')).status,403);}
 env.sqlite.prepare("UPDATE app_users SET role='admin'").run();const r=await json(await call(env,'imports/'+batch+'/removal',{confirmed:true,revision:1}));
 env.sqlite.prepare('UPDATE inventory_items SET balance=balance+1 WHERE id=?').run(parent);assert.equal((await call(env,'import-trash/'+r.id+'/restore',{confirmed:true})).status,409);assert.equal(env.sqlite.prepare('SELECT COUNT(*) n FROM inventory_import_batches').get().n,0);assert.equal(env.sqlite.prepare('SELECT balance FROM inventory_items WHERE id=?').get(parent).balance,3);
});
