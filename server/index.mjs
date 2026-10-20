import {maintenanceReset,resetApi} from './crm-reset.mjs';
import {serialApi} from './inventory-serials.mjs';
import {inventoryImportRemoval} from './inventory-import-removal.mjs';
import {maintenanceApi} from './maintenance.mjs';
import {requireClient,allowedClients,accessApi,personalActivities,secureResponse,audit} from './security.mjs';
import {salesHistory,previewSalesHistory,applySalesHistory} from './sales-history.mjs';
import {importBody,planImport,applyImport,importHistory,importedData,updateImported} from './imports.mjs';
import {marketPreview,marketApply,marketComplete,marketHistory,marketData} from './market-analysis.mjs';
import assets from './static-assets.generated.mjs';
import {UserError,parseEmail,limitedBody,clientKey,digest} from './email.mjs';
import {listOrders,saveOrder,listGoalActuals} from './orders.mjs';
import {inventoryApi} from './inventory.mjs';
import {inventoryImportApi} from './inventory-import.mjs';
import {listWorkflowOrders,advanceWorkflow} from './order-workflow.mjs';
import {listProfiles,saveProfile,savePreRegistration,deleteProfile,classifyProfile,assignConsultant} from './clients.mjs';
import {listCoverage} from './coverage.mjs';
import {currentUser,requireRole,listUsers,listConsultants,createUser,updateUser,login,logout,changePassword,resetPassword,setDefaultPassword,userAvatar} from './users.mjs';
import {readGoalSettings,saveGoalSettings} from './goals-settings.mjs';
import {readActivitySettings,saveActivitySettings} from './activity-settings.mjs';
import {listProjectStages,saveProjectStage} from './project-stages.mjs';

const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
function requireOrigin(request){const origin=request.headers.get('origin');if(origin && origin!==new URL(request.url).origin)throw new UserError('Origem não autorizada.',403);}
function context(url){const name=(url.searchParams.get('client') || '').trim(),state=(url.searchParams.get('state') || '').trim().toUpperCase();if(!name || name.length>180 || !/^[A-Z]{2}$/.test(state))throw new UserError('Selecione um cliente com estado definido.');return {name,state,key:clientKey(name,state)};}
function bindings(env){if(!env.DB || !env.BUCKET)throw new UserError('O armazenamento está temporariamente indisponível. Tente novamente.',503);}
async function lookupClient(env,c){return env.DB.prepare('SELECT * FROM history_clients WHERE legacy_key = ?').bind(c.key).first();}
async function ensureClient(env,c,actor=null){
 const existing=await lookupClient(env,c);if(existing){if(actor)await requireClient(env,actor,existing.id);return existing;}
 const row={id:crypto.randomUUID(),route_token:crypto.randomUUID().replaceAll('-','')};
 const statements=[env.DB.prepare('INSERT INTO history_clients (id,legacy_key,name,state,route_token,created_at) VALUES (?,?,?,?,?,?) ON CONFLICT(legacy_key) DO NOTHING').bind(row.id,c.key,c.name,c.state,row.route_token,new Date().toISOString())];
 if(actor?.role==='commercial')statements.push(env.DB.prepare('INSERT INTO client_access (client_id,user_id,granted_by) SELECT ?,?,? WHERE EXISTS (SELECT 1 FROM history_clients WHERE id=?) ON CONFLICT DO NOTHING').bind(row.id,actor.id,actor.id,row.id));
 await env.DB.batch(statements);
 const saved=await lookupClient(env,c);if(actor)await requireClient(env,actor,saved.id);return saved;
}
function inboundConfig(env,client){const enabled=env.BOREAL_INBOUND_ENABLED==='true' && /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(env.BOREAL_INBOUND_DOMAIN || '') && /^[a-z0-9._-]+$/i.test(env.BOREAL_INBOUND_LOCAL_PART || '') && (env.BOREAL_INGEST_KEY || '').length>=32;return {enabled,address:enabled && client ? `${env.BOREAL_INBOUND_LOCAL_PART}+${client.route_token}@${env.BOREAL_INBOUND_DOMAIN}` : null};}
async function emailData(env,row){const attachments=await env.DB.prepare('SELECT id,name,content_type AS contentType,size,content_id AS contentId,inline FROM history_attachments WHERE email_id = ?').bind(row.id).all();return {id:row.id,subject:row.subject,from:row.sender,to:JSON.parse(row.recipients),cc:JSON.parse(row.cc),date:row.sent_at,text:row.text_body,html:row.html_body,project:row.project,source:row.source,recordedAt:row.recorded_at,originalName:row.original_name,attachments:attachments.results || []};}
async function storeEmail(env,client,email,raw,filename,project,user,source){
  const duplicate=await env.DB.prepare('SELECT id FROM history_emails WHERE client_id = ? AND dedupe_key = ?').bind(client.id,email.dedupe).first();
  if(duplicate)return {id:duplicate.id,duplicate:true};
  const id=crypto.randomUUID(),root=`client-history/${client.id}/${id}`,originalKey=`${root}/original`,created=[];
  try {
    await env.BUCKET.put(originalKey,raw,{httpMetadata:{contentType:/\.msg$/i.test(filename)?'application/vnd.ms-outlook':'message/rfc822'}});created.push(originalKey);
    const statements=[env.DB.prepare('INSERT INTO history_emails (id,client_id,dedupe_key,subject,sender,recipients,cc,sent_at,text_body,html_body,project,source,original_key,original_name,author_id,recorded_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(id,client.id,email.dedupe,email.subject,email.from,JSON.stringify(email.to),JSON.stringify(email.cc),email.date,email.text,email.html,project.slice(0,200),source,originalKey,filename.slice(0,220),user,new Date().toISOString())];
    for(const attachment of email.attachments){const aid=crypto.randomUUID(),objectKey=`${root}/${aid}`;await env.BUCKET.put(objectKey,attachment.bytes,{httpMetadata:{contentType:attachment.type}});created.push(objectKey);statements.push(env.DB.prepare('INSERT INTO history_attachments (id,email_id,object_key,name,content_type,size,content_id,inline) VALUES (?,?,?,?,?,?,?,?)').bind(aid,id,objectKey,attachment.name,attachment.type,attachment.bytes.byteLength,attachment.cid,attachment.inline?1:0));}
    await env.DB.batch(statements);
    return {id,duplicate:false};
  } catch(error){
    // Reconcile first: a transient response failure must not delete a committed email's files.
    let current;try{current=await env.DB.prepare('SELECT id FROM history_emails WHERE client_id = ? AND dedupe_key = ?').bind(client.id,email.dedupe).first();}catch{throw error;}
    if(current?.id===id)return {id,duplicate:false};
    try{if(created.length)await env.BUCKET.delete(created);}catch{}
    if(current)return {id:current.id,duplicate:true};
    throw error;
  }
}
async function receiveCopy(request,env){
  if(!inboundConfig(env,null).enabled)throw new UserError('Recebimento automático ainda não configurado.',503);
  const key=request.headers.get('x-boreal-ingest-key') || '';
  if(await digest(new TextEncoder().encode(key))!==await digest(new TextEncoder().encode(env.BOREAL_INGEST_KEY)))throw new UserError('Acesso não autorizado.',401);
  const recipient=(request.headers.get('x-boreal-recipient') || '').trim().toLowerCase();
  const [local,domain]=recipient.split('@');const prefix=`${env.BOREAL_INBOUND_LOCAL_PART.toLowerCase()}+`;
  if(domain!==env.BOREAL_INBOUND_DOMAIN.toLowerCase() || !local?.startsWith(prefix))throw new UserError('Destinatário de acompanhamento inválido.');
  const token=local.slice(prefix.length);if(!/^[a-f0-9]{32}$/.test(token))throw new UserError('Endereço de acompanhamento inválido.');
  const client=await env.DB.prepare('SELECT * FROM history_clients WHERE route_token = ?').bind(token).first();
  if(!client)throw new UserError('Cliente não encontrado.',404);
  if(!request.headers.get('content-type')?.startsWith('message/rfc822'))throw new UserError('Envie a mensagem MIME original.',415);
  const raw=await limitedBody(request),email=await parseEmail(raw.buffer,'mensagem.eml');
  return json(await storeEmail(env,client,email,raw,'mensagem.eml','','email-receiver','bcc'),201);
}
async function api(request,env,url){
  bindings(env);
  if(url.pathname==='/api/client-history/inbound' && request.method==='POST')return receiveCopy(request,env);
  if(request.method!=='GET' && request.method!=='HEAD')requireOrigin(request);
  if(url.pathname==='/api/maintenance/crm-reset-20261020')return json(await maintenanceReset(request,env));
  if(url.pathname==='/api/auth/login' && request.method==='POST')return login(request,env);
  if(url.pathname==='/api/auth/logout' && request.method==='POST')return logout(request,env);
  const auth=await currentUser(request,env),user=auth.authId;
  const ensureForUser=(e,c)=>ensureClient(e,c,auth);
  if(url.pathname==='/api/auth/password' && request.method==='POST')return changePassword(request,env,auth);
  if(url.pathname==='/api/me' && request.method==='GET')return json({user:auth});
  const inventoryReset=url.pathname==='/api/inventory/reset'&&request.method==='POST';
  if(auth.mustChangePassword&&!inventoryReset)throw new UserError('Defina sua senha pessoal antes de continuar.',403);
  if(url.pathname==='/api/crm-reset')return json(await resetApi(request,env,auth));
  if(url.pathname==='/api/activities')return json(await personalActivities(request,env,auth));
  const accessMatch=url.pathname.match(/^\/api\/clients\/([a-f0-9-]{36})\/access$/);
  if(accessMatch)return json(await accessApi(request,env,auth,accessMatch[1]));
  if(auth.role==='commercial'){
    const profileId=url.pathname.match(/^\/api\/clients\/([a-f0-9-]{36})(?:\/classification)?$/)?.[1];
    if(profileId)await requireClient(env,auth,profileId);
    if(url.searchParams.has('client')&&['/api/client-history','/api/client-history/address','/api/client-history/import','/api/client-orders','/api/project-stages'].includes(url.pathname)){
      const client=await lookupClient(env,context(url));if(client)await requireClient(env,auth,client.id);
    }
    const privateId=url.pathname.match(/^\/api\/client-history\/(messages|files|original)\/([a-f0-9-]{36})$/);
    if(privateId){const row=privateId[1]==='files'?await env.DB.prepare('SELECT e.client_id FROM history_attachments a JOIN history_emails e ON e.id=a.email_id WHERE a.id=?').bind(privateId[2]).first():await env.DB.prepare('SELECT client_id FROM history_emails WHERE id=?').bind(privateId[2]).first();if(!row)throw new UserError('Documento não encontrado.',404);await requireClient(env,auth,row.client_id);}
  }
  if(url.pathname==='/api/maintenance'||url.pathname.startsWith('/api/maintenance/'))return json(await maintenanceApi(request,env,url,auth));
  if(url.pathname==='/api/users/default-password' && request.method==='PUT')return json(await setDefaultPassword(request,env,auth));
  const resetMatch=url.pathname.match(/^\/api\/users\/([a-f0-9-]{36})\/password$/);
  if(resetMatch && request.method==='POST')return json(await resetPassword(request,env,resetMatch[1],auth));
  if(url.pathname==='/api/users' && request.method==='GET'){requireRole(auth,'admin');return json(await listUsers(env));}
  if(url.pathname==='/api/consultants' && request.method==='GET'){requireRole(auth,'admin','coordinator','commercial');return json(await listConsultants(env));}
  if(url.pathname==='/api/users' && request.method==='POST')return json({user:await createUser(request,env,auth)},201);
  const avatarMatch=url.pathname.match(/^\/api\/users\/([a-f0-9-]{36})\/avatar$/);
  if(avatarMatch)return userAvatar(request,env,avatarMatch[1],auth);
  const userMatch=url.pathname.match(/^\/api\/users\/([a-f0-9-]{36})$/);
  if(userMatch && request.method==='PUT')return json({user:await updateUser(request,env,userMatch[1],auth)});
  if(url.pathname==='/api/sales-history' && request.method==='GET')return json(await salesHistory(env,auth));
  if(url.pathname==='/api/sales-history/preview' && request.method==='POST')return json(await previewSalesHistory(request,env,auth));
  if(url.pathname==='/api/sales-history/apply' && request.method==='POST')return json(await applySalesHistory(request,env,auth));
  if(url.pathname==='/api/goals/config' && request.method==='GET')return json(await readGoalSettings(env,auth));
  if(url.pathname==='/api/goals/config' && request.method==='PUT')return json(await saveGoalSettings(request,env,auth));
  if(url.pathname==='/api/activities/config' && request.method==='GET')return json(await readActivitySettings(env,auth));
  if(url.pathname==='/api/activities/config' && request.method==='PUT')return json(await saveActivitySettings(request,env,auth));
  if(url.pathname==='/api/imports/preview' && request.method==='POST'){const p=await planImport(env,await importBody(request),auth);return json({counts:p.counts,issues:p.issues,ready:p.ready.map(i=>({kind:i.kind,key:i.key,line:i.line,label:i.label,owner:i.owner}))});}
  if(url.pathname==='/api/imports/apply' && request.method==='POST')return json(await applyImport(env,await importBody(request),auth));
  if(url.pathname==='/api/imports/history' && request.method==='GET')return json(await importHistory(env,auth));
  if(url.pathname==='/api/imports/data' && request.method==='GET')return json(await importedData(env,auth));
  if(url.pathname==='/api/market/import/preview' && request.method==='POST')return json(await marketPreview(request,env,auth));
  if(url.pathname==='/api/market/import/apply' && request.method==='POST')return json(await marketApply(request,env,auth));
  if(url.pathname==='/api/market/import/complete' && request.method==='POST')return json(await marketComplete(request,env,auth));
  if(url.pathname==='/api/market/import/history' && request.method==='GET')return json(await marketHistory(env,auth));
  if(url.pathname==='/api/market-analysis' && request.method==='GET')return json(await marketData(env,auth,url.searchParams.get('state')||'MG'));
  const importedMatch=url.pathname.match(/^\/api\/imports\/activities\/(\d+)$/);
  if(importedMatch && request.method==='PUT')return json(await updateImported(env,Number(importedMatch[1]),await importBody(request),auth));
  const cepMatch=url.pathname.match(/^\/api\/cep\/([0-9]{8})$/);
  if(cepMatch && request.method==='GET'){
    requireRole(auth,'admin','coordinator','commercial','dispatch','maintenance','stock');
    let response;
    try{response=await fetch(`https://viacep.com.br/ws/${cepMatch[1]}/json/`,{signal:AbortSignal.timeout(6000)});}catch{throw new UserError('Consulta de CEP indisponível. Preencha o endereço manualmente.',503);}
    if(!response.ok)throw new UserError('Consulta de CEP indisponível. Preencha o endereço manualmente.',503);
    let address;try{address=await response.json();}catch{throw new UserError('Consulta de CEP indisponível. Preencha o endereço manualmente.',503);}
    if(address.erro)throw new UserError('CEP não encontrado. Confira o número ou preencha o endereço manualmente.',404);
    if(address.cep?.replace(/\D/g,'')!==cepMatch[1] || !address.localidade || !address.uf)throw new UserError('Consulta de CEP indisponível. Preencha o endereço manualmente.',503);
    return json({street:address.logradouro||'',district:address.bairro||'',city:address.localidade,state:address.uf});
  }
  if(url.pathname==='/api/clients' && request.method==='GET'){requireRole(auth,'admin','coordinator','commercial');return json({clients:await listProfiles(env,auth)});}
  if(url.pathname==='/api/coverage' && request.method==='GET'){requireRole(auth,'admin','coordinator','commercial');return json(await listCoverage(env));}
  if(url.pathname==='/api/goals/actuals' && request.method==='GET'){
    requireRole(auth,'admin','coordinator','commercial');
    const year=Number(url.searchParams.get('year'));
    if(!Number.isSafeInteger(year) || year<2000 || year>2100)throw new UserError('Informe um ano válido para a meta.');
    const result=await listGoalActuals(env,year);
    if(auth.role==='commercial'){
      const matched=Object.keys(result.monthly).find(name=>name.toLocaleLowerCase('pt-BR')===auth.consultantName.toLocaleLowerCase('pt-BR'));
      const companyMonthly=Array.from({length:12},(_,index)=>Object.values(result.monthly).reduce((total,months)=>total+(months[index]||0),0));
      return json({year,monthly:matched?{[matched]:result.monthly[matched]}:{},companyMonthly,orderCount:result.orderCount,historicalMonthCount:result.historicalMonthCount,coveredOrderCount:result.coveredOrderCount});
    }
    return json(result);
  }
  if(url.pathname==='/api/clients' && request.method==='POST'){requireRole(auth,'admin','coordinator','commercial');return json({client:await saveProfile(request,env,null,ensureForUser,user,auth)},201);}
  if(url.pathname==='/api/clients/pre-registration' && request.method==='POST'){requireRole(auth,'admin','coordinator','commercial');return json({client:await savePreRegistration(request,env,ensureForUser,user,auth)});}
  const clientMatch=url.pathname.match(/^\/api\/clients\/([a-f0-9-]{36})$/);
  if(clientMatch && request.method==='PUT'){requireRole(auth,'admin','coordinator','commercial');return json({client:await saveProfile(request,env,clientMatch[1],ensureForUser,user)});}
  if(clientMatch && request.method==='DELETE'){requireRole(auth,'admin');return json(await deleteProfile(request,env,clientMatch[1]));}
  const classificationMatch=url.pathname.match(/^\/api\/clients\/([a-f0-9-]{36})\/classification$/);
  if(classificationMatch && request.method==='PATCH'){requireRole(auth,'admin','coordinator','commercial');return json({client:await classifyProfile(request,env,classificationMatch[1],user)});}
  const consultantMatch=url.pathname.match(/^\/api\/clients\/([a-f0-9-]{36})\/consultant$/);
  if(consultantMatch && request.method==='PATCH'){requireRole(auth,'admin','coordinator');return json(await assignConsultant(request,env,consultantMatch[1],user));}
  if(url.pathname==='/api/client-orders' && request.method==='GET'){requireRole(auth,'admin','coordinator','commercial');const orders=await listOrders(env,await lookupClient(env,context(url)));return json({orders:auth.role==='commercial'?orders.filter(order=>order.snapshot.consultant.toLocaleLowerCase('pt-BR')===auth.consultantName.toLocaleLowerCase('pt-BR')):orders});}
  if(url.pathname==='/api/project-stages' && request.method==='GET'){requireRole(auth,'admin','coordinator','commercial');return json({stages:await listProjectStages(env,await lookupClient(env,context(url)))});}
  if(url.pathname==='/api/project-stages' && request.method==='PUT'){requireRole(auth,'admin','coordinator','commercial');const client=await ensureForUser(env,context(url));return json({project:await saveProjectStage(request,env,client,user)});}
  if(url.pathname.startsWith('/api/inventory/import-trash')||/^\/api\/inventory\/imports\/[^/]+\/removal$/.test(url.pathname))return json(await inventoryImportRemoval(request,env,url,auth,user));
  if(url.pathname.startsWith('/api/inventory/imports'))return json(await inventoryImportApi(request,env,url,auth,user));
  if(url.pathname.startsWith('/api/inventory/serial-stock'))return json(await serialApi(request,env,url,auth,user));
  if(url.pathname==='/api/inventory'||url.pathname.startsWith('/api/inventory/'))return json(await inventoryApi(request,env,url,auth,user));
  if(url.pathname==='/api/orders/workflow' && request.method==='GET'){requireRole(auth,'admin','coordinator','commercial','stock','maintenance','dispatch');const result=await listWorkflowOrders(env);if(auth.role==='maintenance')result.orders=result.orders.filter(order=>['maintenance','maintenance_in_progress','dispatch_pending','dispatch_preparing','dispatched','completed'].includes(order.status));if(auth.role==='dispatch')result.orders=result.orders.filter(order=>['dispatch_pending','dispatch_preparing','dispatched','completed'].includes(order.status));return json({...result,orders:auth.role==='commercial'?result.orders.filter(order=>order.snapshot.consultant.toLocaleLowerCase('pt-BR')===auth.consultantName.toLocaleLowerCase('pt-BR')):result.orders});}
  const workflowMatch=url.pathname.match(/^\/api\/orders\/workflow\/([a-f0-9-]{36})$/);
  if(workflowMatch && request.method==='POST'){
    const actionModule={stock:'stock',maintenance:'maintenance',dispatch:'dispatch'}[auth.role];
    if(auth.role!=='admin' && (!actionModule || (await request.clone().json().catch(()=>({}))).module!==actionModule))throw new UserError('Seu cargo acompanha este pedido sem permissão para movimentá-lo.',403);
    return json(await advanceWorkflow(request,env,workflowMatch[1],user));
  }
  if(url.pathname==='/api/client-orders' && request.method==='POST'){
    requireRole(auth,'admin','coordinator','commercial');
    const result=await saveOrder(request,env,context(url),ensureForUser,user,auth);return json(result,result.created?201:200);
  }
  if(url.pathname==='/api/client-history' && request.method==='GET'){
    requireRole(auth,'admin','coordinator','commercial');
    const c=context(url),client=await lookupClient(env,c);if(!client)return json({emails:[],hasMore:false,nextOffset:0,inbound:inboundConfig(env,null)});
    const offset=Number(url.searchParams.get('offset') || 0);if(!Number.isSafeInteger(offset) || offset<0)throw new UserError('Página inválida.');
    const rows=await env.DB.prepare("SELECT id,subject,sender,recipients,cc,sent_at,substr(text_body,1,220) AS text_body,'' AS html_body,project,source,recorded_at,original_name FROM history_emails WHERE client_id = ? ORDER BY COALESCE(sent_at,recorded_at) DESC, id DESC LIMIT 31 OFFSET ?").bind(client.id,offset).all();
    return json({emails:await Promise.all((rows.results || []).slice(0,30).map(row=>emailData(env,row))),hasMore:rows.results.length>30,nextOffset:offset+30,inbound:inboundConfig(env,client)});
  }
  const messageMatch=url.pathname.match(/^\/api\/client-history\/messages\/([a-f0-9-]{36})$/);
  if(messageMatch && request.method==='GET'){requireRole(auth,'admin','coordinator','commercial');const row=await env.DB.prepare('SELECT * FROM history_emails WHERE id = ?').bind(messageMatch[1]).first();if(!row)throw new UserError('Mensagem não encontrada.',404);return json(await emailData(env,row));}
  if(url.pathname==='/api/client-history/address' && request.method==='POST'){
    requireRole(auth,'admin','coordinator','commercial');
    if(!inboundConfig(env,null).enabled)throw new UserError('O endereço ficará disponível após a configuração da caixa de recebimento.',409);
    const client=await ensureForUser(env,context(url));return json(inboundConfig(env,client));
  }
  if(url.pathname==='/api/client-history/import' && request.method==='POST'){
    requireRole(auth,'admin','coordinator','commercial');
    const c=context(url),body=await limitedBody(request);
    let form;try{form=await new Response(body,{headers:{'Content-Type':request.headers.get('content-type') || ''}}).formData();}catch{throw new UserError('Selecione novamente o arquivo do Outlook.');}
    const file=form.get('email');if(!file || typeof file.arrayBuffer!=='function')throw new UserError('Selecione o arquivo do e-mail.');
    const raw=await file.arrayBuffer();let email;
    try{email=await parseEmail(raw,file.name);}catch(error){if(error instanceof UserError)throw error;throw new UserError('Não foi possível ler a mensagem. Exporte novamente como EML ou MSG pelo Outlook.');}
    const client=await ensureForUser(env,c),saved=await storeEmail(env,client,email,raw,file.name,String(form.get('project') || ''),user,'outlook-file');return json(saved,saved.duplicate?200:201);
  }
  const fileMatch=url.pathname.match(/^\/api\/client-history\/(files|original)\/([a-f0-9-]{36})$/);
  if(fileMatch && request.method==='GET'){
    requireRole(auth,'admin','coordinator','commercial');
    const [,kind,id]=fileMatch;
    const record=kind==='files'?await env.DB.prepare('SELECT object_key,name,content_type FROM history_attachments WHERE id = ?').bind(id).first():await env.DB.prepare('SELECT original_key AS object_key,original_name AS name FROM history_emails WHERE id = ?').bind(id).first();
    if(!record)throw new UserError('Arquivo não encontrado.',404);
    const object=await env.BUCKET.get(record.object_key);if(!object)throw new UserError('O arquivo está indisponível. Tente novamente.',503);
    const type=record.content_type || 'application/octet-stream';const inline=url.searchParams.get('inline')==='1' && /^(application\/pdf|image\/(png|jpeg|gif|webp))$/.test(type);
    return new Response(object.body,{headers:{'Content-Type':type,'Content-Length':String(object.size),'Content-Disposition':`${inline?'inline':'attachment'}; filename*=UTF-8''${encodeURIComponent(record.name).replace(/'/g,'%27')}`,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"sandbox; default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'"}});
  }
  throw new UserError('Recurso não encontrado.',404);
}

const handler={async fetch(request,env){const url=new URL(request.url);try{
  if(url.pathname.startsWith('/api/'))return await api(request,env,url);
  if(!['GET','HEAD'].includes(request.method))return new Response('Método não permitido',{status:405});
  const asset=assets[url.pathname==='/'?'/index.html':url.pathname];if(!asset)return new Response('Página não encontrada',{status:404});
  const data=request.method==='HEAD'?null:Uint8Array.from(atob(asset.data),char=>char.charCodeAt(0));
  return new Response(data,{headers:{'Content-Type':asset.type,'Cache-Control':/^(text\/html|text\/javascript|text\/css)/.test(asset.type)?'no-cache, must-revalidate':'public, max-age=3600','X-Content-Type-Options':'nosniff'}});
}catch(error){if(error instanceof UserError)return json({error:error.message},error.status);console.error('Client history request failed',{path:url.pathname,error:error.name});return json({error:'Não foi possível concluir agora. Seus dados não foram alterados; tente novamente.'},503);}}};

export default {async fetch(request,env){return secureResponse(await handler.fetch(request,env));}};
