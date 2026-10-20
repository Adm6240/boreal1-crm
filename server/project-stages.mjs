import {UserError,limitedBody} from './email.mjs';

export const projectStages=['Contato','Proposta','Projeto','Aprovado','Concluído'];
const normalize=value=>String(value||'').normalize('NFC').trim().toLocaleLowerCase('pt-BR').replace(/\s+/g,' ');

export async function setProjectStage(env,clientId,project,stage,user,source='manual'){
  const projectName=String(project||'').trim();
  if(!projectName||projectName.length>200)throw new UserError('Informe um projeto válido.');
  if(!projectStages.includes(stage))throw new UserError('Selecione uma fase válida.');
  const now=new Date().toISOString(),projectKey=normalize(projectName);
  await env.DB.prepare(`INSERT INTO project_stages (client_id,project_key,project_name,stage,source,revision,updated_by,updated_at)
    VALUES (?,?,?,?,?,1,?,?) ON CONFLICT(client_id,project_key) DO UPDATE SET project_name=excluded.project_name,stage=CASE WHEN project_stages.stage='Concluído' AND excluded.source='order' THEN project_stages.stage ELSE excluded.stage END,source=CASE WHEN project_stages.stage='Concluído' AND excluded.source='order' THEN project_stages.source ELSE excluded.source END,revision=project_stages.revision+1,updated_by=excluded.updated_by,updated_at=excluded.updated_at`)
    .bind(clientId,projectKey,projectName,stage,source,user,now).run();
  return env.DB.prepare('SELECT project_name AS project,stage,source,revision,updated_at AS updatedAt FROM project_stages WHERE client_id=? AND project_key=?').bind(clientId,projectKey).first();
}

export async function listProjectStages(env,client){
  if(!client)return [];
  const rows=(await env.DB.prepare('SELECT project_key,project_name AS project,stage,source,revision,updated_at AS updatedAt FROM project_stages WHERE client_id=?').bind(client.id).all()).results||[];
  const byKey=new Map(rows.map(row=>[row.project_key,row]));
  const orders=(await env.DB.prepare('SELECT project_key,payload,status,updated_at FROM client_orders WHERE client_id=?').bind(client.id).all()).results||[];
  const grouped=new Map();
  for(const order of orders){let payload;try{payload=JSON.parse(order.payload);}catch{continue;}const group=grouped.get(order.project_key)||{project:payload.snapshot?.project,value:0,allComplete:true,updatedAt:order.updated_at};group.value+=Number(payload.orderValue)||0;group.allComplete&&=order.status==='completed';if(order.updated_at>group.updatedAt)group.updatedAt=order.updated_at;grouped.set(order.project_key,group);}
  for(const [key,group]of grouped){const current=byKey.get(key),inferred=group.allComplete?'Concluído':'Aprovado';if(current){current.value=group.value;if(group.allComplete)current.stage='Concluído';else if(current.source!=='manual')current.stage='Aprovado';}else byKey.set(key,{project:group.project,stage:inferred,value:group.value,source:'order',revision:0,updatedAt:group.updatedAt});}
  return [...byKey.values()].map(({project_key,...row})=>row);
}

export async function saveProjectStage(request,env,client,user){
  if(!request.headers.get('content-type')?.startsWith('application/json'))throw new UserError('Formato inválido.',415);
  let body;try{body=JSON.parse(new TextDecoder().decode(await limitedBody(request,4096)));}catch(error){if(error instanceof UserError)throw error;throw new UserError('Dados da fase inválidos.');}
  return setProjectStage(env,client.id,body?.project,body?.stage,user,'manual');
}
