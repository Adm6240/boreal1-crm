import {UserError,limitedBody} from './email.mjs';
import {orderData} from './orders.mjs';
import {normalizeSerial, validateSerials, equipmentStatements} from './maintenance.mjs';
import {validateStockLines,stockDispatchStatements} from './inventory.mjs';
import {setProjectStage} from './project-stages.mjs';

const steps={
  stock_intake:{module:'stock',from:'awaiting_setup',to:body=>body.available?'maintenance':'awaiting_goods',label:'Estoque recebeu o pedido'},
  stock_arrived:{module:'stock',from:'awaiting_goods',to:'maintenance',label:'Mercadoria disponível no estoque'},
  maintenance_start:{module:'maintenance',from:'maintenance',to:'maintenance_in_progress',label:'Manutenção iniciada'},
  maintenance_finish:{module:'maintenance',from:'maintenance_in_progress',to:'dispatch_pending',label:'Configuração concluída; enviado à expedição'},
  dispatch_prepare:{module:'dispatch',from:'dispatch_pending',to:'dispatch_preparing',label:'Expedição iniciou o preparo'},
  dispatch_save:{module:'dispatch',from:'dispatch_preparing',to:'dispatch_preparing',label:'Dados da expedição salvos'},
  dispatch:{module:'dispatch',from:'dispatch_preparing',to:'dispatched',label:'Enviado pela expedição'},
  stock_complete:{module:'stock',from:'dispatched',to:'completed',label:'Entrega confirmada no cliente'}
};
const technicians=new Set(['Daniel','Felipe M.','Vitor']);
const carriers=new Set(['Correios','Latam','Interna','Transportadora']);
const datePattern=/^\d{4}-\d{2}-\d{2}$/;
function date(value,label){if(typeof value!=='string'||!datePattern.test(value)||Number.isNaN(Date.parse(value+'T12:00:00Z'))||new Date(value+'T12:00:00Z').toISOString().slice(0,10)!==value)throw new UserError(`Informe a ${label} válida.`);return value;}

export async function listWorkflowOrders(env){
  const rows=await env.DB.prepare('SELECT * FROM client_orders ORDER BY created_at DESC').all();
  return {orders:(rows.results||[]).map(orderData)};
}

export async function advanceWorkflow(request,env,id,user){
  if(!request.headers.get('content-type')?.startsWith('application/json'))throw new UserError('Formato inválido.',415);
  let body;try{body=JSON.parse(new TextDecoder().decode(await limitedBody(request,262144)));}catch(error){if(error instanceof UserError)throw error;throw new UserError('Dados da movimentação inválidos.');}
  if(!body||typeof body!=='object'||!Number.isSafeInteger(body.revision))throw new UserError('Reabra o pedido antes de movimentá-lo.');
  const step=body.action==='stock_warranty'?{module:'stock',from:null,to:null,label:'Garantia e data de venda cadastradas'}:steps[body.action];if(!step||body.module!==step.module)throw new UserError('Ação indisponível para este setor.',403);
  const row=await env.DB.prepare('SELECT * FROM client_orders WHERE id = ?').bind(id).first();
  if(!row)throw new UserError('Pedido não encontrado.',404);
  if((step.from&&row.status!==step.from)||row.revision!==body.revision)throw new UserError('O pedido mudou de etapa. Atualize a tela antes de continuar.',409);
  const workflow=JSON.parse(row.workflow||'{}'),now=new Date().toISOString();let orderRef=row.order_ref,details={};
  if(body.action==='stock_intake'){
    if(typeof body.available!=='boolean')throw new UserError('Informe se há mercadoria disponível.');
    orderRef=String(body.orderRef||'').trim();
    if(!/^[\p{L}\p{N}][\p{L}\p{N} ._/-]{0,79}$/u.test(orderRef))throw new UserError('Informe o número do pedido (até 80 caracteres).');
    const duplicate=await env.DB.prepare('SELECT id FROM client_orders WHERE order_ref = ? AND id != ?').bind(orderRef,id).first();
    if(duplicate)throw new UserError('Este número já pertence a outro pedido.',409);
    if(!Number.isSafeInteger(body.warrantyMonths)||body.warrantyMonths<0||body.warrantyMonths>120)throw new UserError('Informe a garantia do projeto de 0 a 120 meses.');
    workflow.warrantyMonths=body.warrantyMonths;workflow.saleAt=date(body.saleAt,'data de venda');
    details={available:body.available,orderRef,warrantyMonths:workflow.warrantyMonths,saleAt:workflow.saleAt};
  }
  if(body.action==='stock_warranty'){
    if(['dispatched','completed'].includes(row.status))throw new UserError('Pedido já enviado; dados históricos exigem revisão administrativa.');
    if(workflow.warrantyMonths!=null)throw new UserError('Garantia já cadastrada.');
    if(!Number.isSafeInteger(body.warrantyMonths)||body.warrantyMonths<0||body.warrantyMonths>120)throw new UserError('Informe garantia de 0 a 120 meses.');
    workflow.warrantyMonths=body.warrantyMonths;workflow.saleAt=date(body.saleAt,'data de venda');details={warrantyMonths:workflow.warrantyMonths,saleAt:workflow.saleAt};
  }
  if(body.action==='maintenance_start'){
    if(!Array.isArray(body.technicians)||body.technicians.length<1||body.technicians.length>technicians.size||new Set(body.technicians).size!==body.technicians.length||body.technicians.some(name=>!technicians.has(name)))throw new UserError('Selecione um ou mais técnicos da Manutenção.');
    workflow.technicians=[...body.technicians];details={technicians:workflow.technicians};
  }
  if(body.action==='maintenance_finish'){
    if(!Array.isArray(workflow.technicians)||!workflow.technicians.length)throw new UserError('Defina os técnicos antes de concluir a manutenção.');
    const notes=typeof body.configurationNotes==='string'?body.configurationNotes.trim():'';
    if(!notes||notes.length>2000)throw new UserError('Descreva a configuração realizada (até 2.000 caracteres).');
    workflow.configurationNotes=notes;details={configurationNotes:notes};
  }
  if(body.action==='dispatch_save'){
    const documentType=body.documentType;
    if(!['invoice','declaration'].includes(documentType))throw new UserError('Selecione nota fiscal ou declaração de conteúdo.');
    const invoiceNumber=typeof body.invoiceNumber==='string'?body.invoiceNumber.trim():'';
    if(invoiceNumber.length>80 || documentType==='invoice'&&!invoiceNumber)throw new UserError('Informe o número da nota fiscal.');
    if(!carriers.has(body.carrier))throw new UserError('Selecione a forma de transporte.');
    const carrierName=typeof body.carrierName==='string'?body.carrierName.trim():'';
    if(carrierName.length>160 || body.carrier==='Transportadora'&&!carrierName)throw new UserError('Informe o nome da transportadora.');
    if(!Number.isSafeInteger(body.volumeCount)||body.volumeCount<1||body.volumeCount>100000)throw new UserError('Informe a quantidade de volumes/caixas.');
    if(typeof body.serialChecked!=='boolean')throw new UserError('Informe se os números de série foram retirados e conferidos.');
    const serialNotes=typeof body.serialNotes==='string'?body.serialNotes.trim():'';
    if(serialNotes.length>3000)throw new UserError('As observações de número de série podem ter até 3.000 caracteres.');
    const equipmentSerials=validateSerials(body.equipmentSerials,JSON.parse(row.payload).items);
    for(const entry of equipmentSerials){const prior=await env.DB.prepare('SELECT order_id FROM service_equipment WHERE serial_key=?').bind(normalizeSerial(entry.serial)).first();if(prior&&prior.order_id!==id)throw new UserError('Número de série já registrado em outro pedido: '+entry.serial,409);}
    const stockLines=await validateStockLines(env,body.stockLines);
    workflow.shipping={stockLines,equipmentSerials,documentType,invoiceNumber:documentType==='invoice'?invoiceNumber:null,carrier:body.carrier,carrierName:body.carrier==='Transportadora'?carrierName:null,volumeCount:body.volumeCount,serialChecked:body.serialChecked,serialNotes};
    details={documentType,carrier:body.carrier,volumeCount:body.volumeCount,serialChecked:body.serialChecked};
  }
  if(body.action==='dispatch'){
    if(!workflow.shipping?.documentType||!workflow.shipping?.carrier||!workflow.shipping?.volumeCount||workflow.shipping?.serialChecked!==true)throw new UserError('Complete o preparo e confirme os números de série antes do envio.');
    if(body.approved!==true)throw new UserError('Confirme o despacho do pedido.');
    validateSerials(workflow.shipping.equipmentSerials,JSON.parse(row.payload).items);
    if(!Number.isSafeInteger(workflow.warrantyMonths)||!workflow.saleAt)throw new UserError('Este pedido antigo não tem garantia e data de venda. Cadastre esses dados antes do envio.');
    workflow.shipping.stockLines=await validateStockLines(env,workflow.shipping.stockLines);
    workflow.dispatchAt=date(body.dispatchAt,'data de despacho');if(workflow.dispatchAt<workflow.saleAt)throw new UserError('Despacho anterior à venda.');details={dispatchAt:workflow.dispatchAt};
  }
  if(body.action==='stock_complete'){
    workflow.receivedAt=date(body.receivedAt,'data de recebimento');
    if(workflow.receivedAt<workflow.dispatchAt)throw new UserError('O recebimento não pode ser anterior ao despacho.');
    details={receivedAt:workflow.receivedAt};
  }
  let status=typeof step.to==='function'?step.to(body):(step.to||row.status);if(status==='maintenance'&&!JSON.parse(row.payload).items.some(item=>item.kind==='equipment'))status='dispatch_pending';workflow.mutationKey=crypto.randomUUID();
  workflow.events=[...(workflow.events||[]),{action:body.action,label:status==='dispatch_pending'&&step.module==='stock'?'Mercadoria disponível; enviado à Expedição':step.label,status,at:now,by:user,...details}];
  let updated;
  try{const update=env.DB.prepare('UPDATE client_orders SET status = ?, order_ref = ?, workflow = ?, revision = revision + 1, updated_by = ?, updated_at = ? WHERE id = ? AND status = ? AND revision = ? RETURNING *').bind(status,orderRef,JSON.stringify(workflow),user,now,id,row.status,row.revision);
    if(body.action==='dispatch'){const results=await env.DB.batch([update,...stockDispatchStatements(env,row,workflow,now),...equipmentStatements(env,row,workflow,now)]);updated=results[0].results?.[0];}else updated=await update.first();}
  catch(error){if(String(error).includes('inventory_nonnegative'))throw new UserError('Saldo insuficiente para o despacho. Revise os itens ou registre a entrada da mercadoria.',409);if(String(error).includes('UNIQUE'))throw new UserError('Este número já pertence a outro pedido.',409);throw error;}
  if(!updated)throw new UserError('O pedido mudou de etapa. Atualize a tela antes de continuar.',409);
  if(status==='completed'){
    const project=JSON.parse(updated.payload)?.snapshot?.project;
    if(project){const pending=await env.DB.prepare("SELECT COUNT(*) AS n FROM client_orders WHERE client_id=? AND project_key=? AND status!='completed'").bind(updated.client_id,updated.project_key).first();await setProjectStage(env,updated.client_id,project,pending.n?'Aprovado':'Concluído',user,'workflow');}
  }
  return {order:orderData(updated)};
}
