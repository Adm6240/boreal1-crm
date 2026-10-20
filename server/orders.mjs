import {salesNameKey} from './sales-history.mjs';
import {UserError,limitedBody} from './email.mjs';
import {setProjectStage} from './project-stages.mjs';

const states=new Set('AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO'.split(' '));
const movements=new Set(['Venda','Locação simples (CL100)','Locação com compras (CL200)','Empréstimo','Doação','Substituição']);
const revenueMovements=new Set(['Venda','Locação simples (CL100)','Locação com compras (CL200)']);
const brazilMonth=new Intl.DateTimeFormat('en-US',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit'});
const normalize=value=>value.normalize('NFC').trim().toLocaleLowerCase('pt-BR').replace(/\s+/g,' ');
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
function text(value,label,max=200,required=false){
  if(value==null)value='';
  if(typeof value!=='string' || value.length>max)throw new UserError(`${label}: informe um texto de até ${max} caracteres.`);
  value=value.trim();if(required && !value)throw new UserError(`Preencha ${label.toLocaleLowerCase('pt-BR')}.`);return value;
}
function object(value){return value && typeof value==='object' && !Array.isArray(value);}
function validate(body,client){
  if(!object(body) || !uuid.test(body.id) || !Number.isSafeInteger(body.revision) || body.revision<0)throw new UserError('Reabra o pedido e tente novamente.');
  if(!object(body.snapshot) || !object(body.delivery) || !Array.isArray(body.items))throw new UserError('Preencha os dados do pedido.');
  if(!states.has(client.state))throw new UserError('O estado do cliente é inválido.');
  const s=body.snapshot,d=body.delivery;
  const snapshot={client:client.name,state:client.state,project:text(s.project,'Projeto',200,true),consultant:text(s.consultant,'Consultor',160,true),contact:text(s.contact,'Contato',180),email:text(s.email,'E-mail',254),phone:text(s.phone,'Telefone',60),value:s.value,software:text(s.software,'Software',200)||null};
  if(typeof snapshot.value!=='number' || !Number.isFinite(snapshot.value) || snapshot.value<0 || snapshot.value>1e12)throw new UserError('O valor do projeto é inválido.');
  const movement=text(body.movement,'Movimentação',50,true),orderValue=body.orderValue;
  if(!movements.has(movement))throw new UserError('Selecione uma movimentação válida.');
  if(typeof orderValue!=='number' || !Number.isFinite(orderValue) || orderValue<0 || orderValue>1e12 || Math.abs(orderValue*100-Math.round(orderValue*100))>1e-6)throw new UserError('Informe o valor do pedido em reais, com até duas casas decimais.');
  const delivery={recipient:text(d.recipient,'Destinatário',180,true),postalCode:text(d.postalCode,'CEP',9,true).replace(/-/g,''),street:text(d.street,'Logradouro',200,true),number:text(d.number,'Número',30,true),complement:text(d.complement,'Complemento',160),district:text(d.district,'Bairro',120,true),city:text(d.city,'Município',120,true),state:text(d.state,'UF de entrega',2,true).toUpperCase()};
  if(!/^\d{8}$/.test(delivery.postalCode))throw new UserError('Informe um CEP com 8 dígitos.');
  if(!states.has(delivery.state))throw new UserError('Selecione a UF de entrega.');
  if(!body.items.length || body.items.length>50)throw new UserError('Informe de 1 a 50 itens no pedido.');
  const items=body.items.map(item=>{
    if(!object(item) || !['equipment','accessory'].includes(item.kind))throw new UserError('Tipo de item inválido.');
    if(!Number.isSafeInteger(item.quantity) || item.quantity<1 || item.quantity>100000)throw new UserError('Cada quantidade deve ser um número inteiro entre 1 e 100.000.');
    const category=item.kind==='equipment'?text(item.category,'Tipo de equipamento',40):'';
    if(category && !['Impressora móvel','Impressora de mesa','Coletor de dados','Outro equipamento'].includes(category))throw new UserError('Selecione um tipo de equipamento válido.');
    return {kind:item.kind,brand:text(item.brand,'Marca',100),description:text(item.description,item.kind==='equipment'?'Equipamento / modelo':'Acessório',200,true),category,quantity:item.quantity};
  });
  return {snapshot,movement,orderValue,delivery,items,notes:text(body.notes,'Observações',3000)};
}
export function orderData(row){return {id:row.id,number:row.order_ref||'PED-'+row.id.slice(0,8).toUpperCase(),orderRef:row.order_ref||null,workflow:JSON.parse(row.workflow||'{}'),...JSON.parse(row.payload),status:row.status,revision:row.revision,createdAt:row.created_at,updatedAt:row.updated_at};}
export async function listOrders(env,client){
  if(!client)return [];
  const rows=await env.DB.prepare('SELECT * FROM client_orders WHERE client_id = ? ORDER BY created_at DESC, id DESC').bind(client.id).all();
  return (rows.results||[]).map(orderData);
}
export async function listGoalActuals(env,year){
  // Include UTC boundary days; assign the sale to its calendar month in Brazil.
  const start=new Date(Date.UTC(year-1,11,31)).toISOString();
  const end=new Date(Date.UTC(year+1,0,2)).toISOString();
  const rows=await env.DB.prepare('SELECT payload, created_at FROM client_orders WHERE created_at >= ? AND created_at < ?').bind(start,end).all();
  const centsByConsultant=Object.create(null);
  const historical=(await env.DB.prepare('SELECT consultant,month,amount_cents FROM sales_history WHERE year=?').bind(year).all()).results||[];
  const covered=new Set(),canonicalNames=new Map();
  for(const row of historical){const key=salesNameKey(row.consultant);covered.add(key+'|'+row.month);canonicalNames.set(key,row.consultant);(centsByConsultant[row.consultant] ||= Array(12).fill(0))[row.month-1]=row.amount_cents;}
  let orderCount=0,coveredOrderCount=0;
  for(const row of rows.results||[]){
    let order;try{order=JSON.parse(row.payload);}catch{continue;}
    const consultant=order?.snapshot?.consultant?.trim(),value=order?.orderValue;
    if(!consultant || !revenueMovements.has(order.movement) || typeof value!=='number' || !Number.isFinite(value) || value<=0)continue;
    const date=new Date(row.created_at);if(Number.isNaN(date.getTime()))continue;
    const parts=Object.fromEntries(brazilMonth.formatToParts(date).map(part=>[part.type,part.value]));
    if(Number(parts.year)!==year)continue;
    const month=Number(parts.month)-1;
    if(covered.has(salesNameKey(consultant)+'|'+(month+1))){coveredOrderCount++;continue;}
    const name=canonicalNames.get(salesNameKey(consultant))||consultant;
    (centsByConsultant[name] ||= Array(12).fill(0))[month]+=Math.round(value*100);
    orderCount++;
  }
  const monthly=Object.fromEntries(Object.entries(centsByConsultant).map(([name,months])=>[name,months.map(cents=>cents/100)]));
  return {year,monthly,orderCount,historicalMonthCount:historical.length,coveredOrderCount};
}
export async function saveOrder(request,env,context,ensureClient,user,actor=null){
  if(!request.headers.get('content-type')?.startsWith('application/json'))throw new UserError('Formato do pedido inválido.',415);
  let body;try{body=JSON.parse(new TextDecoder().decode(await limitedBody(request,64*1024)));}catch(error){if(error instanceof UserError)throw error;throw new UserError('Os dados do pedido são inválidos.');}
  const payload=validate(body,context);
  if(actor?.role==='commercial')payload.snapshot.consultant=actor.consultantName;
  const serialized=JSON.stringify(payload),projectKey=normalize(payload.snapshot.project),client=await ensureClient(env,context);
  const find=()=>env.DB.prepare('SELECT * FROM client_orders WHERE client_id = ? AND id = ?').bind(client.id,body.id).first();
  const projectValue=async()=>{const total=await env.DB.prepare("SELECT SUM(CAST(ROUND(json_extract(payload,'$.orderValue')*100) AS INTEGER)) AS cents FROM client_orders WHERE client_id=? AND project_key=?").bind(client.id,projectKey).first();return (Number(total?.cents)||0)/100;};
  let row=await find();
  if(row&&actor?.role==='commercial'&&normalize(JSON.parse(row.payload).snapshot.consultant)!==normalize(actor.consultantName))throw new UserError('Você só pode editar seus próprios pedidos.',403);
  if(!row){
    if(body.revision!==0)throw new UserError('Pedido não encontrado. Reabra o formulário.',409);
    const now=new Date().toISOString();
    // Independent orders share a project; retrying the same UUID stays idempotent.
    await env.DB.prepare('INSERT INTO client_orders (id,client_id,project_key,payload,status,revision,author_id,updated_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT DO NOTHING').bind(body.id,client.id,projectKey,serialized,'awaiting_setup',1,user,user,now,now).run();
    row=await find();
    if(row?.id===body.id && row.payload===serialized){await setProjectStage(env,client.id,payload.snapshot.project,'Aprovado',user,'order_new');return {order:orderData(row),created:true,projectValue:await projectValue()};}
  }
  if(!row || row.id!==body.id)throw new UserError('Não foi possível identificar este pedido. Reabra o formulário.',409);
  if(row.payload===serialized){await setProjectStage(env,client.id,payload.snapshot.project,'Aprovado',user,'order');return {order:orderData(row),created:false,projectValue:await projectValue()};}
  if(['dispatched','completed'].includes(row.status))throw new UserError('Pedido já despachado. Os dados da saída estão preservados no histórico.',409);
  if(row.revision!==body.revision)throw new UserError('Este pedido foi atualizado em outra sessão. Carregue o pedido salvo antes de editar novamente.',409);
  const updated=await env.DB.prepare('UPDATE client_orders SET payload = ?, project_key = ?, revision = revision + 1, updated_by = ?, updated_at = ? WHERE id = ? AND client_id = ? AND revision = ? RETURNING *').bind(serialized,projectKey,user,new Date().toISOString(),row.id,client.id,body.revision).first();
  if(!updated)throw new UserError('Este pedido foi atualizado em outra sessão. Carregue o pedido salvo antes de editar novamente.',409);
  await setProjectStage(env,client.id,payload.snapshot.project,'Aprovado',user,'order');
  return {order:orderData(updated),created:false,projectValue:await projectValue()};
}
