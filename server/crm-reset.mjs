import {UserError,limitedBody,digest} from './email.mjs';
export const resetId='crm-2026-10-20-before-new-import';
const tables={
 history_clients:['id','legacy_key','name','state','route_token','created_at'],
 client_profiles:['id','cnpj','payload','revision','origin_name','origin_state','author_id','updated_by','created_at','updated_at'],
 client_access:['client_id','user_id','granted_by'],
 import_records:['id','kind','source_key','client_id','payload','revision','author_id','created_at'],
 import_batches:['id','filename','summary','author_id','created_at'],
 project_stages:['client_id','project_key','project_name','stage','source','revision','updated_by','updated_at'],
 user_activities:['user_id','cache_key','payload','revision','updated_at'],
};
const object=(columns,alias='t')=>'json_object('+columns.flatMap(c=>["'"+c+"'",alias+'."'+c+'"']).join(',')+')';
const key=entity=>entity==='user_activities'?'t.user_id':entity==='client_access'?"t.client_id||':'||t.user_id":entity==='project_stages'?"t.client_id||':'||t.project_key":'CAST(t.id AS TEXT)';
export async function crmEpoch(env){const r=await env.DB.prepare('SELECT id,status FROM crm_reset_runs WHERE id=?').bind(resetId).first();return r?r.id+':'+r.status:null;}
export async function checkCrmEpoch(env,epoch){const current=await crmEpoch(env);if(current&&epoch!==current)throw new UserError('A base de clientes e atividades foi reiniciada. Atualize a página e gere uma nova prévia.',409);}
async function input(request){try{return JSON.parse(new TextDecoder().decode(await limitedBody(request,4096)));}catch(e){if(e instanceof UserError)throw e;throw new UserError('Confirmação inválida.');}}
async function counts(env){return env.DB.prepare(`SELECT (SELECT COUNT(*) FROM client_profiles) AS clients,(SELECT COUNT(*) FROM import_records WHERE kind='Atividades') AS importedActivities,(SELECT COALESCE(SUM(json_array_length(payload)),0) FROM user_activities) AS personalActivities,(SELECT COUNT(*) FROM import_records) AS importRecords,(SELECT COUNT(*) FROM history_clients) AS clientReferences,(SELECT COUNT(*) FROM client_orders) AS preservedOrders,(SELECT COUNT(*) FROM inventory_items) AS preservedStockItems,(SELECT COUNT(*) FROM market_presence) AS preservedMunicipalities`).first();}
export async function resetCrm(env,actor){
 const prior=await env.DB.prepare('SELECT status,summary FROM crm_reset_runs WHERE id=?').bind(resetId).first();if(prior)return {reset:prior.status==='cleared',alreadyProcessed:true,status:prior.status,removed:JSON.parse(prior.summary)};
 const summary=await counts(env),now=new Date().toISOString(),statements=[env.DB.prepare("INSERT INTO crm_reset_runs (id,status,summary,actor_id,created_at) VALUES (?,'cleared',?,?,?)").bind(resetId,JSON.stringify(summary),actor,now)];
 for(const [entity,columns] of Object.entries(tables))statements.push(env.DB.prepare(`INSERT INTO crm_reset_rows (reset_id,entity,row_key,payload) SELECT ?,?,${key(entity)},${object(columns)} FROM ${entity} t`).bind(resetId,entity));
 // Keep empty revisioned rows for every user so already-open tabs cannot re-upload old snapshots.
 statements.push(env.DB.prepare("INSERT INTO user_activities (user_id,payload,revision,updated_at,cache_key) SELECT id,'[]',1,?,NULL FROM app_users WHERE 1 ON CONFLICT(user_id) DO UPDATE SET payload='[]',revision=user_activities.revision+1,cache_key=NULL,updated_at=excluded.updated_at").bind(now));
 for(const table of ['client_access','import_records','import_batches','client_profiles'])statements.push(env.DB.prepare('DELETE FROM '+table));
 statements.push(env.DB.prepare('DELETE FROM project_stages WHERE NOT EXISTS(SELECT 1 FROM client_orders o WHERE o.client_id=project_stages.client_id AND o.project_key=project_stages.project_key)'));
 statements.push(env.DB.prepare('DELETE FROM history_clients WHERE NOT EXISTS(SELECT 1 FROM client_orders o WHERE o.client_id=history_clients.id) AND NOT EXISTS(SELECT 1 FROM service_equipment e WHERE e.client_id=history_clients.id) AND NOT EXISTS(SELECT 1 FROM history_emails e WHERE e.client_id=history_clients.id)'));
 statements.push(env.DB.prepare("INSERT INTO security_events (actor_id,action,target,created_at) VALUES (?,'crm_reset_completed',?,?)").bind(actor,resetId,now));
 try{await env.DB.batch(statements);}catch(error){if(/UNIQUE.*crm_reset_runs/.test(String(error)))return resetCrm(env,actor);throw error;}return {reset:true,alreadyProcessed:false,status:'cleared',removed:summary,remaining:await counts(env)};
}
// A short-lived machine credential authorizes only this specific, already requested maintenance job.
// It cannot authenticate as a user, select a different scope, or repeat a completed reset.
export async function maintenanceReset(request,env){
 const expected=env.BOREAL_CRM_RESET_TOKEN_SHA256,expires=Date.parse(env.BOREAL_CRM_RESET_EXPIRES_AT||'');
 const token=request.headers.get('authorization')?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];
 if(request.method!=='POST'||!expected||!Number.isFinite(expires)||Date.now()>expires||!token||await digest(new TextEncoder().encode(token))!==expected)throw new UserError('Operação indisponível.',403);
 const b=await input(request);if(b.confirmation!=='ZERAR ATIVIDADES E CLIENTES'||b.job!==resetId)throw new UserError('Confirmação inválida.');return resetCrm(env,'site-owner-maintenance');
}
export async function resetApi(request,env,auth){
 if(auth.role!=='admin')throw new UserError('Somente administradores podem consultar ou recuperar a limpeza.',403);
 const run=await env.DB.prepare('SELECT id,status,summary,created_at,restored_at FROM crm_reset_runs WHERE id=?').bind(resetId).first();
 if(request.method==='GET')return {run:run?{...run,summary:JSON.parse(run.summary)}:null};
 if(request.method!=='POST')throw new UserError('Método não permitido.',405);
 const b=await input(request);if(b.confirmation!=='RESTAURAR BASE ANTERIOR')throw new UserError('Confirme a recuperação.');if(!run)throw new UserError('Não há cópia para recuperar.',404);if(run.status==='restored')return {restored:true,alreadyRestored:true};
 const empty=`NOT EXISTS(SELECT 1 FROM client_profiles) AND NOT EXISTS(SELECT 1 FROM import_records) AND NOT EXISTS(SELECT 1 FROM user_activities WHERE json_array_length(payload)>0)`;
 const now=new Date().toISOString(),statements=[env.DB.prepare(`SELECT CASE WHEN ${empty} AND EXISTS(SELECT 1 FROM crm_reset_runs WHERE id=? AND status='cleared') THEN 1 ELSE json('crm_restore_conflict') END`).bind(resetId)];
 for(const entity of ['history_clients','client_profiles','client_access','import_records','import_batches','project_stages']){const columns=tables[entity];statements.push(env.DB.prepare(`INSERT OR IGNORE INTO ${entity} (${columns.join(',')}) SELECT ${columns.map(c=>`json_extract(payload,'$.${c}')`).join(',')} FROM crm_reset_rows WHERE reset_id=? AND entity=?`).bind(resetId,entity));}
 statements.push(env.DB.prepare("UPDATE user_activities SET payload=COALESCE((SELECT json_extract(a.payload,'$.payload') FROM crm_reset_rows a WHERE a.reset_id=? AND a.entity='user_activities' AND a.row_key=user_activities.user_id),'[]'),revision=revision+1,cache_key=NULL,updated_at=?").bind(resetId,now));
 statements.push(env.DB.prepare("UPDATE crm_reset_runs SET status='restored',restored_at=? WHERE id=?").bind(now,resetId),env.DB.prepare("INSERT INTO security_events (actor_id,action,target,created_at) VALUES (?,'crm_reset_restored',?,?)").bind(auth.id||auth.authId,resetId,now));
 try{await env.DB.batch(statements);}catch{throw new UserError('A base já recebeu novos dados. A recuperação não foi aplicada para preservar a nova importação.',409);}return {restored:true};
}
