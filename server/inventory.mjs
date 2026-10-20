import {listInventoryMovements} from './inventory-movements.mjs';
import {UserError,limitedBody} from './email.mjs';
const txt=(v,label,max=200,required=true)=>{if(typeof v!=='string'||v.length>max||required&&!v.trim())throw new UserError('Preencha '+label+' (até '+max+' caracteres).');return v.trim();};
const qty=(v,min=1)=>{if(!Number.isSafeInteger(v)||v<min||v>1000000)throw new UserError('Quantidade inválida. Use um número inteiro de '+min+' a 1.000.000.');return v;};
const key=v=>txt(v,'identificador',80);
const kitSignature=components=>components.map(({itemId,quantity})=>[itemId,quantity]).sort((a,b)=>a[0].localeCompare(b[0])).map(pair=>pair.join(':')).join('|');
export function inventoryDate(v){if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(v)||!Number.isFinite(Date.parse(v+'T12:00:00Z'))||new Date(v+'T12:00:00Z').toISOString().slice(0,10)!==v)throw new UserError('Informe uma data válida.');return v;}
async function body(request){try{return JSON.parse(new TextDecoder().decode(await limitedBody(request,65536)));}catch(e){if(e instanceof UserError)throw e;throw new UserError('Dados inválidos.');}}
function role(auth,...roles){if(!['admin',...roles].includes(auth.role))throw new UserError('Seu perfil não permite esta operação.',403);}
export async function validateStockLines(env,lines){
 if(!Array.isArray(lines)||!lines.length||lines.length>100)throw new UserError('Selecione de 1 a 100 itens de estoque para este envio.');
 const seen=new Set(),result=[];
 for(const line of lines){const itemId=key(line.itemId),quantity=qty(line.quantity);if(seen.has(itemId))throw new UserError('Agrupe as quantidades do mesmo item em uma única linha.');seen.add(itemId);const item=await env.DB.prepare('SELECT * FROM inventory_items WHERE id=?').bind(itemId).first();if(!item)throw new UserError('Item de estoque não encontrado.');if(await env.DB.prepare("SELECT item_id FROM inventory_import_items WHERE item_id=? AND status='pending'").bind(itemId).first())throw new UserError('Este item está aguardando conferência de estoque.',409);result.push({itemId,quantity,name:item.name,sku:item.sku});}
 return result;
}
export function stockDispatchStatements(env,row,workflow,now){
 const p=JSON.parse(row.payload),context=JSON.stringify({client:p.snapshot.client,model:p.movement,number:row.order_ref||'PED-'+row.id.slice(0,8).toUpperCase(),project:p.snapshot.project,contact:p.snapshot.contact||'',consultant:p.snapshot.consultant});
 return workflow.shipping.stockLines.map(line=>env.DB.prepare(`INSERT INTO inventory_movements (id,item_id,delta,date,kind,order_id,context,note,revision,author_id,created_at) SELECT ?,?,?,?,'dispatch',?,?,?,1,?,? FROM client_orders WHERE id=? AND json_extract(workflow,'$.mutationKey')=?`).bind(crypto.randomUUID(),line.itemId,-line.quantity,workflow.dispatchAt,row.id,context,'',workflow.events.at(-1).by,now,row.id,workflow.mutationKey));
}
export async function inventoryApi(request,env,url,auth,user){
 role(auth,'stock','dispatch','coordinator');
 const path=url.pathname,now=new Date().toISOString();
 if(path==='/api/inventory/reset'&&request.method==='POST'){
  role(auth);const data=await body(request);
  if(data.confirmation!=='ZERAR ESTOQUE')throw new UserError('Confirme a limpeza digitando ZERAR ESTOQUE.');
  const marker='inventory_reset_2026_10_20_completed',prior=await env.DB.prepare('SELECT id FROM security_events WHERE action=? LIMIT 1').bind(marker).first();
  if(prior)return {reset:true,alreadyReset:true};
  const orders=await env.DB.prepare('SELECT COUNT(*) AS n FROM client_orders').first();
  if(Number(orders?.n))throw new UserError('Existem pedidos ativos. Zere os pedidos antes de limpar o cadastro de estoque.',409);
  const counts=await env.DB.prepare(`SELECT
   (SELECT COUNT(*) FROM inventory_items) AS items,
   (SELECT COUNT(*) FROM inventory_kits) AS kits,
   (SELECT COUNT(*) FROM inventory_movements) AS movements,
   (SELECT COUNT(*) FROM inventory_serial_units) AS serialUnits,
   (SELECT COUNT(*) FROM inventory_import_trash) AS removedImports`).first();
  await env.DB.batch([
   env.DB.prepare("SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM security_events WHERE action=?) THEN 1 ELSE json('inventory_reset_conflict') END").bind(marker),
   env.DB.prepare('DELETE FROM inventory_serial_events'),
   env.DB.prepare('DELETE FROM inventory_serial_shortages'),
   env.DB.prepare('DELETE FROM inventory_serial_units'),
   env.DB.prepare('DELETE FROM inventory_serial_receipts'),
   env.DB.prepare('DELETE FROM inventory_movement_notes'),
   env.DB.prepare('DELETE FROM inventory_import_trash_rows'),
   env.DB.prepare('DELETE FROM inventory_import_trash'),
   env.DB.prepare('DELETE FROM inventory_import_drafts'),
   env.DB.prepare('DELETE FROM inventory_import_lines'),
   env.DB.prepare('DELETE FROM inventory_import_items'),
   env.DB.prepare('DELETE FROM inventory_import_batches'),
   env.DB.prepare('DELETE FROM inventory_movements'),
   env.DB.prepare('DELETE FROM inventory_kits'),
   env.DB.prepare('DELETE FROM inventory_items'),
   env.DB.prepare('INSERT INTO security_events (actor_id,action,target,created_at) VALUES (?,?,?,?)').bind(user,marker,JSON.stringify(counts).slice(0,200),now)
  ]);
  return {reset:true,alreadyReset:false,removed:counts};
 }
 if(path==='/api/inventory'&&request.method==='GET'){
  const items=(await env.DB.prepare("SELECT i.id,i.sku,i.name,i.manufacturer,i.kind,i.balance,i.minimum,i.created_at,c.status AS verificationStatus,c.source_balance AS sourceBalance,c.history_net AS historyNet,c.reason AS verificationReason,COALESCE(json_extract(c.payload,'$.condition'),i.condition) AS condition,json_extract(c.payload,'$.variant') AS variant FROM inventory_items i LEFT JOIN inventory_import_items c ON c.item_id=i.id ORDER BY i.name,i.manufacturer,i.sku").all()).results||[];
  const kits=(await env.DB.prepare('SELECT * FROM inventory_kits ORDER BY name').all()).results||[];
  const serialSummary=await env.DB.prepare("SELECT SUM(CASE WHEN kind='equipment' THEN 1 ELSE 0 END) AS equipment,SUM(CASE WHEN kind='battery' AND parent_id IS NULL THEN 1 ELSE 0 END) AS batteries,SUM(CASE WHEN kind='charger' AND parent_id IS NULL THEN 1 ELSE 0 END) AS chargers,SUM(CASE WHEN kind='equipment' AND EXISTS(SELECT 1 FROM inventory_serial_units b WHERE b.parent_id=u.id AND b.kind='battery' AND b.status='available') AND EXISTS(SELECT 1 FROM inventory_serial_units c WHERE c.parent_id=u.id AND c.kind='charger' AND c.status='available') THEN 1 ELSE 0 END) AS complete FROM inventory_serial_units u WHERE status='available'").first();
  return {items,serialSummary,kits:kits.map(k=>({...k,components:JSON.parse(k.components)}))};
 }
 if(path==='/api/inventory/movements'&&request.method==='GET')return listInventoryMovements(env,url,inventoryDate);
 if(request.method==='POST'&&path==='/api/inventory/items'){
  role(auth,'stock');const b=await body(request),id=key(b.id),sku=txt(b.sku,'código do item',80).toUpperCase(),name=txt(b.name,'nome do item'),manufacturer=txt(b.manufacturer??'','fabricante',100,false),minimum=qty(b.minimum,0);
  if(!['equipment','accessory'].includes(b.kind))throw new UserError('Selecione equipamento ou acessório.');
  const condition=b.condition||'unknown';if(!['new','used','refurbished','unknown'].includes(condition))throw new UserError('Condição de estoque inválida.');
  const existing=await env.DB.prepare('SELECT * FROM inventory_items WHERE id=?').bind(id).first();if(existing){if(existing.sku===sku&&existing.name===name&&existing.manufacturer===manufacturer)return {item:existing};throw new UserError('Identificador já utilizado.',409);}
  await env.DB.prepare('INSERT INTO inventory_items (id,sku,name,manufacturer,kind,balance,minimum,created_at,condition) VALUES (?,?,?,?,?,0,?,?,?)').bind(id,sku,name,manufacturer,b.kind,minimum,now,condition).run();return {created:true};
 }
 if(request.method==='POST'&&path==='/api/inventory/kits'){
  role(auth,'stock');const b=await body(request),id=key(b.id),name=txt(b.name,'nome do kit'),components=await validateStockLines(env,b.components);
  const duplicate=((await env.DB.prepare('SELECT id,name,components FROM inventory_kits').all()).results||[]).find(kit=>kitSignature(JSON.parse(kit.components))===kitSignature(components));
  if(duplicate)throw new UserError('Já existe um kit com esta mesma composição: '+duplicate.name+'. Edite o cadastro existente.',409);
  await env.DB.prepare('INSERT INTO inventory_kits (id,name,components,created_at) VALUES (?,?,?,?) ON CONFLICT(id) DO NOTHING').bind(id,name,JSON.stringify(components),now).run();return {created:true};
 }
 const kitMatch=path.match(/^\/api\/inventory\/kits\/([^/]+)$/);
 if(kitMatch&&request.method==='PATCH'){
  role(auth,'stock');const id=key(decodeURIComponent(kitMatch[1])),b=await body(request),name=txt(b.name,'nome do kit'),components=await validateStockLines(env,b.components);
  const kits=(await env.DB.prepare('SELECT id,name,components FROM inventory_kits').all()).results||[],duplicate=kits.find(kit=>kit.id!==id&&kitSignature(JSON.parse(kit.components))===kitSignature(components));
  if(duplicate)throw new UserError('Esta composição já pertence ao kit '+duplicate.name+'. Exclua o cadastro duplicado ou edite o outro kit.',409);
  const updated=await env.DB.prepare('UPDATE inventory_kits SET name=?,components=? WHERE id=? RETURNING id').bind(name,JSON.stringify(components),id).first();if(!updated)throw new UserError('Kit não encontrado.',404);return {updated:true};
 }
 if(kitMatch&&request.method==='DELETE'){
  role(auth,'stock');const id=key(decodeURIComponent(kitMatch[1])),deleted=await env.DB.prepare('DELETE FROM inventory_kits WHERE id=? RETURNING id').bind(id).first();if(!deleted)throw new UserError('Kit não encontrado.',404);return {deleted:true};
 }
 if(request.method==='POST'&&path==='/api/inventory/entries'){
  role(auth,'stock');const b=await body(request),id=key(b.id),itemId=key(b.itemId),quantity=qty(b.quantity),date=inventoryDate(b.date),reference=txt(b.reference,'origem / documento',200),note=txt(b.note??'','observação',3000,false);
  if(!await env.DB.prepare('SELECT id FROM inventory_items WHERE id=?').bind(itemId).first())throw new UserError('Item de estoque não encontrado.');
  if(await env.DB.prepare("SELECT item_id FROM inventory_import_items WHERE item_id=? AND status='pending'").bind(itemId).first())throw new UserError('Este item está aguardando conferência. Resolva a pendência antes de registrar entradas.',409);
  const context=JSON.stringify({reference});
  const prior=await env.DB.prepare('SELECT * FROM inventory_movements WHERE id=?').bind(id).first();if(prior){if(prior.item_id!==itemId||prior.delta!==quantity||prior.date!==date||prior.context!==context)throw new UserError('Identificador de entrada já utilizado.',409);return {created:false};}
  await env.DB.prepare("INSERT INTO inventory_movements (id,item_id,delta,date,kind,context,note,revision,author_id,created_at) VALUES (?,?,?,?,'entry',?,?,1,?,?) ON CONFLICT(id) DO NOTHING").bind(id,itemId,quantity,date,context,note,user,now).run();return {created:true};
 }
 if(request.method==='POST'&&path==='/api/inventory/kit-entries'){
  role(auth,'stock');const b=await body(request),id=key(b.id),kitId=key(b.kitId),kitQuantity=qty(b.quantity),date=inventoryDate(b.date),reference=txt(b.reference,'origem / documento',200),note=txt(b.note??'','observação',3000,false),condition=b.condition;
  if(!['new','used','refurbished'].includes(condition))throw new UserError('Informe se o kit recebido é novo, usado ou recondicionado.');
  const kit=await env.DB.prepare('SELECT * FROM inventory_kits WHERE id=?').bind(kitId).first();if(!kit)throw new UserError('Kit não encontrado.',404);
  const components=await validateStockLines(env,JSON.parse(kit.components)),lines=components.map(component=>({...component,quantity:qty(component.quantity*kitQuantity)}));
  const context=JSON.stringify({reference,model:'Entrada por kit · '+kit.name,kitId,kitName:kit.name,kitQuantity,condition}),statements=[];
  for(const line of lines){const movementId=id+':'+line.itemId,prior=await env.DB.prepare('SELECT * FROM inventory_movements WHERE id=?').bind(movementId).first();if(prior){if(prior.item_id!==line.itemId||prior.delta!==line.quantity||prior.date!==date||prior.context!==context)throw new UserError('Identificador de entrada por kit já utilizado.',409);continue;}statements.push(env.DB.prepare("INSERT INTO inventory_movements (id,item_id,delta,date,kind,context,note,revision,author_id,created_at) VALUES (?,?,?,?,'entry',?,?,1,?,?)").bind(movementId,line.itemId,line.quantity,date,context,note,user,now));}
  if(statements.length)await env.DB.batch(statements);return {created:!!statements.length,components:lines.map(line=>({itemId:line.itemId,name:line.name,quantity:line.quantity}))};
 }
 const match=path.match(/^\/api\/inventory\/movements\/([^/]+)$/);
 if(match&&request.method==='PATCH'){
  role(auth,'stock');const b=await body(request),note=txt(b.note??'','observação',3000,false);if(!Number.isSafeInteger(b.revision)||b.revision<1)throw new UserError('Atualize as movimentações.');
  const id=match[1],live=await env.DB.prepare('SELECT id FROM inventory_movements WHERE id=?').bind(id).first();let result;
  if(live)result=await env.DB.prepare('UPDATE inventory_movements SET note=?,revision=revision+1 WHERE id=? AND revision=? RETURNING note,revision').bind(note,id,b.revision).first();
  else{
   const historical=await env.DB.prepare("SELECT id FROM inventory_import_lines WHERE id=? AND status='accepted' AND item_id IS NOT NULL").bind(id).first();if(!historical)throw new UserError('Movimentação não encontrada.',404);
   const prior=await env.DB.prepare('SELECT revision FROM inventory_movement_notes WHERE movement_id=?').bind(id).first();
   if(prior)result=await env.DB.prepare('UPDATE inventory_movement_notes SET note=?,revision=revision+1,updated_by=?,updated_at=? WHERE movement_id=? AND revision=? RETURNING note,revision').bind(note,user,now,id,b.revision).first();
   else if(b.revision===1)result=await env.DB.prepare('INSERT INTO inventory_movement_notes (movement_id,note,revision,updated_by,updated_at) VALUES (?,?,2,?,?) ON CONFLICT(movement_id) DO NOTHING RETURNING note,revision').bind(id,note,user,now).first();
  }
  if(!result)throw new UserError('A observação mudou em outra sessão. Atualize a lista antes de salvar.',409);return {saved:true,...result};
 }
 throw new UserError('Operação de estoque não encontrada.',404);
}
