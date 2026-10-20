import bcrypt from 'bcryptjs';
import {UserError,limitedBody,digest} from './email.mjs';
import {audit} from './security.mjs';
const roles=new Set(['admin','coordinator','commercial','stock','maintenance','dispatch','accounting']);
const roleNames={admin:'Administrador',coordinator:'Coordenação comercial',commercial:'Consultor',stock:'Estoque',maintenance:'Manutenção',dispatch:'Expedição',accounting:'Contábil'};
const ownerEmail='admin@example.invalid';
const normalizeEmail=value=>String(value||'').trim().toLowerCase();
const hashToken=value=>digest(new TextEncoder().encode(value));
const cookieName='__Host-boreal-session';
const publicUser=row=>({id:row.id,userCode:row.user_code||row.id,email:row.email.includes('@')?row.email:'',name:row.name,role:row.role,roleName:roleNames[row.role],consultantName:row.consultant_name||'',active:!!row.active,mustChangePassword:!!row.must_change_password});
const cookie=(token,age=28800)=>`${cookieName}=${token}; Path=/; HttpOnly; Secure; SameSite=None; Partitioned; Max-Age=${age}`;
function sessionHeaders(token,age=28800){const headers=new Headers({'Content-Type':'application/json','Cache-Control':'no-store'});headers.append('Set-Cookie',cookie(token,age));headers.append('Set-Cookie',`${cookieName}=; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=0`);return headers;}
const tokenFrom=request=>request.headers.get('cookie')?.split(';').map(x=>x.trim()).find(x=>x.startsWith(cookieName+'='))?.slice(cookieName.length+1)||'';
export function requireRole(user,...allowed){if(!allowed.includes(user.role))throw new UserError('Seu perfil não tem permissão para esta ação.',403);}
async function body(request){if(!request.headers.get('content-type')?.startsWith('application/json'))throw new UserError('Formato inválido.',415);try{return JSON.parse(new TextDecoder().decode(await limitedBody(request,8192)));}catch(e){if(e instanceof UserError)throw e;throw new UserError('Dados inválidos.');}}
function validPassword(value){if(typeof value!=='string'||value.length<11||new TextEncoder().encode(value).length>72)throw new UserError('Use uma senha de pelo menos 11 caracteres e no máximo 72 bytes.');return value;}
async function passwordHash(value){return bcrypt.hash(validPassword(value),12);}
async function throttle(env,key,limit=10){const now=Date.now();await env.DB.prepare('DELETE FROM auth_attempts WHERE expires_at < ?').bind(now).run();await env.DB.prepare('DELETE FROM app_sessions WHERE expires_at < ?').bind(now).run();const row=await env.DB.prepare('INSERT INTO auth_attempts (key,attempts,expires_at) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET attempts = CASE WHEN expires_at < ? THEN 1 ELSE attempts + 1 END, expires_at = CASE WHEN expires_at < ? THEN ? ELSE expires_at END RETURNING attempts').bind(key,now+900000,now,now,now+900000).first();if(row.attempts>limit)throw new UserError('Muitas tentativas. Aguarde 15 minutos e tente novamente.',429);}
async function sessionResponse(env,row){const token=Array.from(crypto.getRandomValues(new Uint8Array(32)),x=>x.toString(16).padStart(2,'0')).join('');const inserted=await env.DB.prepare('INSERT INTO app_sessions (token_hash,user_id,expires_at) SELECT ?,id,? FROM app_users WHERE id = ? AND password_hash = ? AND active = 1 RETURNING token_hash').bind(await hashToken(token),Date.now()+28800000,row.id,row.password_hash).first();if(!inserted)throw new UserError('Seu acesso mudou. Entre novamente.',401);return new Response(JSON.stringify({user:publicUser(row)}),{headers:sessionHeaders(token)});}
async function ownerBootstrap(request,env){
 const authId=request.headers.get('oai-authenticated-user-id');
 if(!authId||normalizeEmail(request.headers.get('oai-authenticated-user-email'))!==ownerEmail)return null;
 const now=new Date().toISOString();
 await env.DB.prepare('INSERT INTO app_users (id,email,name,role,consultant_name,auth_user_id,active,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(email) DO NOTHING').bind(crypto.randomUUID(),ownerEmail,'Administrador Exemplo','admin','Danielle',authId,1,'site-owner',now,now).run();
 // One-time owner-authorized recovery, bound to the verified platform identity.
 const recoveryHash=env.BOREAL_OWNER_RECOVERY_HASH;
 if(recoveryHash&&/^\$2[aby]\$12\$[./A-Za-z0-9]{53}$/.test(recoveryHash)){
  const pending=await env.DB.prepare('SELECT default_hash FROM auth_settings WHERE id = 3').first();
  const owner=await env.DB.prepare('SELECT id,auth_user_id FROM app_users WHERE email = ?').bind(ownerEmail).first();
  if(pending?.default_hash!==recoveryHash&&owner?.auth_user_id===authId){
   await env.DB.batch([
    env.DB.prepare('UPDATE app_users SET password_hash = ?, role = ?, active = 1, must_change_password = 0, updated_at = ? WHERE id = ? AND auth_user_id = ?').bind(recoveryHash,'admin',now,owner.id,authId),
    env.DB.prepare('DELETE FROM app_sessions WHERE user_id = ?').bind(owner.id),
    env.DB.prepare('DELETE FROM auth_attempts WHERE key IN (?,?)').bind('email:'+await hashToken(ownerEmail),'change:'+owner.id),
    env.DB.prepare('INSERT INTO auth_settings (id,default_hash) VALUES (3,?) ON CONFLICT(id) DO UPDATE SET default_hash = excluded.default_hash').bind(recoveryHash)
   ]);
  }
 }
 const row=await env.DB.prepare('SELECT * FROM app_users WHERE email = ?').bind(ownerEmail).first();
 return row.active&&!row.password_hash&&row.auth_user_id===authId?row:null;
}
export async function currentUser(request,env){
 const token=tokenFrom(request);let row;
 if(token){row=await env.DB.prepare('SELECT u.* FROM app_users u JOIN app_sessions s ON s.user_id = u.id WHERE s.token_hash = ? AND s.expires_at > ? AND u.active = 1').bind(await hashToken(token),Date.now()).first();}
 if(!row){const bootstrap=await ownerBootstrap(request,env);if(bootstrap)return {...publicUser(bootstrap),authId:bootstrap.id,bootstrap:true};throw new UserError('Entre com seu e-mail ou ID e senha.',401);}
 return {...publicUser(row),authId:row.id};
}
export async function login(request,env){const data=await body(request);let email=normalizeEmail(data.email);email=({manutencao:'manutenção',expedicao:'expedição'})[email]||email;if(email.length>254||typeof data.password!=='string'||new TextEncoder().encode(data.password).length>72)throw new UserError('E-mail, ID ou senha inválidos.',401);
 await ownerBootstrap(request,env);
 await throttle(env,'ip:'+await hashToken(request.headers.get('cf-connecting-ip')||request.headers.get('oai-authenticated-user-id')||'unknown'),50);
 await throttle(env,'email:'+await hashToken(email));
 const matches=await env.DB.prepare('SELECT * FROM app_users WHERE lower(email) = ? OR lower(user_code) = ?').bind(email,email).all();const row=matches.results?.length===1?matches.results[0]:null;
 // A fixed dummy hash equalizes password checks for unregistered addresses.
 const hash=row?.password_hash||'$2b$12$R9h/cIPz0gi.URNNX3kh2OPST9/PgBkqquzi.Ss7KIUgO2t0jWMUW';
 const correct=await bcrypt.compare(data.password,hash);
 const retired=row?.email!==ownerEmail&&row?.password_hash?await env.DB.prepare('SELECT 1 AS retired WHERE EXISTS (SELECT 1 FROM auth_settings WHERE id IN (1,2) AND default_hash=?) OR (SELECT count(*) FROM app_users WHERE password_hash=?)>1').bind(row.password_hash,row.password_hash).first():null;
 if(!correct||!row?.active||!row.password_hash||retired){await audit(env,null,'login_failure',await hashToken(email));throw new UserError('E-mail, ID ou senha inválidos.',401);}
 await env.DB.prepare('DELETE FROM auth_attempts WHERE key = ?').bind('email:'+await hashToken(email)).run();
 await audit(env,row,'login_success');
 return sessionResponse(env,row);
}
export async function logout(request,env){const token=tokenFrom(request);if(token)await env.DB.prepare('DELETE FROM app_sessions WHERE token_hash = ?').bind(await hashToken(token)).run();return new Response('{}',{headers:sessionHeaders('',0)});}
export async function changePassword(request,env,actor){const data=await body(request),row=await env.DB.prepare('SELECT * FROM app_users WHERE id = ?').bind(actor.id).first();
 await throttle(env,'change:'+actor.id);
 if(!actor.bootstrap && !(typeof data.currentPassword==='string'&&await bcrypt.compare(data.currentPassword,row.password_hash)))throw new UserError('A senha atual não confere.',403);
 if(data.keepCurrent===true)throw new UserError('Defina uma senha pessoal diferente da senha inicial.');
 if(row.password_hash&&await bcrypt.compare(validPassword(data.password),row.password_hash))throw new UserError('Escolha uma senha diferente da atual.');
 const hash=await passwordHash(data.password);
 const changed=await env.DB.prepare('UPDATE app_users SET password_hash = ?, must_change_password = 0, updated_at = ? WHERE id = ? AND password_hash IS ? RETURNING id').bind(hash,new Date().toISOString(),actor.id,row.password_hash).first();
 if(!changed)throw new UserError('Seu acesso mudou. Entre novamente.',409);
 await env.DB.prepare('DELETE FROM app_sessions WHERE user_id = ?').bind(actor.id).run();
 await audit(env,actor,'password_changed');
 return sessionResponse(env,await env.DB.prepare('SELECT * FROM app_users WHERE id = ?').bind(actor.id).first());
}
// Slot 2 records the last hosted default applied; later administrator edits remain valid.
async function ensureDefaultPassword(env){
 const hash=env.BOREAL_INITIAL_PASSWORD_HASH;
 if(!hash || !/^\$2[aby]\$12\$[./A-Za-z0-9]{53}$/.test(hash))return;
 await env.DB.batch([
  env.DB.prepare('INSERT INTO auth_settings (id,default_hash) SELECT 1,? WHERE NOT EXISTS (SELECT 1 FROM auth_settings WHERE id = 2 AND default_hash = ?) ON CONFLICT(id) DO UPDATE SET default_hash = excluded.default_hash').bind(hash,hash),
  env.DB.prepare('INSERT INTO auth_settings (id,default_hash) VALUES (2,?) ON CONFLICT(id) DO UPDATE SET default_hash = excluded.default_hash').bind(hash)
 ]);
}
export async function listUsers(env){await ensureDefaultPassword(env);const rows=await env.DB.prepare('SELECT * FROM app_users ORDER BY name COLLATE NOCASE').all();const settings=await env.DB.prepare('SELECT id FROM auth_settings WHERE id = 1').first();return {users:(rows.results||[]).map(publicUser),hasDefaultPassword:!!settings};}
export async function listConsultants(env){const rows=await env.DB.prepare("SELECT consultant_name FROM app_users WHERE active = 1 AND consultant_name IS NOT NULL AND trim(consultant_name) != '' ORDER BY consultant_name COLLATE NOCASE").all();const seen=new Set(),consultants=[];for(const row of rows.results||[]){const name=String(row.consultant_name).trim(),key=name.normalize('NFC').toLocaleLowerCase('pt-BR').replace(/\s+/g,' ');if(!seen.has(key)){seen.add(key);consultants.push(name);}}return {consultants};}
async function input(request){const data=await body(request),email=normalizeEmail(data.email||(['stock','maintenance','dispatch'].includes(data.role)?data.userCode:'')),name=String(data.name||'').trim(),role=data.role,consultantName=String(data.consultantName||'').trim(),userCode=String(data.userCode||'').trim();
 if((!['stock','maintenance','dispatch'].includes(role)&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))||!email||email.length>254||!name||name.length>160||!roles.has(role)||consultantName.length>160||userCode.length>60)throw new UserError('Informe nome, e-mail, ID e perfil válidos.');
 if(role==='commercial'&&!consultantName)throw new UserError('Informe o nome do consultor usado nas metas e pedidos.');
 return {email,name,role,consultantName,userCode,active:data.active!==false,password:data.password};}
async function initialHash(env,password){if(!password)throw new UserError('Defina uma senha temporária individual para este usuário.');const hash=await passwordHash(password);const rows=(await env.DB.prepare('SELECT password_hash FROM app_users WHERE password_hash IS NOT NULL').all()).results||[];for(const row of rows){if(await bcrypt.compare(password,row.password_hash))throw new UserError('Esta senha já está em uso. Defina uma senha temporária exclusiva.');}return hash;}
export async function createUser(request,env,actor){requireRole(actor,'admin');const user=await input(request),now=new Date().toISOString(),id=crypto.randomUUID(),hash=await initialHash(env,user.password);
 try{await env.DB.prepare('INSERT INTO app_users (id,user_code,email,name,role,consultant_name,password_hash,must_change_password,active,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,1,?,?,?,?)').bind(id,user.userCode||id,user.email,user.name,user.role,user.consultantName||null,hash,user.active?1:0,actor.id,now,now).run();}catch(e){if(String(e).includes('UNIQUE'))throw new UserError('Este e-mail ou ID já está cadastrado.',409);throw e;}
 await audit(env,actor,'user_saved',id);return publicUser(await env.DB.prepare('SELECT * FROM app_users WHERE id = ?').bind(id).first());}
export async function updateUser(request,env,id,actor){requireRole(actor,'admin');const user=await input(request),current=await env.DB.prepare('SELECT * FROM app_users WHERE id = ?').bind(id).first();if(!current)throw new UserError('Usuário não encontrado.',404);
 if((id===actor.id||current.email===ownerEmail)&&(user.role!=='admin'||!user.active||user.email!==current.email))throw new UserError('Esta conta precisa manter seu acesso administrativo.');
 try{await env.DB.prepare('UPDATE app_users SET user_code = ?, email = ?, name = ?, role = ?, consultant_name = ?, active = ?, updated_at = ? WHERE id = ?').bind(user.userCode||id,user.email,user.name,user.role,user.consultantName||null,user.active?1:0,new Date().toISOString(),id).run();}catch(e){if(String(e).includes('UNIQUE'))throw new UserError('Este e-mail ou ID já está cadastrado.',409);throw e;}
 if(user.role!==current.role||user.email!==current.email||!user.active)await env.DB.prepare('DELETE FROM app_sessions WHERE user_id = ?').bind(id).run();
 await audit(env,actor,'user_saved',id);return publicUser(await env.DB.prepare('SELECT * FROM app_users WHERE id = ?').bind(id).first());}
export async function resetPassword(request,env,id,actor){requireRole(actor,'admin');if(id===actor.id)throw new UserError('Use Alterar minha senha na aba Conta.');const row=await env.DB.prepare('SELECT * FROM app_users WHERE id = ?').bind(id).first();if(!row)throw new UserError('Usuário não encontrado.',404);const data=await body(request),hash=await initialHash(env,data.password);
 await env.DB.batch([env.DB.prepare('UPDATE app_users SET password_hash = ?, must_change_password = 1, updated_at = ? WHERE id = ?').bind(hash,new Date().toISOString(),id),env.DB.prepare('DELETE FROM app_sessions WHERE user_id = ?').bind(id)]);await audit(env,actor,'password_reset',id);return {ok:true};}
export async function setDefaultPassword(request,env,actor){requireRole(actor,'admin');await ensureDefaultPassword(env);const data=await body(request),hash=await passwordHash(data.password);await env.DB.prepare('INSERT INTO auth_settings (id,default_hash) VALUES (1,?) ON CONFLICT(id) DO UPDATE SET default_hash = excluded.default_hash').bind(hash).run();return {ok:true};}
