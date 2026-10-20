import {UserError,limitedBody} from './email.mjs';
export const identityKey=value=>String(value||'').normalize('NFC').trim().toLocaleLowerCase('pt-BR').replace(/\s+/g,' ');
export async function audit(env,actor,action,target=''){
 await env.DB.prepare('INSERT INTO security_events (actor_id,action,target,created_at) VALUES (?,?,?,?)').bind(actor?.id||'anonymous',action,String(target).slice(0,200),new Date().toISOString()).run();
}
export async function allowedClients(env,actor){
 if(actor.role!=='commercial')return null;
 const ids=new Set();const name=identityKey(actor.consultantName);
 const explicit=(await env.DB.prepare('SELECT client_id FROM client_access WHERE user_id=?').bind(actor.id).all()).results||[];
 for(const row of explicit)ids.add(row.client_id);
 const profiles=(await env.DB.prepare("SELECT id,author_id,json_extract(payload,'$.consultant') AS consultant FROM client_profiles").all()).results||[];
 for(const row of profiles){if(row.author_id===actor.id||name&&identityKey(row.consultant)===name)ids.add(row.id);}
 const imports=(await env.DB.prepare("SELECT client_id,json_extract(payload,'$.owner') AS owner FROM import_records WHERE client_id IS NOT NULL AND kind IN ('Atividades','Negócios')").all()).results||[];
 for(const row of imports){if(name&&identityKey(row.owner)===name)ids.add(row.client_id);}
 const orders=(await env.DB.prepare("SELECT client_id,json_extract(payload,'$.snapshot.consultant') AS consultant FROM client_orders").all()).results||[];
 for(const row of orders){if(name&&identityKey(row.consultant)===name)ids.add(row.client_id);}
 return ids;
}
export async function requireClient(env,actor,id){if(actor.role==='commercial'&&!(await allowedClients(env,actor)).has(id)){await audit(env,actor,'client_access_denied',id);throw new UserError('Você não tem acesso à carteira deste cliente.',403);}}
export async function accessApi(request,env,actor,id){
 if(actor.role!=='admin')throw new UserError('Somente administradores podem atribuir clientes.',403);
 if(!await env.DB.prepare('SELECT id FROM history_clients WHERE id=?').bind(id).first())throw new UserError('Cliente não encontrado.',404);
 if(request.method==='GET')return {users:(await env.DB.prepare('SELECT user_id FROM client_access WHERE client_id=?').bind(id).all()).results||[]};
 if(request.method!=='PUT')throw new UserError('Método não permitido.',405);
 const b=JSON.parse(new TextDecoder().decode(await limitedBody(request,8192)));
 if(typeof b.grant!=='boolean'||typeof b.userId!=='string')throw new UserError('Selecione um consultor e a permissão.');
 if(!await env.DB.prepare("SELECT id FROM app_users WHERE id=? AND role='commercial' AND active=1").bind(b.userId).first())throw new UserError('Consultor não encontrado.',404);
 if(b.grant)await env.DB.prepare('INSERT INTO client_access (client_id,user_id,granted_by) VALUES (?,?,?) ON CONFLICT DO NOTHING').bind(id,b.userId,actor.id).run();
 else await env.DB.prepare('DELETE FROM client_access WHERE client_id=? AND user_id=?').bind(id,b.userId).run();
 await audit(env,actor,b.grant?'client_access_granted':'client_access_removed',id+':'+b.userId);return {ok:true};
}
export async function personalActivities(request,env,actor){
 if(!['admin','coordinator','commercial'].includes(actor.role))throw new UserError('Seu perfil não tem acesso às atividades.',403);
 let row=await env.DB.prepare('SELECT * FROM user_activities WHERE user_id=?').bind(actor.id).first();
 if(request.method==='GET'){
  if(!row?.cache_key){const key=Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('');await env.DB.prepare("INSERT INTO user_activities (user_id,payload,revision,updated_at,cache_key) VALUES (?,'[]',0,?,?) ON CONFLICT(user_id) DO UPDATE SET cache_key=excluded.cache_key WHERE user_activities.cache_key IS NULL").bind(actor.id,new Date().toISOString(),key).run();row=await env.DB.prepare('SELECT * FROM user_activities WHERE user_id=?').bind(actor.id).first();}
  return {records:JSON.parse(row.payload),revision:row.revision,cacheKey:row.cache_key};
 }
 if(request.method!=='PUT')throw new UserError('Método não permitido.',405);
 if(!request.headers.get('content-type')?.startsWith('application/json'))throw new UserError('Formato inválido.',415);
 let b;try{b=JSON.parse(new TextDecoder().decode(await limitedBody(request,2*1024*1024)));}catch(e){if(e instanceof UserError)throw e;throw new UserError('Atividades inválidas.');}
 if(!Number.isSafeInteger(b.revision)||b.revision<0||!Array.isArray(b.records)||b.records.length>3000)throw new UserError('Atividades inválidas.');
 const seen=new Set();const records=b.records.map(r=>{
  if(!r||typeof r!=='object'||Array.isArray(r)||!Number.isSafeInteger(r.id)||seen.has(r.id)||r.importRecordId||typeof r.subject!=='string'||r.subject.length>500||typeof r.client!=='string'||r.client.length>180||typeof r.priority!=='string'||!['Normal','Alta','Urgente'].includes(r.priority))throw new UserError('Atividade inválida.');
  seen.add(r.id);const clean={...r};delete clean.__proto__;delete clean.constructor;delete clean.prototype;
  if(actor.role==='commercial')clean.owner=actor.consultantName;
  return clean;
 });
 if((row?.revision||0)!==b.revision)throw new UserError('Suas atividades foram atualizadas em outro dispositivo. Atualize antes de salvar.',409);
 const now=new Date().toISOString();
 const result=await env.DB.prepare('INSERT INTO user_activities (user_id,payload,revision,updated_at) VALUES (?,?,1,?) ON CONFLICT(user_id) DO UPDATE SET payload=excluded.payload,revision=user_activities.revision+1,updated_at=excluded.updated_at WHERE user_activities.revision=? RETURNING revision').bind(actor.id,JSON.stringify(records),now,b.revision).first();
 if(!result)throw new UserError('Atividades alteradas em outra sessão.',409);
 await audit(env,actor,'activities_saved',String(records.length));return {revision:result.revision};
}
export function secureResponse(response){
 const headers=new Headers(response.headers);
 headers.set('Referrer-Policy','strict-origin-when-cross-origin');
 headers.set('Permissions-Policy','camera=(), microphone=(), geolocation=()');
 headers.set('X-Content-Type-Options','nosniff');
 if(headers.get('content-type')?.startsWith('text/html'))headers.set('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self' http://127.0.0.1:19183; frame-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self' https://chatgpt.com https://*.chatgpt.com https://chat.openai.com");
 return new Response(response.body,{status:response.status,statusText:response.statusText,headers});
}
