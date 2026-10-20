import '../public/assets/activity-identity.js';
import {UserError,limitedBody,clientKey} from './email.mjs';
import {requireRole,listConsultants} from './users.mjs';
const norm=v=>String(v||'').trim().normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,' ');
const str=(v,max=200)=>String(v??'').trim().slice(0,max);
// Keep paragraph boundaries while removing empty lines accumulated by Pipedrive exports.
function importedNoteText(value){
 const entities={nbsp:' ',amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"};
 return String(value??'').replace(/\r\n?/g,'\n')
  .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,'')
  .replace(/<br\s*\/?\s*>|<\/?(?:div|p|li|blockquote|tr|h[1-6])\b[^>]*>/gi,'\n')
  .replace(/<[^>]*>/g,'')
  .replace(/&(#x[0-9a-f]+|#\d+|nbsp|amp|lt|gt|quot|apos);/gi,(match,entity)=>{
   if(entity[0]!=='#')return entities[entity.toLowerCase()];
   const code=entity[1].toLowerCase()==='x'?parseInt(entity.slice(2),16):Number(entity.slice(1));
   return code>0&&code<=0x10ffff?String.fromCodePoint(code):match;
  })
  .replace(/\u00a0/g,' ').replace(/[ \t]+\n/g,'\n').replace(/\n[ \t]+/g,'\n')
  .replace(/\n{3,}/g,'\n\n').trim().slice(0,50000);
}
const compactNoteText=value=>String(value??'').replace(/\r\n?/g,'\n').replace(/[ \t\u00a0]+\n/g,'\n').replace(/\n[ \t\u00a0]+/g,'\n').replace(/\n{3,}/g,'\n\n').trim();
const kinds=['Clientes','Contatos','Negócios','Atividades'];
const fields={Clientes:['nome','cliente_id'],Contatos:['nome','contato_id'],Negócios:['titulo','negocio_id'],Atividades:['assunto','atividade_id']};
const external={Clientes:'id_pipedrive_organizacao',Contatos:'id_pipedrive_pessoa',Negócios:'id_pipedrive_negocio',Atividades:'id_pipedrive_atividade'};
export async function importBody(request){try{return JSON.parse(new TextDecoder().decode(await limitedBody(request,20*1024*1024)));}catch(e){if(e instanceof UserError)throw e;throw new UserError('Arquivo inválido.');}}
export async function planImport(env,body,auth){
 requireRole(auth,'admin');
 if(!Array.isArray(body.rows)||body.rows.length>50000)throw new UserError('Importe até 50.000 registros por arquivo.');
 const owners=(await listConsultants(env)).consultants;
 const existing=(await env.DB.prepare('SELECT kind,source_key,client_id,id FROM import_records').all()).results||[];
 const profiles=(await env.DB.prepare('SELECT id,payload FROM client_profiles').all()).results||[];
 const names=new Map();for(const p of profiles){const data=JSON.parse(p.payload),n=norm(data.legalName);names.set(n,[...(names.get(n)||[]),{id:p.id,...data}]);}
 for(const h of (await env.DB.prepare('SELECT id,name,state FROM history_clients WHERE id NOT IN (SELECT id FROM client_profiles)').all()).results||[]){const n=norm(h.name);names.set(n,[...(names.get(n)||[]),{id:h.id,legalName:h.name,state:h.state,historyOnly:true}]);}
 const seen=new Set(existing.map(r=>r.kind+'|'+r.source_key));
 const clients=new Map(existing.filter(r=>r.kind==='Clientes').map(r=>[r.source_key,r.client_id]));
 const issues=[],ready=[],counts={selected:0,ready:0,duplicates:0,excluded:0,issues:0};
 const rows=body.rows.map((v,i)=>({...v,line:v.line||i+2})).sort((a,b)=>kinds.indexOf(a.kind)-kinds.indexOf(b.kind));
 for(const input of rows){const {kind,row,line}=input;if(!kinds.includes(kind)||!row||typeof row!=='object')throw new UserError('Selecione Clientes, Contatos, Negócios ou Atividades.');
  if(norm(row.importar)!=='sim'){counts.excluded++;continue;}counts.selected++;
  const [nameField,idField]=fields[kind],key=str(row[idField]||row[external[kind]],100),label=str(row[nameField]);
  const issue=message=>issues.push({kind,line,label,message});
  if(!key||!label){issue('Nome/título e ID de origem são obrigatórios.');continue;}
  if(seen.has(kind+'|'+key)){counts.duplicates++;continue;}
  const requested=str(body.mapping?.[row.consultor_destino]||body.mapping?.[row.proprietario_original]||body.mapping?.[row.responsavel_original]||row.consultor_destino);
  const owner=owners.find(o=>norm(o)===norm(requested));
  if(!owner){issue('Consultor não encontrado no cadastro ativo. Faça o mapeamento.');continue;}
  let clientId;
  if(kind==='Clientes'){
   const matches=names.get(norm(label))||[],state=str(row.estado,2).toUpperCase();
   if(state&&!/^(AC|AL|AP|AM|BA|CE|DF|ES|GO|MA|MT|MS|MG|PA|PB|PR|PE|PI|RJ|RN|RS|RO|RR|SC|SP|SE|TO)$/.test(state)){issue('UF inválida. Corrija o arquivo.');continue;}
   const match=matches.find(p=>p.state===state)||(matches.length===1?matches[0]:null);
   if(matches.length>1&&!match){issue('Mais de um cliente com este nome. Informe a UF.');continue;}
   clientId=match?.id||crypto.randomUUID();clients.set(key,clientId);if(!match)names.set(norm(label),[{id:clientId,legalName:label,state}]);
   ready.push({kind,key,label,row,owner,clientId,existingClient:!!match&&!match.historyOnly,historyClient:!!match?.historyOnly,line});
  }else{
   clientId=clients.get(str(row.cliente_id));
   if(!clientId){const matches=names.get(norm(row.cliente_nome))||[];if(matches.length===1)clientId=matches[0].id;}
   if(!clientId){issue('Cliente não identificado ou com pendência. Importe/corrija o cliente primeiro.');continue;}
   ready.push({kind,key,label,row,owner,clientId,line});
  }
  seen.add(kind+'|'+key);
 }
 counts.ready=ready.length;counts.issues=issues.length;return {ready,issues,counts,owners};
}
export async function applyImport(env,body,auth){
 if(body.rows?.length>100)throw new UserError('Envie até 100 registros por lote.');
 const plan=await planImport(env,body,auth),statements=[],now=new Date().toISOString();
 for(const item of plan.ready){const {kind,key,label,row,owner,clientId}=item;
  if(kind==='Clientes'&&!item.existingClient){
   const state=str(row.estado,2).toUpperCase();
   const profile={legalName:label,tradeName:'',segment:str(row.setor,100),state,cnpj:'',icmsStatus:'taxpayer',stateRegistration:'',municipalRegistration:'',commercial:{name:'',email:'',phone:''},financial:{name:'',email:'',phone:''},equipment:'',software:'',hasBought:'no',lastSaleDate:'',lastSaleDescription:'',delivery:{recipient:'',postalCode:str(row.cep,9).replace(/\D/g,''),street:str(row.endereco),number:'',complement:'',district:'',city:str(row.cidade,120),state},imported:true,consultant:owner};
   if(!item.historyClient)statements.push(env.DB.prepare('INSERT INTO history_clients (id,legacy_key,name,state,route_token,created_at) VALUES (?,?,?,?,?,?)').bind(clientId,clientKey(label,state),label,state,crypto.randomUUID().replaceAll('-',''),now));
   statements.push(env.DB.prepare('INSERT INTO client_profiles (id,cnpj,payload,revision,author_id,updated_by,created_at,updated_at) VALUES (?,NULL,?,1,?,?,?,?)').bind(clientId,JSON.stringify(profile),auth.authId,auth.authId,now,now));
  }
  const payload=JSON.stringify({row,owner,label});if(payload.length>60000)throw new UserError('Uma linha excede o limite de texto. Reduza as observações para até 60.000 caracteres.');
  statements.push(env.DB.prepare('INSERT INTO import_records (kind,source_key,client_id,payload,revision,author_id,created_at) VALUES (?,?,?,?,1,?,?)').bind(kind,key,clientId,payload,auth.authId,now));
 }
 if(statements.length){statements.push(env.DB.prepare('INSERT INTO import_batches (id,filename,summary,author_id,created_at) VALUES (?,?,?,?,?)').bind(crypto.randomUUID(),str(body.filename),JSON.stringify(plan.counts),auth.authId,now));try{await env.DB.batch(statements);}catch(e){if(/unique|constraint/i.test(e.message))throw new UserError('Os dados mudaram durante a importação. Gere uma nova prévia antes de continuar.',409);throw e;}}
 return {counts:plan.counts,issues:plan.issues};
}
export async function importHistory(env,auth){requireRole(auth,'admin');return {batches:(await env.DB.prepare('SELECT filename,summary,created_at FROM import_batches ORDER BY created_at DESC LIMIT 50').all()).results||[]};}
export async function importedData(env,auth){
 requireRole(auth,'admin','coordinator','commercial');
 const records=(await env.DB.prepare("SELECT r.*,p.payload AS profile FROM import_records r JOIN client_profiles p ON p.id=r.client_id WHERE r.kind IN ('Atividades','Negócios') ORDER BY r.id").all()).results||[];
 const contacts=(await env.DB.prepare("SELECT client_id,payload FROM import_records WHERE kind='Contatos' ORDER BY id").all()).results||[];
 const activities=[],projects=[];
 for(const r of records){const saved=JSON.parse(r.payload),p=JSON.parse(r.profile),row=saved.row;
 if(auth.role==='commercial'&&norm(saved.owner)!==norm(auth.consultantName))continue;
 const contactRows=contacts.filter(c=>c.client_id===r.client_id).map(c=>JSON.parse(c.payload).row),contact=contactRows.find(c=>norm(c.nome)===norm(row.contato_nome))||(globalThis.BorealActivityIdentity.group(p.legalName)?{}:contactRows[0])||{};
 const common={client:p.legalName,state:p.state,clientProfileId:r.client_id,owner:saved.owner,segment:p.segment||'Não informado',software:p.software||str(row.software)||null,contact:str(row.contato_nome||contact.nome),phone:contact.celular||contact.telefone||(!globalThis.BorealActivityIdentity.group(p.legalName)?p.commercial?.phone:'')||'',email:contact.email||(!globalThis.BorealActivityIdentity.group(p.legalName)?p.commercial?.email:'')||'',organization:globalThis.BorealActivityIdentity.group(p.legalName)||p.segment||''};
 if(r.kind==='Atividades'){const activity={...common,id:8000000000000+r.id,importRecordId:r.id,revision:r.revision,subject:saved.label,project:str(row.negocio_titulo),projectExplicit:true,type:str(row.tipo)||'Tarefa',date:str(row.data_vencimento,10),time:str(row.hora_vencimento,5),endTime:'',priority:['Alta','Urgente'].includes(row.prioridade)?row.prioridade:'Normal',description:importedNoteText(row.nota),descriptionHtml:'',notes:[],completed:norm(row.concluida)==='sim',stage:'Contato',value:0,...saved.activity};if(!activity.descriptionHtml&&!activity.descriptionSegments?.length)activity.description=compactNoteText(activity.description);activities.push(globalThis.BorealActivityIdentity.resolve(activity));}
 else if(norm(row.status)!=='perdido')projects.push({...common,id:r.id,stage:norm(row.status)==='ganho'?'Concluído':norm(row.etapa).includes('proposta')?'Proposta':norm(row.etapa).includes('projeto')?'Projeto':'Contato',project:saved.label,value:0,date:str(row.proxima_atividade,10),ownerName:saved.owner,note:'Importado do Pipedrive. Valor não informado.',owner:saved.owner.split(' ').map(v=>v[0]).slice(0,2).join('')});
 }
 const orderTotals=new Map();
 const orders=(await env.DB.prepare('SELECT o.*,p.payload AS profile,h.name,h.state FROM client_orders o JOIN history_clients h ON h.id=o.client_id LEFT JOIN client_profiles p ON p.id=o.client_id ORDER BY o.updated_at').all()).results||[];
 for(const row of orders){let order,profile={};try{order=JSON.parse(row.payload);if(row.profile)profile=JSON.parse(row.profile);}catch{continue;}const snapshot=order?.snapshot||{},ownerName=str(snapshot.consultant,160);if(auth.role==='commercial'&&norm(ownerName)!==norm(auth.consultantName))continue;const projectName=str(snapshot.project),clientName=str(snapshot.client||profile.legalName||row.name),state=str(snapshot.state||profile.state||row.state,2).toUpperCase();if(!projectName||!clientName)continue;const existing=projects.find(project=>norm(project.client)===norm(clientName)&&project.state===state&&norm(project.project)===norm(projectName)),closed={id:`order-${row.id}`,stage:row.status==='completed'?'Concluído':'Aprovado',segment:profile.segment||existing?.segment||'Não informado',client:clientName,state,clientProfileId:row.client_id,project:projectName,value:Number(order.orderValue)||0,date:str(row.updated_at,10),ownerName,note:str(order.notes,3000)||'Valor fechado conforme pedido.',owner:ownerName.split(' ').map(value=>value[0]).slice(0,2).join('').toUpperCase(),contact:str(snapshot.contact),phone:str(snapshot.phone),email:str(snapshot.email),organization:profile.tradeName||profile.legalName||clientName,software:snapshot.software||profile.software||null};const key=clientName+'|'+state+'|'+norm(projectName);const total=orderTotals.get(key)||{value:0,allComplete:true,latest:null};total.value+=Number(order.orderValue)||0;total.allComplete&&=row.status==='completed';if(!total.latest)total.latest=existing||closed;orderTotals.set(key,total);if(!existing)projects.push(closed);
 }
 for(const total of orderTotals.values())Object.assign(total.latest,{value:total.value,stage:total.allComplete?'Concluído':'Aprovado'});
 return {activities,projects:projects.map(globalThis.BorealActivityIdentity.resolve)};
}
export async function updateImported(env,id,body,auth){
 requireRole(auth,'admin','coordinator','commercial');const r=await env.DB.prepare("SELECT * FROM import_records WHERE id=? AND kind='Atividades'").bind(id).first();if(!r)throw new UserError('Atividade não encontrada.',404);
 const saved=JSON.parse(r.payload);if(auth.role==='commercial'&&norm(saved.owner)!==norm(auth.consultantName))throw new UserError('Acesso não autorizado.',403);
 if(body.revision!==r.revision)throw new UserError('Atividade alterada em outra sessão. Atualize a página.',409);
 const a=body.activity;if(!a||!str(a.subject)||typeof a.completed!=='boolean')throw new UserError('Atividade inválida.');
 const owner=(await listConsultants(env)).consultants.find(o=>norm(o)===norm(a.owner));if(!owner||(auth.role==='commercial'&&norm(owner)!==norm(auth.consultantName)))throw new UserError('Consultor inválido.');
 let verifiedClientProfileId=null;if(str(a.clientProfileId)){const linked=await env.DB.prepare('SELECT payload FROM client_profiles WHERE id=?').bind(str(a.clientProfileId)).first();if(linked&&norm(JSON.parse(linked.payload).legalName)===norm(a.client))verifiedClientProfileId=str(a.clientProfileId);}
 saved.owner=owner;saved.activity={...(saved.activity||{}),...(str(a.client)?{client:str(a.client),state:str(a.state,2).toUpperCase(),clientProfileId:verifiedClientProfileId,identityOriginal:a.identityOriginal||null,organization:str(a.organization),contact:str(a.contact),email:str(a.email,254),phone:str(a.phone,60)}:{}),subject:str(a.subject),project:str(a.project),stage:['Contato','Proposta','Projeto','Aprovado','Concluído'].includes(a.stage)?a.stage:'Contato',type:str(a.type),date:str(a.date,10),time:str(a.time,5),endTime:str(a.endTime,5),priority:['Normal','Alta','Urgente'].includes(a.priority)?a.priority:'Normal',description:str(a.description,50000),descriptionHtml:str(a.descriptionHtml,50000),completed:a.completed,notes:Array.isArray(a.notes)?a.notes.slice(0,200):[]};
 const result=await env.DB.prepare('UPDATE import_records SET payload=?,revision=revision+1 WHERE id=? AND revision=?').bind(JSON.stringify(saved),id,body.revision).run();if(result.meta?.changes===0||result.changes===0)throw new UserError('Atividade alterada em outra sessão. Atualize a página.',409);return {revision:r.revision+1};
}
