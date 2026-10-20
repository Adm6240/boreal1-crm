import {UserError,limitedBody} from './email.mjs';
import {requireRole} from './users.mjs';

export async function readActivitySettings(env,user){
  requireRole(user,'admin','coordinator','commercial');
  const row=await env.DB.prepare('SELECT schedule_next,updated_at FROM activity_settings WHERE id=1').first();
  return {scheduleNext:row?Boolean(row.schedule_next):true,updatedAt:row?.updated_at||null};
}

export async function saveActivitySettings(request,env,user){
  requireRole(user,'admin');
  if(!request.headers.get('content-type')?.startsWith('application/json'))throw new UserError('Formato inválido.',415);
  let body;try{body=JSON.parse(new TextDecoder().decode(await limitedBody(request,1024)));}catch(error){if(error instanceof UserError)throw error;throw new UserError('Configuração inválida.');}
  if(typeof body?.scheduleNext!=='boolean')throw new UserError('Configuração inválida.');
  const now=new Date().toISOString();
  await env.DB.prepare('INSERT INTO activity_settings (id,schedule_next,updated_by,updated_at) VALUES (1,?,?,?) ON CONFLICT(id) DO UPDATE SET schedule_next=excluded.schedule_next,updated_by=excluded.updated_by,updated_at=excluded.updated_at').bind(Number(body.scheduleNext),user.authId,now).run();
  return {scheduleNext:body.scheduleNext,updatedAt:now};
}
