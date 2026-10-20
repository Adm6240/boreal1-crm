import {cleanGoalSettings} from './goals-settings.mjs';
import {UserError,limitedBody} from './email.mjs';
import {requireRole,listConsultants} from './users.mjs';
export const salesNameKey=value=>String(value??'').normalize('NFC').trim().toLocaleLowerCase('pt-BR').replace(/\s+/g,' ');
export async function salesHistory(env,auth){
 requireRole(auth,'admin');const {consultants}=await listConsultants(env);const goals=await env.DB.prepare('SELECT payload FROM goal_settings ORDER BY year DESC LIMIT 1').first();
 const names=[...new Map([...consultants,...Object.keys(goals?cleanGoalSettings(JSON.parse(goals.payload)).annual:{})].map(name=>[salesNameKey(name),name])).values()];
 const rows=(await env.DB.prepare('SELECT year,consultant,month,amount_cents AS amountCents,filename,updated_at AS updatedAt FROM sales_history ORDER BY year DESC,consultant,month').all()).results||[];
 return {consultants:names,rows};
}
async function plan(request,env,auth){
 requireRole(auth,'admin');if(!request.headers.get('content-type')?.startsWith('application/json'))throw new UserError('Formato inválido.',415);
 let body;try{body=JSON.parse(new TextDecoder().decode(await limitedBody(request,256*1024)));}catch(error){if(error instanceof UserError)throw error;throw new UserError('Dados inválidos.');}
 const {year,rows,filename}=body||{};if(!Number.isInteger(year)||year<2020||year>2100||!Array.isArray(rows)||!rows.length||rows.length>1200||typeof filename!=='string'||!filename.trim()||filename.length>220)throw new UserError('Confira o ano e as vendas a importar.');
 const history=await salesHistory(env,auth),names=new Map(history.consultants.map(name=>[salesNameKey(name),name])),seen=new Set(),records=[],issues=[];
 for(const [index,row] of rows.entries()){
  if(!row||typeof row!=='object'){issues.push(`Linha ${index+1}: dados inválidos.`);continue;}
  const consultant=names.get(salesNameKey(row.consultant)),month=row.month,amount=row.amount,key=salesNameKey(consultant)+'|'+month;
  if(!consultant||!Number.isInteger(month)||month<1||month>12||typeof amount!=='number'||!Number.isFinite(amount)||amount<0||amount>1e12){issues.push(`Linha ${index+1}: confira o consultor, o mês e o valor.`);continue;}
  if(seen.has(key)){issues.push(`Registro repetido: ${consultant}, mês ${month}.`);continue;}seen.add(key);
  const cents=Math.round(amount*100),existing=history.rows.find(item=>item.year===year&&salesNameKey(item.consultant)===salesNameKey(consultant)&&item.month===month);
  records.push({consultant,month,amount:cents/100,amountCents:cents,existing:!!existing});
 }
 return {year,filename:filename.trim(),records,issues,total:records.reduce((sum,row)=>sum+row.amountCents,0)/100};
}
export async function previewSalesHistory(request,env,auth){return plan(request,env,auth);}
export async function applySalesHistory(request,env,auth){
 const preview=await plan(request,env,auth);if(preview.issues.length)throw new UserError('Corrija todas as pendências antes de homologar.');
 const now=new Date().toISOString();
 await env.DB.batch(preview.records.map(row=>env.DB.prepare('INSERT INTO sales_history (year,consultant_key,consultant,month,amount_cents,filename,updated_by,updated_at) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(year,consultant_key,month) DO UPDATE SET consultant=excluded.consultant,amount_cents=excluded.amount_cents,filename=excluded.filename,updated_by=excluded.updated_by,updated_at=excluded.updated_at').bind(preview.year,salesNameKey(row.consultant),row.consultant,row.month,row.amountCents,preview.filename,auth.authId,now)));
 return {imported:preview.records.length,total:preview.total};
}
