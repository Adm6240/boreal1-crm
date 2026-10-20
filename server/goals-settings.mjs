import {UserError,limitedBody} from './email.mjs';
import {requireRole} from './users.mjs';

const defaults={year:2026,generalTarget:3600000,superPercent:130,generalBonusPercent:100,superBonusPercent:200,annual:{'Danielle':1440000}};
const testName='consultor desativado';
export function cleanGoalSettings(settings){return {...settings,annual:Object.fromEntries(Object.entries(settings.annual||{}).filter(([name])=>name.trim().normalize('NFC').toLocaleLowerCase('pt-BR').replace(/\s+/g,' ')!==testName))};}
const number=(value,min,max)=>typeof value==='number'&&Number.isFinite(value)&&value>=min&&value<=max;
export async function readGoalSettings(env,user){
  requireRole(user,'admin','coordinator','commercial');
  const row=await env.DB.prepare('SELECT payload,updated_at FROM goal_settings ORDER BY year DESC LIMIT 1').first();
  const original=row?JSON.parse(row.payload):defaults,settings=cleanGoalSettings(original);
  // Remove the explicitly retired test goal when an administrator opens settings.
  if(row&&['admin','coordinator'].includes(user.role)&&Object.keys(settings.annual).length!==Object.keys(original.annual||{}).length){
    await env.DB.prepare('UPDATE goal_settings SET payload=?,updated_by=?,updated_at=? WHERE year=? AND payload=?').bind(JSON.stringify(settings),user.authId,new Date().toISOString(),original.year,row.payload).run();
  }
  if(user.role==='commercial'){
    const owner=Object.keys(settings.annual).find(name=>name.toLocaleLowerCase('pt-BR')===user.consultantName.toLocaleLowerCase('pt-BR'));
    return {settings:{...settings,annual:owner?{[owner]:settings.annual[owner]}:{[user.consultantName]:0}},stored:!!row,updatedAt:row?.updated_at||null};
  }
  return {settings,stored:!!row,updatedAt:row?.updated_at||null};
}
export async function saveGoalSettings(request,env,user){
  requireRole(user,'admin','coordinator');
  if(!request.headers.get('content-type')?.startsWith('application/json'))throw new UserError('Formato inválido.',415);
  let data;try{data=JSON.parse(new TextDecoder().decode(await limitedBody(request,16384)));}catch(error){if(error instanceof UserError)throw error;throw new UserError('Dados das metas inválidos.');}
  const {year,generalTarget,superPercent,generalBonusPercent,superBonusPercent,annual}=data||{};
  if(!Number.isSafeInteger(year)||year<2020||year>2100||!number(generalTarget,1,1e12)||!number(superPercent,101,300)||!number(generalBonusPercent,0,1000)||!number(superBonusPercent,0,1000)||!annual||typeof annual!=='object'||Array.isArray(annual)||Object.keys(annual).length>100)throw new UserError('Confira os valores das metas.');
  const clean=Object.create(null);
  for(const [raw,value] of Object.entries(annual)){const name=raw.trim();if(!name||name.length>160||!number(value,0,1e12))throw new UserError('Confira as metas dos consultores.');clean[name]=value;}
  const settings={year,generalTarget,superPercent,generalBonusPercent,superBonusPercent,annual:cleanGoalSettings({annual:clean}).annual},now=new Date().toISOString();
  await env.DB.prepare('INSERT INTO goal_settings (year,payload,updated_by,updated_at) VALUES (?,?,?,?) ON CONFLICT(year) DO UPDATE SET payload=excluded.payload,updated_by=excluded.updated_by,updated_at=excluded.updated_at').bind(year,JSON.stringify(settings),user.authId,now).run();
  return {settings,stored:true,updatedAt:now};
}
