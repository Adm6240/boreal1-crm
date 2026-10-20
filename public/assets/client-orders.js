(() => {
  'use strict';
  const escape=value=>String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const normalize=value=>String(value||'').normalize('NFC').trim().toLocaleLowerCase('pt-BR').replace(/\s+/g,' ');
  const sameClient=(a,b)=>normalize(a.client)===normalize(b.client) && a.state===b.state;
  const query=r=>new URLSearchParams({client:r.client,state:r.state}).toString();
  const date=value=>new Date(value).toLocaleString('pt-BR',{dateStyle:'short',timeStyle:'short'});
  const money=value=>Number(value||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
  function parseOrderValue(raw){
    const value=String(raw||'').trim().replace(/^R\$\s*/i,'').replace(/\s/g,'');
    const normalized=value.replace(/\./g,'');
    if(!/^\d+(?:,\d{1,2})?$/.test(normalized))return null;
    const [whole,cents='']=normalized.split(','),amount=Number(whole)+Number(cents.padEnd(2,'0'))/100;
    return Number.isFinite(amount)&&amount<=1e12?Math.round(amount*100)/100:null;
  }
  const states='AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO'.split(' ');
  const deliveryNames=['recipient','postalCode','street','number','complement','district','city','state'];
  const overlay=document.createElement('div');overlay.id='clientOrderModal';overlay.className='client-order-overlay';overlay.hidden=true;
  overlay.innerHTML=`<section class="client-order-dialog" role="dialog" aria-modal="true" aria-labelledby="orderTitle" tabindex="-1">
    <header class="order-head"><div><p class="eyebrow">PROJETO GANHO · PEDIDO</p><h2 id="orderTitle">Preparar pedido</h2><p id="orderSubtitle"></p></div><button type="button" id="closeClientOrder" class="order-close" aria-label="Fechar pedido">×</button></header>
    <form id="clientOrderForm">
      <div class="order-scroll">
        <div class="order-pending"><b>Fluxo de atendimento</b><p>Ao salvar, o pedido aparece em Pedidos pendentes no Estoque para receber o número do pedido e seguir entre os setores.</p></div>
        <p id="orderFormStatus" class="order-status" role="status" aria-live="polite"></p>
        <div id="orderReload" hidden><p>Carregar o pedido salvo substitui as alterações deste formulário.</p><button type="button" class="secondary" id="reloadClientOrder">Carregar pedido salvo</button></div>
        <fieldset id="orderFields" class="order-fields">
          <section class="order-section"><h3>Dados do projeto</h3><p class="order-help">Informações disponíveis no cadastro, preenchidas automaticamente.</p>
            <label class="order-label">Projeto<select id="orderProject" required></select></label>
            <dl id="orderAutoFields" class="order-auto"></dl>
            <label class="order-label">Software <span class="order-auto-label">Automático</span><input id="orderSoftware" readonly aria-describedby="orderSoftwareHelp"></label><p id="orderSoftwareHelp" class="order-help"></p>
          </section>
          <section class="order-section"><h3>Dados do pedido</h3><div class="order-commercial-grid">
            <label class="order-label">Movimentação<select id="orderMovement" required><option value="">Selecione a movimentação</option><option>Venda</option><option>Locação simples (CL100)</option><option>Locação com compras (CL200)</option><option>Empréstimo</option><option>Doação</option><option>Substituição</option></select></label>
            <label class="order-label">Valor do pedido (R$)<input id="orderValue" type="text" inputmode="decimal" autocomplete="off" required placeholder="Ex.: 42.000,00" aria-describedby="orderValueHelp"></label>
          </div><p id="orderValueHelp" class="order-help">Informe 0,00 quando não houver cobrança.</p></section>
          <fieldset class="order-section"><legend>Endereço de entrega</legend><div class="order-address-grid">
            <label class="order-label order-wide">Destinatário<input name="recipient" maxlength="180" required autocomplete="shipping organization"></label>
            <label class="order-label">CEP<input name="postalCode" inputmode="numeric" pattern="[0-9]{5}-?[0-9]{3}" maxlength="9" placeholder="00000-000" required autocomplete="shipping postal-code" title="Informe os 8 dígitos do CEP."></label>
            <p id="orderCepStatus" class="cep-status" role="status" aria-live="polite"></p>
            <label class="order-label order-street">Logradouro<input name="street" maxlength="200" required autocomplete="shipping address-line1" placeholder="Rua, avenida…"></label>
            <label class="order-label">Número<input name="number" maxlength="30" required placeholder="Número ou S/N"></label>
            <label class="order-label order-half">Complemento <span class="order-optional">Opcional</span><input name="complement" maxlength="160" autocomplete="shipping address-line2"></label>
            <label class="order-label order-half">Bairro<input name="district" maxlength="120" required></label>
            <label class="order-label order-city">Município<input name="city" maxlength="120" required autocomplete="shipping address-level2"></label>
            <label class="order-label">UF<select name="state" required autocomplete="shipping address-level1"><option value="">Selecione</option>${states.map(uf=>`<option>${uf}</option>`).join('')}</select></label>
          </div></fieldset>
          <section class="order-section"><div class="order-section-head"><h3>Equipamentos</h3><button type="button" class="order-add" id="orderAddEquipment">＋ Adicionar equipamento</button></div><div id="orderEquipmentList"></div></section>
          <section class="order-section"><div class="order-section-head"><h3>Acessórios <span class="order-optional">Opcional</span></h3><button type="button" class="order-add" id="orderAddAccessory">＋ Adicionar acessório</button></div><p class="order-help" id="orderNoAccessories">Nenhum acessório adicionado.</p><div id="orderAccessoryList"></div></section>
          <label class="order-label order-notes">Observações <span class="order-optional">Opcional</span><textarea id="orderNotes" maxlength="3000" rows="3" placeholder="Informações para preparar este pedido"></textarea></label>
        </fieldset>
      </div>
      <div id="orderDiscard" class="order-discard" hidden role="alert"><span>Há alterações não salvas neste pedido.</span><button type="button" class="secondary" id="orderKeepEditing">Continuar preenchendo</button><button type="button" class="secondary" id="orderDiscardChanges">Descartar e fechar</button></div>
      <footer class="order-footer"><span id="orderSaveHint">Salvo no histórico do cliente</span><button type="button" class="secondary" id="cancelClientOrder">Fechar</button><button type="submit" class="primary order-save" id="saveClientOrder">Salvar pedido</button></footer>
    </form>
  </section>`;
  document.body.appendChild(overlay);
  const el=id=>document.getElementById(id),form=el('clientOrderForm'),projectSelect=el('orderProject'),fields=el('orderFields'),status=el('orderFormStatus');
  const resetPostalLookup=window.BorealPostalCode.attach(form,{status:el('orderCepStatus')});
  let context=null,projects=[],orders=[],current=null,snapshot=null,dirty=false,busy=false,previousFocus=null,loadVersion=0;
  let inertNodes=[];
  async function api(url,options={}){
    const response=await fetch(url,{credentials:'same-origin',...options});let data;
    try{data=await response.json();}catch{throw new Error('Não foi possível acessar o pedido. Entre novamente no Boreal.');}
    if(!response.ok){const error=new Error(data.error || 'Não foi possível salvar o pedido.');error.status=response.status;throw error;}return data;
  }
  function showStatus(message,error=false){status.textContent=message;status.classList.toggle('error',error);}
  function setBusy(value){busy=value;fields.disabled=value;['saveClientOrder','closeClientOrder','cancelClientOrder','reloadClientOrder'].forEach(id=>el(id).disabled=value);form.setAttribute('aria-busy',String(value));}
  function projectForRecord(record){
    if(typeof activityProjectName==='function')return activityProjectName(record);
    const subject=String(record.subject||'').trim();
    // Some activities inherited another project's label when they were created.
    // A distinct project title in the activity identifies its opportunity.
    return /^projeto\b/i.test(subject) && normalize(subject)!==normalize(record.project) && normalize(subject)!==normalize(`Projeto ${record.project}`)?subject:record.project;
  }
  function getProjects(record){
    const records=[record,...(typeof activityRecords==='undefined'?[]:activityRecords.filter(r=>sameClient(r,record))),...(typeof deals==='undefined'?[]:deals.filter(r=>sameClient(r,record)))];
    const found=new Map();
    for(const r of records){
      if(!r.project || r.project==='Histórico do cliente')continue;
      const candidate={...r,project:projectForRecord(r)};
      const k=normalize(candidate.project);if(!found.has(k))found.set(k,candidate);
    }
    for(const order of orders){const k=normalize(order.snapshot.project);if(!found.has(k))found.set(k,{...order.snapshot,owner:order.snapshot.consultant});}
    return [...found.values()];
  }
  function linkedClient(record){return window.BorealClients?.getById(record?.clientProfileId||context.clientProfileId)||window.BorealClients?.get(context.client,context.state)}
  function snapshotFor(record){const client=linkedClient(record),user=window.BorealAuth?.user,activityOwner=record.ownerName || (record.owner==='FH'?'Consultor Exemplo':record.owner==='DF'?'Danielle':record.owner) || '',consultant=user?.role==='commercial'?(user.consultantName||user.name):activityOwner;return {client:context.client,state:client?.state||context.state,project:record.project,consultant,contact:client?.commercial?.name || record.contact || '',email:client?.commercial?.email || record.email || '',phone:client?.commercial?.phone || record.phone || '',value:Number(record.value || 0),software:record.software || client?.software || null};}
  function renderAuto(){
    const values=[['Cliente',snapshot.client],['Consultor',snapshot.consultant || 'Não cadastrado'],['Contato',snapshot.contact || 'Não informado'],['E-mail',snapshot.email || 'Não informado'],['Telefone',snapshot.phone || 'Não informado'],['Valor do projeto',money(snapshot.value)]];
    el('orderAutoFields').innerHTML=values.map(([label,value])=>`<div><dt>${label}</dt><dd>${escape(value)}</dd></div>`).join('');
    el('orderSoftware').value=snapshot.software || 'Não cadastrado';el('orderSoftwareHelp').textContent=snapshot.software?'Preenchido automaticamente a partir do cadastro.':'O software ainda não está cadastrado para este cliente.';
  }
  function updateItems(){
    const equipment=[...el('orderEquipmentList').children];equipment.forEach((row,i)=>{const button=row.querySelector('button');button.disabled=false;button.setAttribute('aria-label',`Remover equipamento ${i+1}`);});
    [...el('orderAccessoryList').children].forEach((row,i)=>row.querySelector('button').setAttribute('aria-label',`Remover acessório ${i+1}`));
    el('orderNoAccessories').hidden=!!el('orderAccessoryList').children.length;
  }
  function addItem(kind,item={}){
    if(overlay.querySelectorAll('.order-item').length>=50){showStatus('O pedido pode ter até 50 itens.',true);return;}
    const row=document.createElement('div');row.className='order-item '+kind;row.dataset.kind=kind;
    row.innerHTML=`${kind==='equipment'?'<label class="order-label">Marca <span class="order-optional">Opcional</span><input data-field="brand" maxlength="100" placeholder="Marca"></label><label class="order-label">Tipo <span class="order-optional">Opcional</span><select data-field="category"><option value="">Sem classificação</option><option>Impressora móvel</option><option>Impressora de mesa</option><option>Coletor de dados</option><option>Outro equipamento</option></select></label>':''}<label class="order-label">${kind==='equipment'?'Equipamento / modelo':'Acessório'}<input data-field="description" maxlength="200" required placeholder="${kind==='equipment'?'Informe o modelo':'Descreva o acessório'}"></label><label class="order-label">Quantidade<input data-field="quantity" type="number" min="1" max="100000" step="1" required value="1" inputmode="numeric"></label><button type="button" class="order-remove" title="Remover item">×</button>`;
    for(const name of ['brand','category','description','quantity'])if(row.querySelector(`[data-field="${name}"]`) && item[name]!=null)row.querySelector(`[data-field="${name}"]`).value=item[name];
    row.querySelector('button').onclick=()=>{row.remove();dirty=true;updateItems();};
    el(kind==='equipment'?'orderEquipmentList':'orderAccessoryList').appendChild(row);updateItems();return row;
  }
  function selectProject(index,orderId=null){
    const record=projects[index];if(!record)return;
    const saved=orderId?orders.find(o=>o.id===orderId&&normalize(o.snapshot.project)===normalize(record.project)):null;
    current=saved || {id:crypto.randomUUID(),revision:0};snapshot=saved?{...saved.snapshot,client:context.client,state:context.state}:snapshotFor(record);
    projectSelect.disabled=!!saved;renderAuto();el('orderTitle').textContent=saved?`Pedido ${saved.number}`:'Preparar pedido';
    el('orderSubtitle').textContent=context.client;el('orderSaveHint').textContent=saved?'Atualização no histórico do cliente':'Salvo no histórico do cliente';
    const client=linkedClient(record);
    const delivery=saved?.delivery || client?.delivery || {recipient:record.contact || context.client,state:context.state};
    for(const name of deliveryNames)form.elements.namedItem(name).value=delivery[name] || '';
    el('orderMovement').value=saved?.movement || '';el('orderValue').value=saved?.orderValue!=null?money(saved.orderValue):'';el('orderValue').setCustomValidity('');
    el('orderEquipmentList').replaceChildren();el('orderAccessoryList').replaceChildren();
    for(const item of saved?.items || [{kind:'equipment',quantity:1}])addItem(item.kind,item);
    updateItems();el('orderNotes').value=saved?.notes || '';dirty=false;el('orderDiscard').hidden=true;el('orderReload').hidden=true;
    const priorCount=orders.filter(o=>normalize(o.snapshot.project)===normalize(record.project)).length;showStatus(saved?`Pedido salvo em ${date(saved.updatedAt)}. Você pode atualizar os dados.`:priorCount?`${priorCount} pedido(s) já registrado(s) neste projeto. Este formulário cria um novo pedido.`:'');
    el('saveClientOrder').textContent=saved?'Salvar alterações':'Salvar pedido';
    if(!snapshot.consultant){showStatus('Defina o consultor responsável no cadastro do projeto para salvar o pedido.',true);el('saveClientOrder').disabled=true;}
  }
  async function load(orderId,selectedProject){
    const version=++loadVersion;setBusy(true);showStatus('Carregando dados do pedido…');el('orderReload').hidden=true;
    try{
      const data=await api(`/api/client-orders?${query(context)}`);if(version!==loadVersion || overlay.hidden)return;
      orders=data.orders;projects=getProjects(context);projectSelect.innerHTML=projects.map((r,i)=>`<option value="${i}">${escape(r.project)}</option>`).join('');
      if(!projects.length){setBusy(false);fields.disabled=true;el('saveClientOrder').disabled=true;showStatus('Cadastre um projeto neste cliente para preparar o pedido.',true);return;}
      const selected=orders.find(o=>o.id===orderId)?.snapshot.project || selectedProject || projectForRecord(context);
      const index=Math.max(0,projects.findIndex(r=>normalize(r.project)===normalize(selected)));projectSelect.value=String(index);setBusy(false);selectProject(index,orderId);
    }catch(error){if(version!==loadVersion || overlay.hidden)return;setBusy(false);fields.disabled=true;el('saveClientOrder').disabled=true;showStatus(error.message,true);el('orderReload').hidden=false;}
  }
  async function open(orderId){
    const record=window.currentClientHistoryRecord;if(!record || !overlay.hidden)return;
    current=null;snapshot=null;projects=[];orders=[];dirty=false;resetPostalLookup();form.reset();el('orderAutoFields').replaceChildren();el('orderEquipmentList').replaceChildren();el('orderAccessoryList').replaceChildren();el('orderDiscard').hidden=true;
    previousFocus=document.activeElement;inertNodes=[...document.body.children].filter(node=>node!==overlay && node.tagName!=='SCRIPT').map(node=>[node,node.inert]);for(const [node] of inertNodes)node.inert=true;
    overlay.hidden=false;setBusy(true);showStatus('Carregando dados do cliente…');el('orderTitle').textContent='Preparar pedido';el('orderSubtitle').textContent=record.client;overlay.querySelector('[role="dialog"]').focus();let ready=await window.BorealClients?.ready;if(ready===false)ready=await window.BorealClients.reload();if(ready===false){setBusy(false);fields.disabled=true;el('saveClientOrder').disabled=true;showStatus('Não foi possível carregar o cadastro do cliente. Feche o pedido e tente novamente.',true);return;}context={...window.currentClientHistoryRecord};await load(orderId);
  }
  function close(force=false){
    if(busy)return;if(dirty && !force){el('orderDiscard').hidden=false;el('orderKeepEditing').focus();return;}
    ++loadVersion;overlay.hidden=true;for(const [node,wasInert] of inertNodes)node.inert=wasInert;inertNodes=[];dirty=false;previousFocus?.focus();
  }
  function collect(){return {id:current.id,revision:current.revision,snapshot,movement:el('orderMovement').value,orderValue:parseOrderValue(el('orderValue').value),delivery:Object.fromEntries(deliveryNames.map(name=>[name,form.elements.namedItem(name).value.trim()])),items:[...overlay.querySelectorAll('.order-item')].map(row=>({kind:row.dataset.kind,brand:row.querySelector('[data-field="brand"]')?.value.trim() || '',category:row.querySelector('[data-field="category"]')?.value || '',description:row.querySelector('[data-field="description"]').value.trim(),quantity:Number(row.querySelector('[data-field="quantity"]').value)})),notes:el('orderNotes').value.trim()};}
  form.addEventListener('input',()=>{dirty=true;el('orderDiscard').hidden=true;});
  form.addEventListener('change',event=>{if(event.target!==projectSelect){dirty=true;el('orderDiscard').hidden=true;}});
  projectSelect.addEventListener('change',()=>{selectProject(Number(projectSelect.value));});
  // Lock the chosen project once delivery/items are edited, so switching cannot erase a draft.
  form.addEventListener('input',event=>{if(event.target!==projectSelect)projectSelect.disabled=true;});
  el('orderAddEquipment').onclick=()=>{const row=addItem('equipment');if(row){dirty=true;projectSelect.disabled=true;row.querySelector('[data-field="description"]').focus();}};
  el('orderAddAccessory').onclick=()=>{const row=addItem('accessory');if(row){dirty=true;projectSelect.disabled=true;row.querySelector('[data-field="description"]').focus();}};
  el('orderValue').addEventListener('input',event=>{const input=event.target;input.setCustomValidity('');const raw=input.value,position=input.selectionStart??raw.length,value=parseOrderValue(raw);if(value==null||!raw.trim())return;const tokens=raw.slice(0,position).replace(/[^0-9,]/g,'').length;input.value=money(value);let count=0,caret=input.value.indexOf(' ')+1;for(let i=0;i<input.value.length;i++){if(/[0-9,]/.test(input.value[i]))count++;if(count===tokens&&tokens>0){caret=i+1;break;}}input.setSelectionRange(caret,caret);});
  el('orderValue').addEventListener('blur',event=>{const value=parseOrderValue(event.target.value);if(value!=null)event.target.value=money(value);});
  form.addEventListener('submit',async event=>{
    event.preventDefault();if(busy || !current || !snapshot || !form.reportValidity())return;
    const payload=collect();if(payload.orderValue==null){el('orderValue').setCustomValidity('Informe um valor válido em reais, com até duas casas decimais.');el('orderValue').reportValidity();return;}setBusy(true);showStatus('Salvando pedido…');el('orderReload').hidden=true;
    try{
      const result=await api(`/api/client-orders?${query(context)}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
      current=result.order;dirty=false;setBusy(false);if(previousFocus?.closest('#detailTimeline'))previousFocus=el('generateOrderBtn');close(true);
      window.BorealGoals?.refresh();
      window.BorealOrderFlow?.refresh();
      window.BorealGeo?.refresh();
      window.BorealProjectStages?.apply(context.client,context.state,result.order.snapshot.project,'Aprovado',result.projectValue??result.order.orderValue);
      if(window.currentClientHistoryRecord && sameClient(context,window.currentClientHistoryRecord))window.BorealHistory.render(window.currentClientHistoryRecord);
      toast(`${result.order.number} salvo. Pedido enviado ao Estoque.`);
    }catch(error){setBusy(false);showStatus(error.message,true);el('orderReload').hidden=error.status!==409;}
  });
  el('reloadClientOrder').onclick=()=>load(current?.revision?current.id:null,snapshot?.project);
  el('closeClientOrder').onclick=()=>close();el('cancelClientOrder').onclick=()=>close();
  el('orderDiscardChanges').onclick=()=>close(true);el('orderKeepEditing').onclick=()=>{el('orderDiscard').hidden=true;el('saveClientOrder').focus();};
  document.addEventListener('keydown',event=>{
    if(overlay.hidden)return;
    if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();close();}
    if(event.key==='Tab'){
      const focusable=[...overlay.querySelectorAll('button,input,select,textarea,a[href]')].filter(node=>!node.matches(':disabled') && !node.closest('[hidden]'));
      if(!focusable.length){event.preventDefault();return;}const first=focusable[0],last=focusable.at(-1);
      if(event.shiftKey && (document.activeElement===first || document.activeElement===overlay.querySelector('[role="dialog"]'))){event.preventDefault();last.focus();}else if(!event.shiftKey && document.activeElement===last){event.preventDefault();first.focus();}
    }
  },true);
  el('generateOrderBtn').onclick=()=>open();
  el('detailTimeline').addEventListener('click',event=>{const button=event.target.closest('[data-open-order]');if(button)open(button.dataset.openOrder);});
  function events(list){const names={awaiting_setup:'Pendente no Estoque',awaiting_goods:'Aguardando mercadoria',maintenance:'Aguardando Manutenção',maintenance_in_progress:'Em Manutenção',dispatch_pending:'Disponível para Expedição',dispatch_preparing:'Em preparo',dispatched:'Enviado',completed:'Concluído'};return list.map(order=>({date:order.createdAt,html:`<article class="history-entry history-order"><span class="history-symbol" aria-hidden="true">▣</span><div class="history-card"><header><b>Pedido ${escape(order.number)}</b><time>${escape(date(order.createdAt))}</time></header><p><b>${escape(order.snapshot.project)}</b></p><p class="order-history-meta">Movimentação: <b>${escape(order.movement || 'Não informada')}</b> · Valor do pedido: <b>${order.orderValue!=null?escape(money(order.orderValue)):'Não informado'}</b></p><ul class="order-history-items">${order.items.map(item=>`<li>${item.quantity.toLocaleString('pt-BR')} × ${escape([item.brand,item.description].filter(Boolean).join(' '))}${item.kind==='accessory'?' <span>· acessório</span>':''}</li>`).join('')}</ul><p class="order-history-meta">Entrega: ${escape(order.delivery.city)} / ${escape(order.delivery.state)} · ${escape(order.snapshot.consultant)}<br>Software: ${escape(order.snapshot.software || 'Não cadastrado')}${order.workflow?.technicians?.length?`<br>Técnicos: ${escape(order.workflow.technicians.join(', '))}`:''}</p><div class="order-history-footer"><span class="order-pending-label">${escape(names[order.status]||'Pendente no Estoque')}</span><button type="button" data-open-order="${escape(order.id)}">Ver / editar pedido</button></div>${order.revision>1?`<small>Atualizado em ${escape(date(order.updatedAt))}</small>`:''}</div></article>`}));}
  window.BorealOrders={events};
})();
