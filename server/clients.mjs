import '../public/assets/activity-identity.js';
import {UserError,limitedBody,clientKey} from './email.mjs';
import {allowedClients,requireClient} from './security.mjs';
import {listConsultants} from './users.mjs';

const states=new Set('AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO'.split(' '));
const classifications=new Set(['','Concessionária','Indústria','Varejo','Empreiteiro']);
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
function clean(value,label,max,required=false){
  if(value==null)value='';
  if(typeof value!=='string' || value.length>max)throw new UserError(`${label}: informe até ${max} caracteres.`);
  value=value.trim();if(required && !value)throw new UserError(`Preencha ${label.toLocaleLowerCase('pt-BR')}.`);return value;
}
function record(value){return value && typeof value==='object' && !Array.isArray(value);}
function contact(value,label){if(!record(value))throw new UserError(`Informe os dados do contato ${label}.`);return {name:clean(value.name,`Nome do contato ${label}`,180),email:clean(value.email,`E-mail do contato ${label}`,254),phone:clean(value.phone,`Telefone do contato ${label}`,60)};}
function isCnpj(value){
  if(!/^\d{14}$/.test(value) || /^(\d)\1{13}$/.test(value))return false;
  const check=weights=>{const sum=weights.reduce((total,w,i)=>total+Number(value[i])*w,0),rest=sum%11;return rest<2?0:11-rest;};
  return check([5,4,3,2,9,8,7,6,5,4,3,2])===Number(value[12]) && check([6,5,4,3,2,9,8,7,6,5,4,3,2])===Number(value[13]);
}
function date(value){if(!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;const result=new Date(`${value}T00:00:00Z`);return !Number.isNaN(result.getTime()) && result.toISOString().slice(0,10)===value;}
function validate(body){
  if(!record(body) || !record(body.profile))throw new UserError('Preencha o cadastro do cliente.');
  const p=body.profile;
  const profile={legalName:clean(p.legalName,'Razão social',180,true),tradeName:clean(p.tradeName,'Nome fantasia',180),segment:clean(p.segment,'Segmento',100),state:clean(p.state,'UF da empresa',2,true).toUpperCase(),icmsStatus:p.icmsStatus,cnpj:String(p.cnpj||'').replace(/\D/g,''),stateRegistration:clean(p.stateRegistration,'Inscrição estadual',40),municipalRegistration:clean(p.municipalRegistration,'Inscrição municipal',40),consultant:clean(p.consultant,'Consultor responsável',180),commercial:contact(p.commercial,'comercial'),financial:contact(p.financial,'financeiro'),equipment:clean(p.equipment,'Equipamentos em uso',1500),software:clean(p.software,'Software em uso',200),hasBought:p.hasBought,lastSaleDate:clean(p.lastSaleDate,'Data da última venda',10),lastSaleDescription:clean(p.lastSaleDescription,'Descrição da última venda',400)};
  profile.legalName=profile.legalName.replace(/\s+/g,' ');
  if(!states.has(profile.state))throw new UserError('Selecione uma UF válida para a empresa.');
  if(!['taxpayer','exempt'].includes(profile.icmsStatus))throw new UserError('Selecione se o cliente é contribuinte ou isento de ICMS.');
  if(!isCnpj(profile.cnpj))throw new UserError('Informe um CNPJ válido.');
  if(!['yes','no'].includes(profile.hasBought))throw new UserError('Informe se a empresa já comprou da Boreal.');
  if(profile.hasBought==='yes' && (!date(profile.lastSaleDate) || !profile.lastSaleDescription))throw new UserError('Informe a data e o que foi vendido na última compra.');
  if(profile.hasBought==='no'){profile.lastSaleDate='';profile.lastSaleDescription='';}
  if(!record(p.delivery))throw new UserError('Preencha o endereço de entrega.');
  const d=p.delivery;profile.delivery={recipient:clean(d.recipient,'Destinatário',180),postalCode:clean(d.postalCode,'CEP',9).replace(/\D/g,''),street:clean(d.street,'Logradouro',200),number:clean(d.number,'Número',30),complement:clean(d.complement,'Complemento',160),district:clean(d.district,'Bairro',120),city:clean(d.city,'Município',120),state:clean(d.state,'UF de entrega',2).toUpperCase()};
  if(profile.delivery.postalCode && !/^\d{8}$/.test(profile.delivery.postalCode))throw new UserError('O CEP deve ter 8 dígitos.');
  if(profile.delivery.state && !states.has(profile.delivery.state))throw new UserError('Selecione uma UF de entrega válida.');
  for(const c of [profile.commercial,profile.financial])if(c.email && (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.email) || c.email.length>254))throw new UserError('Verifique os e-mails de contato.');
  return profile;
}
function origin(body,profile){
  if(body.origin==null)return null;
  if(!record(body.origin))throw new UserError('Referência do cliente inválida.');
  const name=clean(body.origin.name,'Cliente original',180,true).replace(/\s+/g,' '),state=clean(body.origin.state,'UF original',2,true).toUpperCase();
  if(!states.has(state))throw new UserError('UF original inválida.');return {name,state};
}
export function profileData(row){const payload=JSON.parse(row.payload);if(!payload.icmsStatus)payload.icmsStatus=payload.isCnpjExempt==='yes'?'exempt':'taxpayer';delete payload.isCnpjExempt;return {id:row.id,revision:row.revision,origin:row.origin_name?{name:row.origin_name,state:row.origin_state}:null,createdAt:row.created_at,updatedAt:row.updated_at,...payload};}
export async function listProfiles(env,actor){const allowed=actor?await allowedClients(env,actor):null;const rows=await env.DB.prepare('SELECT * FROM client_profiles ORDER BY created_at DESC, id DESC').all();const contacts=(await env.DB.prepare("SELECT client_id,payload FROM import_records WHERE kind='Contatos' ORDER BY id").all()).results||[];return (rows.results||[]).filter(row=>!allowed||allowed.has(row.id)).map(row=>{const p=profileData(row);p.importContacts=contacts.filter(c=>c.client_id===p.id).map(c=>{const r=JSON.parse(c.payload).row;return {name:r.nome||'',email:r.email||'',phone:r.celular||r.telefone||'',role:r.cargo||''};});if(!p.commercial.name&&p.importContacts.length)p.commercial=p.importContacts[0];return p;}).filter(profile=>!globalThis.BorealActivityIdentity.group(profile.legalName));}
export async function saveProfile(request,env,id,ensureClient,user,actor){
  if(!request.headers.get('content-type')?.startsWith('application/json'))throw new UserError('Formato do cadastro inválido.',415);
  let body;try{body=JSON.parse(new TextDecoder().decode(await limitedBody(request,64*1024)));}catch(error){if(error instanceof UserError)throw error;throw new UserError('Os dados do cadastro são inválidos.');}
  const profile=validate(body),cnpj=profile.cnpj||null,key=clientKey(profile.legalName,profile.state),now=new Date().toISOString();
  if(id){
    if(!uuid.test(id) || !Number.isSafeInteger(body.revision) || body.revision<1)throw new UserError('Reabra o cadastro e tente novamente.');
    const existing=await env.DB.prepare('SELECT * FROM client_profiles WHERE id = ?').bind(id).first();if(!existing)throw new UserError('Cliente não encontrado.',404);
    if(!profile.consultant)profile.consultant=JSON.parse(existing.payload).consultant||'';
    const serialized=JSON.stringify(profile);
    if(existing.payload===serialized)return profileData(existing);
    if(existing.revision!==body.revision)throw new UserError('Este cliente foi atualizado em outra sessão. Reabra o cadastro antes de salvar.',409);
    const collision=await env.DB.prepare('SELECT id FROM history_clients WHERE legacy_key = ? AND id != ?').bind(key,id).first();if(collision)throw new UserError('Já existe um cliente com esta razão social e UF.',409);
    try{
      await env.DB.batch([
        env.DB.prepare('UPDATE client_profiles SET cnpj = ?, payload = ?, revision = revision + 1, updated_by = ?, updated_at = ? WHERE id = ? AND revision = ?').bind(cnpj,serialized,user,now,id,body.revision),
        env.DB.prepare('UPDATE history_clients SET legacy_key = ?, name = ?, state = ? WHERE id = ? AND EXISTS (SELECT 1 FROM client_profiles WHERE id = ? AND revision = ? AND payload = ?)').bind(key,profile.legalName,profile.state,id,id,body.revision+1,serialized),
      ]);
    }catch(error){if(/unique|constraint/i.test(error.message))throw new UserError('Já existe um cliente com este CNPJ ou com esta razão social e UF.',409);throw error;}
    const updated=await env.DB.prepare('SELECT * FROM client_profiles WHERE id = ?').bind(id).first();
    if(updated?.revision!==body.revision+1 || updated?.payload!==serialized)throw new UserError('Este cliente foi atualizado em outra sessão. Reabra o cadastro antes de salvar.',409);
    return profileData(updated);
  }
  if(body.revision!==0)throw new UserError('Reabra o cadastro e tente novamente.');
  const serialized=JSON.stringify(profile);
  const reference=origin(body,profile),from=reference||{name:profile.legalName,state:profile.state};
  const existingClient=await env.DB.prepare('SELECT id FROM history_clients WHERE legacy_key=?').bind(clientKey(from.name,from.state)).first();if(existingClient&&actor)await requireClient(env,actor,existingClient.id);
  const original=await ensureClient(env,{...from,key:clientKey(from.name,from.state)});
  if(await env.DB.prepare('SELECT id FROM client_profiles WHERE id = ?').bind(original.id).first())throw new UserError('Este cliente já está cadastrado. Recarregue e edite o cadastro existente.',409);
  const collision=await env.DB.prepare('SELECT id FROM history_clients WHERE legacy_key = ? AND id != ?').bind(key,original.id).first();if(collision)throw new UserError('Já existe um cliente com esta razão social e UF.',409);
  try{
    await env.DB.batch([
      env.DB.prepare('INSERT INTO client_profiles (id,cnpj,payload,revision,origin_name,origin_state,author_id,updated_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)').bind(original.id,cnpj,serialized,1,reference?.name||null,reference?.state||null,user,user,now,now),
      env.DB.prepare('UPDATE history_clients SET legacy_key = ?, name = ?, state = ? WHERE id = ?').bind(key,profile.legalName,profile.state,original.id),
    ]);
  }catch(error){if(/unique|constraint/i.test(error.message))throw new UserError('Já existe um cliente com este CNPJ ou com esta razão social e UF.',409);throw error;}
  return profileData(await env.DB.prepare('SELECT * FROM client_profiles WHERE id = ?').bind(original.id).first());
}

function completeProfile(profile){
  return Boolean(profile.cnpj && profile.icmsStatus && ['yes','no'].includes(profile.hasBought) && (profile.hasBought==='no' || date(profile.lastSaleDate)&&profile.lastSaleDescription));
}
function validatePreRegistration(body){
  if(!record(body) || !record(body.profile))throw new UserError('Preencha o pré-cadastro do cliente.');
  const p=body.profile,d=p.delivery,c=p.commercial;
  if(!record(d) || !record(c))throw new UserError('Preencha o endereço e o contato comercial.');
  const client=clean(body.client,'Cliente',180,true).replace(/\s+/g,' '),state=clean(body.state,'UF da empresa',2,true).toUpperCase();
  if(!states.has(state))throw new UserError('Selecione uma UF válida para a empresa.');
  const borealCustomer=clean(p.borealCustomer,'Cliente Boreal',7,true);
  if(!['yes','no'].includes(borealCustomer))throw new UserError('Informe se a empresa já é cliente Boreal.');
  const delivery={recipient:client,postalCode:clean(d.postalCode,'CEP',9).replace(/\D/g,''),street:clean(d.street,'Logradouro',200),number:clean(d.number,'Número',30),complement:clean(d.complement,'Complemento',160),district:clean(d.district,'Bairro',120),city:clean(d.city,'Município',120),state:clean(d.state,'UF do endereço',2,true).toUpperCase()};
  if(delivery.postalCode && !/^\d{8}$/.test(delivery.postalCode))throw new UserError('O CEP deve ter 8 dígitos.');
  if(!states.has(delivery.state))throw new UserError('Selecione uma UF válida para o endereço.');
  const commercial=contact(c,'comercial');
  if(commercial.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(commercial.email))throw new UserError('Verifique o e-mail do contato comercial.');
  const revision=Number(body.revision);
  if(!Number.isSafeInteger(revision) || revision<0)throw new UserError('Reabra o cliente e tente novamente.');
  const clientProfileId=body.clientProfileId==null||body.clientProfileId===''?null:String(body.clientProfileId);
  if(clientProfileId && !uuid.test(clientProfileId))throw new UserError('Referência do cliente inválida.');
  return {client,state,revision,clientProfileId,owner:clean(body.owner,'Consultor responsável',180),segment:clean(body.segment,'Segmento',100),borealCustomer,equipment:clean(p.equipment,'Equipamentos em uso',1500),software:clean(p.software,'Software em uso',200),delivery,commercial};
}
export async function savePreRegistration(request,env,ensureClient,user,actor){
  if(!request.headers.get('content-type')?.startsWith('application/json'))throw new UserError('Formato do pré-cadastro inválido.',415);
  let body;try{body=JSON.parse(new TextDecoder().decode(await limitedBody(request,64*1024)));}catch(error){if(error instanceof UserError)throw error;throw new UserError('Os dados do pré-cadastro são inválidos.');}
  const draft=validatePreRegistration(body),context={name:draft.client,state:draft.state,key:clientKey(draft.client,draft.state)};
  let history;
  if(draft.clientProfileId){history=await env.DB.prepare('SELECT * FROM history_clients WHERE id = ?').bind(draft.clientProfileId).first();if(!history)throw new UserError('Cliente não encontrado.',404);if(actor)await requireClient(env,actor,history.id);}
  else history=await ensureClient(env,context);
  const existing=await env.DB.prepare('SELECT * FROM client_profiles WHERE id = ?').bind(history.id).first();
  if(existing && existing.revision!==draft.revision)throw new UserError('Este cliente foi atualizado em outra sessão. Reabra o pré-cadastro.',409);
  if(!existing && draft.revision!==0)throw new UserError('Reabra o pré-cadastro e tente novamente.',409);
  const base=existing?JSON.parse(existing.payload):{legalName:history.name,tradeName:'',segment:'',state:history.state,icmsStatus:'',cnpj:'',stateRegistration:'',municipalRegistration:'',delivery:{recipient:history.name,postalCode:'',street:'',number:'',complement:'',district:'',city:'',state:history.state},commercial:{name:'',email:'',phone:''},financial:{name:'',email:'',phone:''},equipment:'',software:'',hasBought:'',lastSaleDate:'',lastSaleDescription:''};
  const assignedOwner=actor?.role==='commercial'?actor.consultantName:draft.owner;
  const profile={...base,legalName:draft.client,state:draft.state,segment:draft.segment||base.segment||'',equipment:draft.equipment,software:draft.software,hasBought:draft.borealCustomer,borealCustomer:draft.borealCustomer,consultant:assignedOwner||base.consultant||'',delivery:{recipient:base.delivery?.recipient||draft.client,...draft.delivery},commercial:{...draft.commercial},financial:{name:'',email:'',phone:'',...(base.financial||{})}};
  if(completeProfile(profile))delete profile.registrationStatus;else profile.registrationStatus='incomplete';
  const serialized=JSON.stringify(profile),now=new Date().toISOString(),nextRevision=(existing?.revision||0)+1;
  const statements=[];
  if(history.name!==draft.client || history.state!==draft.state)statements.push(env.DB.prepare('UPDATE history_clients SET legacy_key=?,name=?,state=? WHERE id=?').bind(context.key,draft.client,draft.state,history.id));
  if(existing)statements.push(env.DB.prepare('UPDATE client_profiles SET cnpj = ?, payload = ?, revision = revision + 1, updated_by = ?, updated_at = ? WHERE id = ? AND revision = ?').bind(profile.cnpj||null,serialized,user,now,history.id,draft.revision));
  else statements.push(env.DB.prepare('INSERT INTO client_profiles (id,cnpj,payload,revision,author_id,updated_by,created_at,updated_at) VALUES (?,?,?,1,?,?,?,?)').bind(history.id,profile.cnpj||null,serialized,user,user,now,now));
  if(assignedOwner)statements.push(env.DB.prepare("INSERT INTO client_access (client_id,user_id,granted_by) SELECT ?,id,? FROM app_users WHERE active=1 AND role='commercial' AND LOWER(TRIM(COALESCE(consultant_name,name)))=LOWER(TRIM(?)) LIMIT 1 ON CONFLICT DO NOTHING").bind(history.id,user,assignedOwner));
  try{await env.DB.batch(statements);}catch(error){if(/unique|constraint/i.test(error.message))throw new UserError('Já existe um cliente com este nome e UF.',409);throw error;}
  const saved=await env.DB.prepare('SELECT * FROM client_profiles WHERE id = ?').bind(history.id).first();
  if(saved?.revision!==nextRevision || saved?.payload!==serialized)throw new UserError('Este cliente foi atualizado em outra sessão. Reabra o pré-cadastro.',409);
  return profileData(saved);
}

export async function deleteProfile(request,env,id){
  if(!uuid.test(id))throw new UserError('Cliente não encontrado.',404);
  if(!request.headers.get('content-type')?.startsWith('application/json'))throw new UserError('Confirmação de exclusão inválida.',415);
  let body;try{body=JSON.parse(new TextDecoder().decode(await limitedBody(request,8*1024)));}catch(error){if(error instanceof UserError)throw error;throw new UserError('Confirmação de exclusão inválida.');}
  if(!record(body) || !Number.isSafeInteger(body.revision) || body.revision<1)throw new UserError('Reabra o cadastro antes de excluir.');
  const existing=await env.DB.prepare('SELECT * FROM client_profiles WHERE id = ?').bind(id).first();
  if(!existing)throw new UserError('Cliente não encontrado.',404);
  if(existing.revision!==body.revision)throw new UserError('Este cliente foi atualizado em outra sessão. Reabra o cadastro antes de excluir.',409);
  const attachments=(await env.DB.prepare('SELECT object_key FROM history_attachments WHERE email_id IN (SELECT id FROM history_emails WHERE client_id = ?) UNION ALL SELECT original_key AS object_key FROM history_emails WHERE client_id = ?').bind(id,id).all()).results||[];
  await env.DB.batch([
    env.DB.prepare('DELETE FROM client_access WHERE client_id=? AND EXISTS (SELECT 1 FROM client_profiles WHERE id=? AND revision=?)').bind(id,id,body.revision),
    env.DB.prepare('DELETE FROM history_attachments WHERE email_id IN (SELECT id FROM history_emails WHERE client_id = ?) AND EXISTS (SELECT 1 FROM client_profiles WHERE id = ? AND revision = ?)').bind(id,id,body.revision),
    env.DB.prepare('DELETE FROM history_emails WHERE client_id = ? AND EXISTS (SELECT 1 FROM client_profiles WHERE id = ? AND revision = ?)').bind(id,id,body.revision),
    env.DB.prepare('DELETE FROM client_orders WHERE client_id = ? AND EXISTS (SELECT 1 FROM client_profiles WHERE id = ? AND revision = ?)').bind(id,id,body.revision),
    env.DB.prepare('DELETE FROM import_records WHERE client_id = ? AND EXISTS (SELECT 1 FROM client_profiles WHERE id = ? AND revision = ?)').bind(id,id,body.revision),
    env.DB.prepare('DELETE FROM client_profiles WHERE id = ? AND revision = ?').bind(id,body.revision),
    env.DB.prepare('DELETE FROM history_clients WHERE id = ? AND NOT EXISTS (SELECT 1 FROM client_profiles WHERE id = ?)').bind(id,id),
  ]);
  if(await env.DB.prepare('SELECT id FROM client_profiles WHERE id = ?').bind(id).first())throw new UserError('Este cliente foi atualizado em outra sessão. Reabra o cadastro antes de excluir.',409);
  if(attachments.length){try{await env.BUCKET.delete(attachments.map(row=>row.object_key));}catch{/* Private orphaned objects remain inaccessible. */}}
  return {deleted:true,id};
}

export async function classifyProfile(request,env,id,user){
  if(!uuid.test(id))throw new UserError('Cliente não encontrado.',404);
  if(!request.headers.get('content-type')?.startsWith('application/json'))throw new UserError('Classificação inválida.',415);
  let body;try{body=JSON.parse(new TextDecoder().decode(await limitedBody(request,8*1024)));}catch(error){if(error instanceof UserError)throw error;throw new UserError('Classificação inválida.');}
  const classification=String(body?.classification??'').trim();
  if(!classifications.has(classification))throw new UserError('Selecione Concessionária, Indústria, Varejo ou Empreiteiro.');
  if(!Number.isSafeInteger(body?.revision) || body.revision<1)throw new UserError('Recarregue a lista antes de classificar.');
  const existing=await env.DB.prepare('SELECT * FROM client_profiles WHERE id = ?').bind(id).first();
  if(!existing)throw new UserError('Cliente não encontrado.',404);
  if(existing.revision!==body.revision)throw new UserError('Este cliente foi atualizado em outra sessão. Recarregue a lista.',409);
  const profile=JSON.parse(existing.payload);profile.segment=classification;const payload=JSON.stringify(profile),now=new Date().toISOString();
  await env.DB.prepare('UPDATE client_profiles SET payload = ?, revision = revision + 1, updated_by = ?, updated_at = ? WHERE id = ? AND revision = ?').bind(payload,user,now,id,body.revision).run();
  const updated=await env.DB.prepare('SELECT * FROM client_profiles WHERE id = ?').bind(id).first();
  if(updated?.revision!==body.revision+1 || updated?.payload!==payload)throw new UserError('Este cliente foi atualizado em outra sessão. Recarregue a lista.',409);
  return profileData(updated);
}

export async function assignConsultant(request,env,id,user){
  if(!uuid.test(id))throw new UserError('Cliente não encontrado.',404);
  if(!request.headers.get('content-type')?.startsWith('application/json'))throw new UserError('Consultor inválido.',415);
  let body;try{body=JSON.parse(new TextDecoder().decode(await limitedBody(request,8*1024)));}catch(error){if(error instanceof UserError)throw error;throw new UserError('Consultor inválido.');}
  if(!Number.isSafeInteger(body?.revision)||body.revision<1)throw new UserError('Reabra o cliente antes de alterar o consultor.');
  const requested=clean(body?.consultant,'Consultor responsável',180,true),normalize=value=>String(value||'').trim().normalize('NFC').toLocaleLowerCase('pt-BR').replace(/\s+/g,' ');
  const consultant=(await listConsultants(env)).consultants.find(name=>normalize(name)===normalize(requested));
  if(!consultant)throw new UserError('Selecione um consultor ativo.');
  const existing=await env.DB.prepare('SELECT * FROM client_profiles WHERE id=?').bind(id).first();if(!existing)throw new UserError('Cliente não encontrado.',404);
  if(existing.revision!==body.revision)throw new UserError('Este cliente foi atualizado em outra sessão. Reabra antes de alterar o consultor.',409);
  const profile=JSON.parse(existing.payload);profile.consultant=consultant;const payload=JSON.stringify(profile),now=new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare("SELECT CASE WHEN EXISTS(SELECT 1 FROM client_profiles WHERE id=? AND revision=?) THEN 1 ELSE json('client_revision_conflict') END").bind(id,body.revision),
    env.DB.prepare('UPDATE client_profiles SET payload=?,revision=revision+1,updated_by=?,updated_at=? WHERE id=? AND revision=?').bind(payload,user,now,id,body.revision),
    env.DB.prepare('DELETE FROM client_access WHERE client_id=?').bind(id),
    env.DB.prepare("INSERT INTO client_access (client_id,user_id,granted_by) SELECT ?,id,? FROM app_users WHERE active=1 AND role='commercial' AND LOWER(TRIM(COALESCE(consultant_name,name)))=LOWER(TRIM(?)) LIMIT 1 ON CONFLICT DO NOTHING").bind(id,user,consultant),
    env.DB.prepare("UPDATE import_records SET payload=json_set(payload,'$.owner',?),revision=revision+1 WHERE client_id=? AND kind IN ('Atividades','Negócios')").bind(consultant,id),
    env.DB.prepare('INSERT INTO security_events (actor_id,action,target,created_at) VALUES (?,?,?,?)').bind(user,'client_consultant_changed',id+':'+consultant,now)
  ]);
  const updated=await env.DB.prepare('SELECT * FROM client_profiles WHERE id=?').bind(id).first();
  if(updated?.revision!==body.revision+1||updated?.payload!==payload)throw new UserError('Este cliente foi atualizado em outra sessão. Reabra antes de alterar o consultor.',409);
  const activities=(await env.DB.prepare("SELECT id,revision FROM import_records WHERE client_id=? AND kind='Atividades'").bind(id).all()).results||[];
  return {client:profileData(updated),activities};
}
