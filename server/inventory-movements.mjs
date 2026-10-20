import {UserError} from './email.mjs';

// Both imported history and live dispatches retain their own stock semantics.
const archive=`SELECT l.id,l.item_id,COALESCE(json_extract(l.payload,'$.entry'),0)-COALESCE(json_extract(l.payload,'$.exit'),0) delta,l.date,'historical' kind,NULL order_id,
 json_object('client',json_extract(l.payload,'$.client'),'reference',b.filename||' · '||json_extract(l.payload,'$.sheet')||' · linha '||json_extract(l.payload,'$.line'),
 'model',json_extract(l.payload,'$.movement'),'number',json_extract(l.payload,'$.reference'),'project',json_extract(l.payload,'$.project'),'consultant',json_extract(l.payload,'$.consultant'),
 'contact',COALESCE(NULLIF(json_extract(l.payload,'$.contact'),''),json_extract(l.payload,'$.raw.contact'),json_extract(l.payload,'$.raw.contato'),(SELECT value FROM json_each(l.payload,'$.original') WHERE upper(trim(key)) LIKE '%. CONTATO' LIMIT 1)),
 'source',b.filename,'batchId',b.id,'sheet',json_extract(l.payload,'$.sheet'),'line',json_extract(l.payload,'$.line'),'noStockImpact',1) context,
 COALESCE(n.note,json_extract(l.payload,'$.note'),'') note,COALESCE(n.revision,1) revision,b.author_id,b.created_at
 FROM inventory_import_lines l JOIN inventory_import_batches b ON b.id=l.batch_id LEFT JOIN inventory_movement_notes n ON n.movement_id=l.id WHERE l.status='accepted' AND l.item_id IS NOT NULL`;

export async function listInventoryMovements(env,url,validateDate){
 const params=[],where=[];
 const bounded=(v,max=200)=>{if(v.length>max)throw new UserError('Filtro muito longo.');return v.trim();};
 const q=bounded(url.searchParams.get('q')||''),number=bounded(url.searchParams.get('number')||'',80),condition=url.searchParams.get('condition')||'';
 if(condition&&!['new','used','refurbished','unknown'].includes(condition))throw new UserError('Condição de estoque inválida.');
 if(q){where.push('(name LIKE ? OR sku LIKE ? OR context LIKE ? OR contact LIKE ?)');params.push(...Array(4).fill('%'+q+'%'));}
 if(number){where.push("lower(trim(CAST(json_extract(context,'$.number') AS TEXT)))=lower(?)");params.push(number);}
 for(const [param,op]of [['from','>='],['to','<=']])if(url.searchParams.get(param)){where.push('date '+op+' ?');params.push(validateDate(url.searchParams.get(param)));}
 if(condition){where.push('itemCondition=?');params.push(condition);}
 const offset=Number(url.searchParams.get('offset')||0);if(!Number.isSafeInteger(offset)||offset<0)throw new UserError('Página inválida.');
 const source=`WITH raw AS (SELECT * FROM inventory_movements UNION ALL ${archive}), enriched AS (
 SELECT m.*,i.name,i.sku,i.kind itemKind,COALESCE(json_extract(c.payload,'$.condition'),i.condition,'unknown') itemCondition,
 COALESCE(NULLIF(json_extract(m.context,'$.contact'),''),json_extract(o.payload,'$.snapshot.contact'),'') contact,
 CASE WHEN m.order_id IS NOT NULL THEN json_array('order',m.order_id)
 WHEN m.kind='historical' AND trim(COALESCE(CAST(json_extract(m.context,'$.number') AS TEXT),''))!='' THEN
 json_array('history',json_extract(m.context,'$.batchId'),m.date,lower(trim(json_extract(m.context,'$.client'))),trim(CAST(json_extract(m.context,'$.number') AS TEXT)),lower(trim(json_extract(m.context,'$.model'))),lower(trim(COALESCE(json_extract(m.context,'$.project'),''))),lower(trim(COALESCE(json_extract(c.payload,'$.equipment'),''))),CASE WHEN m.delta<0 THEN 'out' WHEN m.delta>0 THEN 'in' ELSE 'zero' END)
 ELSE json_array('row',m.id) END movementKey
 FROM raw m JOIN inventory_items i ON i.id=m.item_id LEFT JOIN inventory_import_items c ON c.item_id=i.id LEFT JOIN client_orders o ON o.id=m.order_id),
 matched AS (SELECT DISTINCT movementKey FROM enriched ${where.length?'WHERE '+where.join(' AND '):''}),
 eligible AS (SELECT * FROM enriched WHERE movementKey IN (SELECT movementKey FROM matched) ${condition?'AND itemCondition=?':''})`;
 if(condition)params.push(condition);
 const decode=r=>{const {movementKey,viewKey,...rest}=r;return {...rest,context:{...JSON.parse(r.context),contact:r.contact}};};
 if(url.searchParams.get('grouped')!=='1'){
  // Keep the existing per-item API contract for other inventory consumers.
  const rows=(await env.DB.prepare(`${source} SELECT * FROM eligible ORDER BY date DESC,created_at DESC,id DESC LIMIT 51 OFFSET ?`).bind(...params,offset).all()).results||[];
  return {movements:rows.slice(0,50).map(decode),hasMore:rows.length>50};
 }
 const rows=(await env.DB.prepare(`${source}, sizes AS (SELECT movementKey,SUM(CASE WHEN itemKind='equipment' THEN 1 ELSE 0 END) parents,COUNT(*) n FROM eligible GROUP BY movementKey),
 display AS (SELECT e.*,CASE WHEN s.parents=1 AND s.n>1 THEN e.movementKey ELSE json_array('row',e.id) END viewKey FROM eligible e JOIN sizes s ON s.movementKey=e.movementKey),
 pages AS (SELECT viewKey,MAX(date) sortDate,MAX(created_at) sortCreated,MAX(id) sortId FROM display GROUP BY viewKey ORDER BY sortDate DESC,sortCreated DESC,sortId DESC LIMIT 51 OFFSET ?)
 SELECT d.* FROM display d JOIN pages p ON p.viewKey=d.viewKey ORDER BY p.sortDate DESC,p.sortCreated DESC,p.sortId DESC,CASE WHEN d.itemKind='equipment' THEN 0 ELSE 1 END,d.name,d.id`).bind(...params,offset).all()).results||[];
 const groups=new Map();for(const row of rows){if(!groups.has(row.viewKey))groups.set(row.viewKey,[]);groups.get(row.viewKey).push(decode(row));}
 const values=[...groups.values()];return {movements:values.slice(0,50).map(([parent,...children])=>({...parent,children})),hasMore:values.length>50};
}
