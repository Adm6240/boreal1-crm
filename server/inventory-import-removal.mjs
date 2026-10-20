import {UserError,limitedBody} from './email.mjs';
const tables={
 inventory_items:['id','sku','name','kind','balance','minimum','created_at','condition'],
 inventory_import_batches:['id','fingerprint','filename','payload','status','revision','author_id','created_at','applied_at'],
 inventory_import_items:['item_id','identity_key','batch_id','status','source_balance','history_net','reason','payload','revision'],
 inventory_import_drafts:['batch_id','identity_key','payload'],
 inventory_import_lines:['id','batch_id','item_id','record_key','status','date','payload'],
 inventory_movement_notes:['movement_id','note','revision','updated_by','updated_at']
};
const keep=`(i.id!=('imp-'||substr(c.identity_key,1,40)) OR EXISTS(SELECT 1 FROM inventory_movements m WHERE m.item_id=i.id) OR EXISTS(SELECT 1 FROM inventory_kits k,json_each(k.components) j WHERE json_extract(j.value,'$.itemId')=i.id) OR EXISTS(SELECT 1 FROM client_orders o,json_each(o.workflow,'$.shipping.stockLines') j WHERE json_extract(j.value,'$.itemId')=i.id))`;
const remaining=`CASE WHEN c.status='ready' THEN max(0,i.balance-max(0,COALESCE(c.source_balance,0))) ELSE i.balance END`;
const afterCondition=`COALESCE(json_extract(c.payload,'$.condition'),i.condition)`;
const object=(columns,alias)=>'json_object('+columns.flatMap(c=>["'"+c+"'",alias+'."'+c+'"']).join(',')+')';
async function rows(env,sql,...args){return (await env.DB.prepare(sql).bind(...args).all()).results||[];}
async function input(request){try{return JSON.parse(new TextDecoder().decode(await limitedBody(request,16384)));}catch{throw new UserError('Dados da limpeza inválidos.');}}
export async function inventoryImportRemoval(request,env,url,auth,user){
 if(auth.role!=='admin')throw new UserError('A remoção de importações está disponível para administradores.',403);
 if(url.pathname==='/api/inventory/import-trash'&&request.method==='GET')return {removed:(await rows(env,"SELECT id,filename,summary,removed_at FROM inventory_import_trash WHERE status='removed' ORDER BY removed_at DESC")).map(r=>({...r,summary:JSON.parse(r.summary)}))};
 const restore=url.pathname.match(/^\/api\/inventory\/import-trash\/([^/]+)\/restore$/);
 if(restore&&request.method==='POST'){
  const b=await input(request);if(b.confirmed!==true)throw new UserError('Confirme a restauração.');const id=restore[1],trash=await env.DB.prepare('SELECT * FROM inventory_import_trash WHERE id=?').bind(id).first();if(!trash)throw new UserError('Importação removida não encontrada.',404);if(trash.status==='restored')return {restored:true,alreadyRestored:true};
  const match=tables.inventory_items.map(c=>`i."${c}" IS json_extract(a.payload,'$.${c==='balance'?'_afterBalance':c==='condition'?'_afterCondition':c}')`).join(' AND ');
  const guard=`NOT EXISTS(SELECT 1 FROM inventory_import_batches WHERE id=?) AND NOT EXISTS(SELECT 1 FROM inventory_import_items c JOIN inventory_import_trash_rows a ON a.trash_id=? AND a.entity='inventory_import_items' AND c.identity_key=json_extract(a.payload,'$.identity_key')) AND NOT EXISTS(SELECT 1 FROM inventory_import_trash_rows a WHERE a.trash_id=? AND a.entity='inventory_items' AND ((json_extract(a.payload,'$._keep')=1 AND NOT EXISTS(SELECT 1 FROM inventory_items i WHERE i.id=a.row_key AND ${match} AND (SELECT COUNT(*) FROM inventory_movements m WHERE m.item_id=i.id)=json_extract(a.payload,'$._liveCount'))) OR (json_extract(a.payload,'$._keep')=0 AND EXISTS(SELECT 1 FROM inventory_items i WHERE i.id=a.row_key))))`;
  const statements=[env.DB.prepare(`SELECT CASE WHEN ${guard} THEN 1 ELSE json('restore_conflict') END`).bind(trash.batch_id,id,id)];
  for(const table of ['inventory_items','inventory_import_batches','inventory_import_items','inventory_import_drafts','inventory_import_lines','inventory_movement_notes']){
   const columns=tables[table],values=columns.map(c=>table==='inventory_import_items'&&c==='status'?"'__restoring__'":`json_extract(a.payload,'$.${c}')`);
   statements.push(env.DB.prepare(`INSERT ${table==='inventory_items'?'OR IGNORE ':''}INTO ${table} (${columns.map(c=>'"'+c+'"').join(',')}) SELECT ${values.join(',')} FROM inventory_import_trash_rows a WHERE a.trash_id=? AND a.entity=?`).bind(id,table));
  }
  statements.push(env.DB.prepare("UPDATE inventory_import_items SET status=(SELECT json_extract(a.payload,'$.status') FROM inventory_import_trash_rows a WHERE a.trash_id=? AND a.entity='inventory_import_items' AND a.row_key=inventory_import_items.item_id) WHERE item_id IN (SELECT row_key FROM inventory_import_trash_rows WHERE trash_id=? AND entity='inventory_import_items')").bind(id,id));
  statements.push(env.DB.prepare("UPDATE inventory_items SET balance=(SELECT json_extract(a.payload,'$.balance') FROM inventory_import_trash_rows a WHERE a.trash_id=? AND a.entity='inventory_items' AND a.row_key=inventory_items.id),condition=(SELECT json_extract(a.payload,'$.condition') FROM inventory_import_trash_rows a WHERE a.trash_id=? AND a.entity='inventory_items' AND a.row_key=inventory_items.id) WHERE id IN (SELECT row_key FROM inventory_import_trash_rows WHERE trash_id=? AND entity='inventory_items')").bind(id,id,id));
  statements.push(env.DB.prepare("UPDATE inventory_import_trash SET status='restored',restored_at=? WHERE id=?").bind(new Date().toISOString(),id));
  try{await env.DB.batch(statements);}catch{throw new UserError('O estoque mudou após a remoção. A restauração não foi aplicada para preservar os dados atuais.',409);}return {restored:true};
 }
 const match=url.pathname.match(/^\/api\/inventory\/imports\/([^/]+)\/removal$/);if(!match)throw new UserError('Operação não encontrada.',404);const batchId=match[1];
 const batch=await env.DB.prepare('SELECT * FROM inventory_import_batches WHERE id=?').bind(batchId).first();if(!batch){const prior=await env.DB.prepare("SELECT id,summary FROM inventory_import_trash WHERE batch_id=? AND status='removed' ORDER BY removed_at DESC LIMIT 1").bind(batchId).first();if(prior)return {removed:true,alreadyRemoved:true,id:prior.id,summary:JSON.parse(prior.summary)};throw new UserError('Importação não encontrada.',404);}
 const counts=await env.DB.prepare(`SELECT COUNT(*) items,SUM(CASE WHEN ${keep} THEN 1 ELSE 0 END) retainedItems,(SELECT COUNT(*) FROM inventory_import_lines WHERE batch_id=?) historyRows,(SELECT COUNT(*) FROM inventory_movements WHERE item_id IN (SELECT item_id FROM inventory_import_items WHERE batch_id=?)) preservedMovements,(SELECT COUNT(*) FROM inventory_kits k WHERE EXISTS(SELECT 1 FROM json_each(k.components) j JOIN inventory_import_items c ON c.item_id=json_extract(j.value,'$.itemId') WHERE c.batch_id=?)) preservedKits FROM inventory_import_items c JOIN inventory_items i ON i.id=c.item_id WHERE c.batch_id=?`).bind(batchId,batchId,batchId,batchId).first();
 const summary={filename:batch.filename,...counts,retainedItems:counts.retainedItems||0};if(request.method==='GET')return {batchId,revision:batch.revision,summary};
 if(request.method!=='POST')throw new UserError('Método não permitido.',405);const b=await input(request);if(b.confirmed!==true||b.revision!==batch.revision)throw new UserError('Atualize e confirme o alcance da limpeza.',409);
 const id=crypto.randomUUID(),now=new Date().toISOString();const statements=[env.DB.prepare("SELECT CASE WHEN EXISTS(SELECT 1 FROM inventory_import_batches WHERE id=? AND revision=?) THEN 1 ELSE json('removal_conflict') END").bind(batchId,b.revision),env.DB.prepare("INSERT INTO inventory_import_trash (id,batch_id,filename,summary,status,removed_by,removed_at) VALUES (?,?,?,?,'removed',?,?)").bind(id,batchId,batch.filename,JSON.stringify(summary),user,now)];
 for(const [table,columns]of Object.entries(tables)){
  let source,alias,key,filter;
  if(table==='inventory_items'){source='inventory_items i JOIN inventory_import_items c ON c.item_id=i.id';alias='i';key='i.id';filter='c.batch_id=?';}
  else if(table==='inventory_movement_notes'){source=table+' t JOIN inventory_import_lines l ON l.id=t.movement_id';alias='t';key='t.movement_id';filter='l.batch_id=?';}
  else{source=table+' t';alias='t';key=table==='inventory_import_items'?'t.item_id':table==='inventory_import_drafts'?'t.identity_key':'t.id';filter=table==='inventory_import_batches'?'t.id=?':'t.batch_id=?';}
  let payload=object(columns,alias);if(table==='inventory_items')payload=payload.slice(0,-1)+`, '_keep',CASE WHEN ${keep} THEN 1 ELSE 0 END,'_afterBalance',${remaining},'_afterCondition',${afterCondition},'_liveCount',(SELECT COUNT(*) FROM inventory_movements m WHERE m.item_id=i.id))`;
  statements.push(env.DB.prepare(`INSERT INTO inventory_import_trash_rows (trash_id,entity,row_key,payload) SELECT ?,?,${key},${payload} FROM ${source} WHERE ${filter}`).bind(id,table,batchId));
 }
 statements.push(env.DB.prepare(`UPDATE inventory_items AS i SET balance=(SELECT json_extract(a.payload,'$._afterBalance') FROM inventory_import_trash_rows a WHERE a.trash_id=? AND a.entity='inventory_items' AND a.row_key=i.id),condition=(SELECT json_extract(a.payload,'$._afterCondition') FROM inventory_import_trash_rows a WHERE a.trash_id=? AND a.entity='inventory_items' AND a.row_key=i.id) WHERE i.id IN (SELECT row_key FROM inventory_import_trash_rows WHERE trash_id=? AND entity='inventory_items' AND json_extract(payload,'$._keep')=1)`).bind(id,id,id));
 statements.push(env.DB.prepare('DELETE FROM inventory_movement_notes WHERE movement_id IN (SELECT id FROM inventory_import_lines WHERE batch_id=?)').bind(batchId));
 for(const table of ['inventory_import_lines','inventory_import_drafts','inventory_import_items','inventory_import_batches'])statements.push(env.DB.prepare(`DELETE FROM ${table} WHERE ${table==='inventory_import_batches'?'id':'batch_id'}=?`).bind(batchId));
 statements.push(env.DB.prepare("DELETE FROM inventory_items WHERE id IN (SELECT row_key FROM inventory_import_trash_rows WHERE trash_id=? AND entity='inventory_items' AND json_extract(payload,'$._keep')=0)").bind(id));
 try{await env.DB.batch(statements);}catch{throw new UserError('A limpeza não foi aplicada porque o estoque mudou. Atualize a prévia e tente novamente.',409);}return {removed:true,id,summary};
}
