import {listInventoryMovements} from './inventory-movements.mjs';
import {UserError,limitedBody} from './email.mjs';
const txt=(v,label,max=200,required=true)=>{if(typeof v!=='string'||v.length>max||required&&!v.trim())throw new UserError('Preencha '+label+' (até '+max+' caracteres).');return v.trim();};
const qty=(v,min=1)=>{if(!Number.isSafeInteger(v)||v<min||v>1000000)throw new UserError('Quantidade inválida. Use um número inteiro de '+min+' a 1.000.000.');return v;};
const key=v=>txt(v,'identificador',80);
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
 if(path==='/api/inventory'&&request.method==='GET'){
  const items=(await env.DB.prepare("SELECT i.id,i.sku,i.name,i.kind,i.balance,i.minimum,i.created_at,c.status AS verificationStatus,c.source_balance AS sourceBalance,c.history_net AS historyNet,c.reason AS verificationReason,COALESCE(json_extract(c.payload,'$.condition'),i.condition) AS condition,json_extract(c.payload,'$.variant') AS variant FROM inventory_items i LEFT JOIN inventory_import_items c ON c.item_id=i.id ORDER BY i.name,i.sku").all()).results||[];
  const kits=(await env.DB.prepare('SELECT * FROM inventory_kits ORDER BY name').all()).results||[];
  return {items,kits:kits.map(k=>({...k,components:JSON.parse(k.components)}))};
 }
 if(path==='/api/inventory/movements'&&request.method==='GET')return listInventoryMovements(env,url,inventoryDate);
 if(request.method==='POST'&&path==='/api/inventory/items'){
  role(auth,'stock');const b=await body(request),id=key(b.id),sku=txt(b.sku,'código do item',80).toUpperCase(),name=txt(b.name,'nome do item'),minimum=qty(b.minimum,0);
  if(!['equipment','accessory'].includes(b.kind))throw new UserError('Selecione equipamento ou acessório.');
  const condition=b.condition||'unknown';if(!['new','used','refurbished','unknown'].includes(condition))throw new UserError('Condição de estoque inválida.');
  const existing=await env.DB.prepare('SELECT * FROM inventory_items WHERE id=?').bind(id).first();if(existing){if(existing.sku===sku&&existing.name===name)return {item:existing};throw new UserError('Identificador já utilizado.',409);}
  await env.DB.prepare('INSERT INTO inventory_items (id,sku,name,kind,balance,minimum,created_at,condition) VALUES (?,?,?,?,0,?,?,?)').bind(id,sku,name,b.kind,minimum,now,condition).run();return {created:true};
 }
 if(request.method==='POST'&&path==='/api/inventory/kits'){
  role(auth,'stock');const b=await body(request),id=key(b.id),name=txt(b.name,'nome do kit'),components=await validateStockLines(env,b.components);
  await env.DB.prepare('INSERT INTO inventory_kits (id,name,components,created_at) VALUES (?,?,?,?) ON CONFLICT(id) DO NOTHING').bind(id,name,JSON.stringify(components),now).run();return {created:true};
 }
 if(request.method==='POST'&&path==='/api/inventory/entries'){
  role(auth,'stock');const b=await body(request),id=key(b.id),itemId=key(b.itemId),quantity=qty(b.quantity),date=inventoryDate(b.date),reference=txt(b.reference,'origem / documento',200),note=txt(b.note??'','observação',3000,false);
  if(!await env.DB.prepare('SELECT id FROM inventory_items WHERE id=?').bind(itemId).first())throw new UserError('Item de estoque não encontrado.');
  if(await env.DB.prepare("SELECT item_id FROM inventory_import_items WHERE item_id=? AND status='pending'").bind(itemId).first())throw new UserError('Este item está aguardando conferência. Resolva a pendência antes de registrar entradas.',409);
  const context=JSON.stringify({reference});
  const prior=await env.DB.prepare('SELECT * FROM inventory_movements WHERE id=?').bind(id).first();if(prior){if(prior.item_id!==itemId||prior.delta!==quantity||prior.date!==date||prior.context!==context)throw new UserError('Identificador de entrada já utilizado.',409);return {created:false};}
  await env.DB.prepare("INSERT INTO inventory_movements (id,item_id,delta,date,kind,context,note,revision,author_id,created_at) VALUES (?,?,?,?,'entry',?,?,1,?,?) ON CONFLICT(id) DO NOTHING").bind(id,itemId,quantity,date,context,note,user,now).run();return {created:true};
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
