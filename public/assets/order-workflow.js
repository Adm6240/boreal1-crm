(() => {
  'use strict';
  const escape=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const stages=[['awaiting_setup','Pedidos pendentes'],['awaiting_goods','Aguardando mercadoria'],['maintenance','Aguardando Manutenção'],['maintenance_in_progress','Em Manutenção'],['dispatch_pending','Disponível para Expedição'],['dispatch_preparing','Em preparo'],['dispatched','Despachado'],['completed','Concluído']];
  const maintenanceStages=[['maintenance','Aguardando Manutenção'],['maintenance_in_progress','Em Manutenção'],['maintenance_done','Concluído']];
  const dispatchStages=[['dispatch_pending','Disponível para Expedição'],['dispatch_preparing','Em preparo'],['dispatch_done','Enviado']];
  const areas=new Set(['stock','maintenance','dispatch']);
  const el=id=>document.getElementById(id);
  const date=value=>value?String(value).slice(0,10).split('-').reverse().join('/'):'—';
  const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  let orders=[],loadVersion=0,selected=null,previousFocus=null,saving=false;
  const overlay=document.createElement('div');overlay.className='workflow-overlay';overlay.id='workflowOverlay';overlay.hidden=true;
  overlay.innerHTML=`<section class="workflow-dialog" role="dialog" aria-modal="true" aria-labelledby="workflowTitle" tabindex="-1"><header class="workflow-head"><div><p class="eyebrow">GERENCIAMENTO DE PEDIDOS</p><h2 id="workflowTitle">Pedido</h2></div><button type="button" id="workflowClose" aria-label="Fechar">×</button></header><div class="workflow-body" id="workflowBody"></div><form id="workflowForm"><div id="workflowFields"></div><p class="workflow-error" id="workflowError" role="alert"></p><footer><button type="button" class="secondary" id="workflowCancel">Fechar</button><button type="button" class="secondary" id="workflowSend" hidden>Confirmar envio</button><button type="submit" class="primary" id="workflowSubmit">Avançar pedido</button></footer></form></section>`;
  document.body.appendChild(overlay);
  const form=el('workflowForm');
  const equipment=order=>order.items.filter(item=>item.kind==='equipment').map(item=>`${item.quantity} × ${[item.brand,item.description].filter(Boolean).join(' ')}`).join(', ');
  const statusLabel=order=>stages.find(([status])=>status===order.status)?.[1]||'Pedidos pendentes';
  function ticket(order){
    const heading=order.status==='awaiting_setup'?'Pedido sem número':order.number;
    const when=order.status==='dispatched'?`Despacho: ${date(order.workflow.dispatchAt)}`:order.status==='completed'?`Recebido: ${date(order.workflow.receivedAt)}`:'';
    const team=order.workflow?.technicians?.length?`<small>Técnicos: ${escape(order.workflow.technicians.join(', '))}</small>`:'';
    const shipping=order.workflow?.shipping,shippingLine=shipping?`<small>${shipping.documentType==='invoice'?`NF ${escape(shipping.invoiceNumber)}`:'Declaração de conteúdo'} · ${escape(shipping.carrier)} · ${shipping.volumeCount} ${shipping.volumeCount===1?'volume':'volumes'}</small>`:'';
    return `<button type="button" class="order-ticket" data-workflow-order="${escape(order.id)}"><span class="order-ticket-ref">${escape(heading)}</span><strong>${escape(order.snapshot.client)}</strong><span class="order-ticket-items">${escape(equipment(order))}</span>${team}${shippingLine}${when?`<small>${escape(when)}</small>`:''}</button>`;
  }
  function render(){
    el('stockBoard').innerHTML=stages.map(([status,label])=>{
      const list=orders.filter(order=>order.status===status);
      return `<section class="column order-column" data-stage="${status}"><div class="column-head"><b>${label} <span>${list.length}</span></b></div>${list.length?list.map(ticket).join(''):'<div class="pipeline-empty"><b>Nenhum pedido</b><span>Os pedidos desta etapa aparecerão aqui.</span></div>'}</section>`;
    }).join('');
    el('maintenanceBoard').innerHTML=maintenanceStages.map(([status,label])=>{
      const list=orders.filter(order=>status==='maintenance_done'?['dispatch_pending','dispatch_preparing','dispatched','completed'].includes(order.status):order.status===status);
      return `<section class="column order-column" data-stage="${status}"><div class="column-head"><b>${label} <span>${list.length}</span></b></div>${list.length?list.map(ticket).join(''):'<div class="pipeline-empty"><b>Nenhum pedido</b><span>Os pedidos desta etapa aparecerão aqui.</span></div>'}</section>`;
    }).join('');
    const waiting=orders.filter(order=>order.status==='maintenance').length,progress=orders.filter(order=>order.status==='maintenance_in_progress').length;
    el('maintenanceStatus').textContent=`${waiting} ${waiting===1?'pedido aguardando':'pedidos aguardando'} · ${progress} em execução`;
    el('dispatchBoard').innerHTML=dispatchStages.map(([status,label])=>{
      const list=orders.filter(order=>status==='dispatch_done'?['dispatched','completed'].includes(order.status):order.status===status);
      return `<section class="column order-column" data-stage="${status}"><div class="column-head"><b>${label} <span>${list.length}</span></b></div>${list.length?list.map(ticket).join(''):'<div class="pipeline-empty"><b>Nenhum pedido</b><span>Os pedidos desta etapa aparecerão aqui.</span></div>'}</section>`;
    }).join('');
    const waitingDispatch=orders.filter(order=>order.status==='dispatch_pending').length,preparing=orders.filter(order=>order.status==='dispatch_preparing').length;
    el('dispatchStatus').textContent=`${waitingDispatch} disponíveis · ${preparing} em preparo`;
    el('stockStatus').textContent=`${orders.length} ${orders.length===1?'pedido acompanhado':'pedidos acompanhados'} · atualização automática`;
  }
  async function refresh(){
    const version=++loadVersion;
    try{
      const response=await fetch('/api/orders/workflow',{credentials:'same-origin'});if(!response.ok)throw new Error();
      const data=await response.json();if(version!==loadVersion||!window.document)return;
      orders=data.orders;render();
    }catch{if(version!==loadVersion||!window.document)return;orders=[];render();for(const area of areas)el(area+'Status').textContent='Não foi possível carregar os pedidos. Abra esta área novamente para tentar.';}
  }
  function stepFor(order,area){
    if(!window.BorealAuth?.canWorkflow(area))return null;
    if(area==='stock'&&order.workflow.warrantyMonths==null&&order.status!=='awaiting_setup'&&!['dispatched','completed'].includes(order.status))return 'stock_warranty';
    if(area==='stock')return {awaiting_setup:'stock_intake',awaiting_goods:'stock_arrived',dispatched:'stock_complete'}[order.status]||null;
    if(area==='maintenance')return {maintenance:'maintenance_start',maintenance_in_progress:'maintenance_finish'}[order.status]||null;
    if(area==='dispatch')return {dispatch_pending:'dispatch_prepare',dispatch_preparing:'dispatch_save'}[order.status]||null;
    return null;
  }
  const labels={stock_warranty:'Cadastrar garantia',stock_intake:'Receber no Estoque',stock_arrived:'Encaminhar à Manutenção',maintenance_start:'Iniciar Manutenção',maintenance_finish:'Concluir e enviar à Expedição',dispatch_prepare:'Iniciar preparo',dispatch_save:'Salvar preparo',dispatch:'Confirmar envio',stock_complete:'Concluir pedido'};
  function fields(action){
    if(action==='stock_warranty')return `<label>Garantia do projeto (meses)<input name="warrantyMonths" type="number" min="0" max="120" step="1" required></label><label>Data de venda<input name="saleAt" type="date" required></label>`;
    if(action==='stock_intake')return `<label>Número do pedido<input name="orderRef" required maxlength="80" autocomplete="off" placeholder="Ex.: 1234/2026"></label><label>Garantia do projeto (meses)<input name="warrantyMonths" type="number" min="0" max="120" step="1" required placeholder="Ex.: 36"></label><label>Data de venda<input name="saleAt" type="date" required value="${today()}"></label><fieldset><legend>Mercadoria disponível?</legend><label class="workflow-radio"><input type="radio" name="available" value="yes" required> Sim, encaminhar ao preparo</label><label class="workflow-radio"><input type="radio" name="available" value="no"> Não, aguardar mercadoria</label></fieldset>`;
    if(action==='stock_arrived')return `<p>A mercadoria chegou ao Estoque? Encaminhe ao preparo. Pedidos somente de acessórios seguem para a Expedição.</p>`;
    if(action==='maintenance_start')return `<fieldset class="workflow-technicians"><legend>Técnicos responsáveis pela configuração</legend><p>Selecione todos os técnicos que atuarão neste pedido.</p>${['Daniel','Felipe M.','Vitor'].map(name=>`<label class="workflow-radio"><input type="checkbox" name="technicians" value="${name}"> ${name}</label>`).join('')}</fieldset>`;
    if(action==='maintenance_finish')return `<label>Configuração realizada<textarea name="configurationNotes" required maxlength="2000" rows="4" placeholder="Descreva o que foi configurado"></textarea></label>`;
    if(action==='dispatch_prepare')return `<p>O pedido passará para Em preparo. Preencha o documento, o transporte, os volumes e a conferência dos números de série antes de enviá-lo.</p>`;
    if(action==='dispatch_save'){
      const shipping=selected.workflow.shipping||{};
      return `<div id="dispatchStockSelection"><p>Carregando itens do estoque…</p></div><label>Documento de envio<select name="documentType" required><option value="">Selecione</option><option value="invoice" ${shipping.documentType==='invoice'?'selected':''}>Nota fiscal</option><option value="declaration" ${shipping.documentType==='declaration'?'selected':''}>Declaração de conteúdo</option></select></label><label data-invoice>Número da nota fiscal<input name="invoiceNumber" maxlength="80" value="${escape(shipping.invoiceNumber||'')}" placeholder="Informe o número da nota"></label><label>Transporte<select name="carrier" required><option value="">Selecione</option>${['Correios','Latam','Interna','Transportadora'].map(name=>`<option ${shipping.carrier===name?'selected':''}>${name}</option>`).join('')}</select></label><label data-carrier-name>Nome da transportadora<input name="carrierName" maxlength="160" value="${escape(shipping.carrierName||'')}"></label><label>Quantidade de volumes / caixas<input name="volumeCount" type="number" min="1" max="100000" step="1" required value="${shipping.volumeCount||''}"></label><fieldset><legend>Números de série retirados e conferidos?</legend><label class="workflow-radio"><input type="radio" name="serialChecked" value="yes" required ${shipping.serialChecked===true?'checked':''}> Sim</label><label class="workflow-radio"><input type="radio" name="serialChecked" value="no" ${shipping.serialChecked===false?'checked':''}> Não</label></fieldset>${selected.items.map((item,i)=>item.kind==='equipment'?`<label>${escape(item.description)} · ${item.quantity} série(s)<textarea name="equipmentSerials_${i}" required rows="4" maxlength="240000" placeholder="Uma série por linha">${escape((shipping.equipmentSerials||[]).filter(e=>e.itemIndex===i).map(e=>e.serial).join('\n'))}</textarea></label>`:'').join('')}<label>Números de série / observações <span class="order-optional">Opcional</span><textarea name="serialNotes" maxlength="3000" rows="3">${escape(shipping.serialNotes||'')}</textarea></label>`;
    }
    if(action==='dispatch')return `<label>Data de despacho<input type="date" name="dispatchAt" required value="${today()}"></label><label class="workflow-radio"><input type="checkbox" name="approved" required> Conferi o pedido e autorizo o despacho</label>`;
    if(action==='stock_complete')return `<label>Data de recebimento pelo cliente<input type="date" name="receivedAt" required min="${escape(selected.workflow.dispatchAt||'')}" value="${today()}"></label>`;
    return '';
  }
  function open(id){
    const order=orders.find(item=>item.id===id);if(!order)return;
    selected=order;previousFocus=document.activeElement;
    const area=document.querySelector('.order-area.active')?.id,action=stepFor(order,area);
    overlay.dataset.action=action||'';overlay.dataset.module=area||'';overlay.hidden=false;
    el('workflowTitle').textContent=`Pedido ${order.orderRef||'pendente de numeração'}`;
    const address=order.delivery;
    const shipping=order.workflow.shipping;
    el('workflowBody').innerHTML=`<div class="workflow-summary"><div><span>Cliente</span><b>${escape(order.snapshot.client)}</b></div><div><span>Projeto</span><b>${escape(order.snapshot.project)}</b></div><div><span>Consultor</span><b>${escape(order.snapshot.consultant)}</b></div><div><span>Movimentação</span><b>${escape(order.movement)}</b></div><div><span>Software</span><b>${escape(order.snapshot.software||'Não cadastrado')}</b></div><div><span>Etapa</span><b>${escape(statusLabel(order))}</b></div>${order.workflow.technicians?.length?`<div class="workflow-team"><span>Técnicos responsáveis</span><b>${escape(order.workflow.technicians.join(', '))}</b></div>`:''}</div><h3>Garantia do projeto</h3><p>${order.workflow.warrantyMonths!=null?`${order.workflow.warrantyMonths} meses · Venda: ${date(order.workflow.saleAt)}`:'Pendente de cadastro'}</p><h3>Equipamentos e acessórios</h3><ul>${order.items.map(item=>`<li>${item.quantity} × ${escape([item.brand,item.description].filter(Boolean).join(' '))}${item.kind==='accessory'?' · acessório':''}</li>`).join('')}</ul><h3>Entrega</h3><p>${escape(address.recipient)} · ${escape(address.street)}, ${escape(address.number)}${address.complement?', '+escape(address.complement):''}<br>${escape(address.district)} · ${escape(address.city)}/${escape(address.state)} · CEP ${escape(address.postalCode)}</p>${order.notes?`<h3>Observações do comercial</h3><p>${escape(order.notes)}</p>`:''}${order.workflow.configurationNotes?`<h3>Configuração realizada</h3><p>${escape(order.workflow.configurationNotes)}</p>`:''}${shipping?`<h3>Preparo da expedição</h3><p>${shipping.documentType==='invoice'?`Nota fiscal ${escape(shipping.invoiceNumber)}`:'Declaração de conteúdo'} · ${escape(shipping.carrier)}${shipping.carrierName?' ('+escape(shipping.carrierName)+')':''} · ${shipping.volumeCount} ${shipping.volumeCount===1?'volume':'volumes'}<br>Números de série: ${shipping.serialChecked?'retirados e conferidos':'pendentes de conferência'}${shipping.serialNotes?'<br>'+escape(shipping.serialNotes):''}</p>`:''}<h3>Acompanhamento</h3><p>Próxima etapa: ${escape(({awaiting_setup:'Triagem do Estoque',awaiting_goods:'Recebimento da mercadoria',maintenance:'Iniciar configuração',maintenance_in_progress:'Expedição',dispatch_pending:'Preparar envio',dispatch_preparing:'Despacho',dispatched:'Confirmação de recebimento pelo Estoque',completed:'Pedido concluído'})[order.status]||'—')}<br>Última movimentação: ${escape(order.workflow.events?.at(-1)?.label||'Pedido gerado pelo comercial')}${order.status==='awaiting_goods'?'<br>Pendência: aguardando chegada da mercadoria.':''}</p><h3>Histórico do pedido</h3><ol class="workflow-events">${(order.workflow.events||[]).map(item=>`<li>${escape(item.label)}${item.technicians?.length?` · ${escape(item.technicians.join(', '))}`:''} · ${escape(new Date(item.at).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo',dateStyle:'short',timeStyle:'short'}))}</li>`).join('')||'<li>Pedido gerado pelo comercial</li>'}</ol>`;
    el('workflowFields').innerHTML=action?fields(action):'';
    if(action==='dispatch_save')window.BorealInventory?.prepareDispatch(selected);
    el('workflowSubmit').hidden=!action;el('workflowSubmit').textContent=labels[action]||'';
    el('workflowSend').hidden=action!=='dispatch_save'||order.workflow.shipping?.serialChecked!==true;
    el('workflowSend').disabled=false;updateDispatchFields();
    el('workflowError').textContent='';overlay.querySelector('[role="dialog"]').focus();
  }
  function close(){if(saving)return;overlay.hidden=true;selected=null;previousFocus?.focus();}
  function updateDispatchFields(){
    if(overlay.dataset.action!=='dispatch_save')return;
    const invoice=form.elements.namedItem('documentType').value==='invoice',carrier=form.elements.namedItem('carrier').value==='Transportadora';
    const invoiceField=form.querySelector('[data-invoice]'),carrierField=form.querySelector('[data-carrier-name]');
    invoiceField.hidden=!invoice;invoiceField.querySelector('input').required=invoice;
    carrierField.hidden=!carrier;carrierField.querySelector('input').required=carrier;
  }
  document.addEventListener('click',event=>{const button=event.target.closest('[data-workflow-order]');if(button)open(button.dataset.workflowOrder);});
  el('workflowClose').onclick=close;el('workflowCancel').onclick=close;
  overlay.addEventListener('click',event=>{if(event.target===overlay)close();});
  document.addEventListener('keydown',event=>{if(!overlay.hidden&&event.key==='Escape'){event.preventDefault();close();}});
  form.addEventListener('input',()=>{if(overlay.dataset.action==='dispatch_save')el('workflowSend').disabled=true;});
  form.addEventListener('change',updateDispatchFields);
  el('workflowSend').onclick=()=>{
    if(saving||!selected)return;
    overlay.dataset.action='dispatch';el('workflowFields').innerHTML=fields('dispatch');
    el('workflowSubmit').textContent=labels.dispatch;el('workflowSend').hidden=true;el('workflowError').textContent='';
  };
  form.addEventListener('submit',async event=>{
    event.preventDefault();if(saving||!selected||!form.reportValidity())return;
    const action=overlay.dataset.action,module=overlay.dataset.module,body={action,module,revision:selected.revision};
    if(['stock_intake','stock_warranty'].includes(action)){body.warrantyMonths=Number(form.elements.namedItem('warrantyMonths').value);body.saleAt=form.elements.namedItem('saleAt').value;}
    if(action==='stock_intake'){body.orderRef=form.elements.namedItem('orderRef').value;body.available=form.elements.namedItem('available').value==='yes';}
    if(action==='maintenance_start'){
      body.technicians=[...form.querySelectorAll('input[name="technicians"]:checked')].map(input=>input.value);
      if(!body.technicians.length){el('workflowError').textContent='Selecione pelo menos um técnico responsável.';return;}
    }
    if(action==='maintenance_finish')body.configurationNotes=form.elements.namedItem('configurationNotes').value;
    if(action==='dispatch_save'){
      try{body.stockLines=window.BorealInventory.readDispatch();}catch(error){el('workflowError').textContent=error.message;return;}
      body.equipmentSerials=selected.items.flatMap((item,i)=>item.kind==='equipment'?form.elements.namedItem('equipmentSerials_'+i).value.split(/\r?\n/).map(v=>v.trim()).filter(Boolean).map(serial=>({itemIndex:i,serial})):[]);
      body.documentType=form.elements.namedItem('documentType').value;
      body.invoiceNumber=form.elements.namedItem('invoiceNumber').value;
      body.carrier=form.elements.namedItem('carrier').value;
      body.carrierName=form.elements.namedItem('carrierName').value;
      body.volumeCount=Number(form.elements.namedItem('volumeCount').value);
      body.serialChecked=form.elements.namedItem('serialChecked').value==='yes';
      body.serialNotes=form.elements.namedItem('serialNotes').value;
    }
    if(action==='dispatch'){body.dispatchAt=form.elements.namedItem('dispatchAt').value;body.approved=form.elements.namedItem('approved').checked;}
    if(action==='stock_complete')body.receivedAt=form.elements.namedItem('receivedAt').value;
    saving=true;el('workflowSubmit').disabled=true;el('workflowError').textContent='';
    try{
      const response=await fetch(`/api/orders/workflow/${encodeURIComponent(selected.id)}`,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
      const data=await response.json();if(!response.ok)throw new Error(data.error||'Não foi possível movimentar o pedido.');
      orders=orders.map(order=>order.id===data.order.id?data.order:order);saving=false;el('workflowSubmit').disabled=false;close();render();window.dispatchEvent(new Event('boreal:inventory-changed'));
      if(action==='dispatch'||action==='stock_complete')window.BorealGeo?.refresh();
    }catch(error){saving=false;el('workflowSubmit').disabled=false;el('workflowError').textContent=error.message;}
  });
  document.addEventListener('boreal:view',event=>{if(areas.has(event.detail))refresh();});
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&document.querySelector('.order-area.active'))refresh();});
  setInterval(()=>{if(window.document&&document.visibilityState==='visible'&&document.querySelector('.order-area.active')&&!saving)refresh();},10000);
  window.BorealOrderFlow={refresh};
})();
