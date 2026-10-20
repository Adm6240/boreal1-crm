(() => {
  'use strict';
  const states='AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO'.split(' ');
  const escape=value=>String(value ?? '').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const key=(name,state)=>`${String(state||'').toUpperCase()}|${String(name||'').trim().normalize('NFC').toLocaleLowerCase('pt-BR').replace(/\s+/g,' ')}`;
  const nameKey=name=>String(name||'').trim().normalize('NFC').toLocaleLowerCase('pt-BR').replace(/\s+/g,' ');
  const el=id=>document.getElementById(id);
  const contactNames=['commercial.name','commercial.email','commercial.phone','financial.name','financial.email','financial.phone'];
  const deliveryNames=['recipient','postalCode','street','number','complement','district','city','state'];
  const classifications=['Concessionária','Indústria','Varejo','Empreiteiro'];
  const field=(name,label,type='text',opts='')=>`<label class="client-field">${label}<input name="${name}" type="${type}" ${opts}></label>`;
  const stateSelect=(name,label)=>`<label class="client-field">${label}<select name="${name}" ${name==='state'?'required':''}><option value="">Selecione</option>${states.map(uf=>`<option>${uf}</option>`).join('')}</select></label>`;
  const modal=document.createElement('div');modal.id='clientProfileModal';modal.className='client-profile-overlay';modal.hidden=true;
  modal.innerHTML=`<section class="client-profile-dialog" role="dialog" aria-modal="true" aria-labelledby="profileTitle" tabindex="-1">
    <header class="profile-head"><div><p class="eyebrow">CADASTRO DE CLIENTE</p><h2 id="profileTitle">Novo cliente</h2></div><button type="button" id="closeProfile" aria-label="Fechar cadastro">×</button></header>
    <form id="clientProfileForm"><div class="profile-scroll">
      <p id="profileStatus" class="profile-status" role="status" aria-live="polite"></p>
      <fieldset id="profileFields">
        <section class="profile-section"><h3>Dados fiscais e da empresa</h3><div class="profile-grid">
          ${field('legalName','Razão social','text','required maxlength="180" autocomplete="organization"')}
          ${field('tradeName','Nome fantasia','text','maxlength="180"')}
          ${field('segment','Segmento','text','maxlength="100" list="clientSegments"')}
          <datalist id="clientSegments"><option value="Concessionária"><option value="Indústria"><option value="Varejo"><option value="Empreiteiro"></datalist>
          ${stateSelect('state','UF da empresa')}
          <label class="client-field">Situação perante o ICMS<select name="icmsStatus" required><option value="">Selecione</option><option value="taxpayer">Contribuinte</option><option value="exempt">Isento de ICMS</option></select></label>
          ${field('cnpj','CNPJ','text','required inputmode="numeric" maxlength="18" placeholder="00.000.000/0000-00"')}
          ${field('stateRegistration','Inscrição estadual','text','maxlength="40"')}
          ${field('municipalRegistration','Inscrição municipal','text','maxlength="40"')}
        </div></section>
        <section class="profile-section"><h3>Endereço de entrega</h3><div class="profile-grid">
          ${field('delivery.recipient','Destinatário','text','maxlength="180"')}
          ${field('delivery.postalCode','CEP','text','inputmode="numeric" maxlength="9" placeholder="00000-000" pattern="[0-9]{5}-?[0-9]{3}"')}
          <p id="profileCepStatus" class="cep-status" role="status" aria-live="polite"></p>
          ${field('delivery.street','Logradouro','text','maxlength="200"')}
          ${field('delivery.number','Número','text','maxlength="30"')}
          ${field('delivery.complement','Complemento','text','maxlength="160"')}
          ${field('delivery.district','Bairro','text','maxlength="120"')}
          ${field('delivery.city','Município','text','maxlength="120"')}
          ${stateSelect('delivery.state','UF de entrega')}
        </div></section>
        <section class="profile-section"><h3>Contatos</h3><div class="profile-contact-grid">
          <div><h4>Comercial</h4>${field('commercial.name','Nome','text','maxlength="180"')}${field('commercial.email','E-mail','email','maxlength="254"')}${field('commercial.phone','Telefone','tel','maxlength="60"')}</div>
          <div><h4>Financeiro</h4>${field('financial.name','Nome','text','maxlength="180"')}${field('financial.email','E-mail','email','maxlength="254"')}${field('financial.phone','Telefone','tel','maxlength="60"')}</div>
        </div></section>
        <section class="profile-section"><h3>Equipamento e software atuais</h3><div class="profile-grid">
          <label class="client-field">Equipamentos em uso<textarea name="equipment" maxlength="1500" rows="3" placeholder="Marcas, modelos e quantidades atualmente em uso"></textarea></label>
          ${field('software','Software em uso','text','maxlength="200" placeholder="Nome do software utilizado"')}
        </div></section>
        <section class="profile-section"><h3>Histórico de compra</h3><div class="profile-grid">
          <label class="client-field">Já comprou da Boreal?<select name="hasBought" required><option value="">Selecione</option><option value="yes">Sim</option><option value="no">Não</option></select></label>
          <div id="lastSaleFields" class="profile-sale-fields" hidden>${field('lastSaleDate','Data da última venda','date')}${field('lastSaleDescription','O que foi vendido','text','maxlength="400" placeholder="Equipamento, quantidade ou pedido"')}</div>
        </div></section>
      </fieldset>
    </div><div id="profileDiscard" class="profile-discard" hidden role="alert"><span>Há alterações não salvas no cadastro.</span><button type="button" id="keepProfile">Continuar editando</button><button type="button" id="discardProfile">Descartar e fechar</button></div>
    <footer class="profile-footer"><button type="button" class="secondary" id="cancelProfile">Cancelar</button><button type="submit" class="primary" id="saveProfile">Salvar cadastro</button></footer></form>
  </section>`;
  document.body.appendChild(modal);
  const deleteModal=document.createElement('div');deleteModal.id='clientDeleteModal';deleteModal.className='client-delete-overlay';deleteModal.hidden=true;
  deleteModal.innerHTML=`<section class="client-delete-dialog" role="alertdialog" aria-modal="true" aria-labelledby="deleteClientTitle" aria-describedby="deleteClientDescription" tabindex="-1">
    <div class="client-delete-icon" aria-hidden="true">!</div><h2 id="deleteClientTitle">Excluir cliente?</h2>
    <p id="deleteClientDescription">Esta ação é permanente.</p><p class="client-delete-warning">O cadastro e seus dados vinculados serão removidos definitivamente.</p>
    <div class="client-delete-actions"><button type="button" class="secondary" id="cancelDeleteClient">Cancelar</button><button type="button" class="client-danger" id="confirmDeleteClient">Excluir definitivamente</button></div>
    <p id="deleteClientStatus" class="profile-status" role="status" aria-live="polite"></p>
  </section>`;
  document.body.appendChild(deleteModal);
  const form=el('clientProfileForm'),status=el('profileStatus'),fields=el('profileFields'),listStatus=el('clientListStatus');
  const resetPostalLookup=window.BorealPostalCode.attach(form,{name:'delivery.postalCode',status:el('profileCepStatus')});
  let profiles=[],current=null,initial=null,dirty=false,busy=false,previousFocus=null,inertNodes=[],loadVersion=0;
  async function api(path,options={}){const response=await fetch(path,{credentials:'same-origin',...options});let data;try{data=await response.json();}catch{throw new Error('Não foi possível acessar os cadastros. Entre novamente no Boreal.');}if(!response.ok){const error=new Error(data.error||'Não foi possível salvar o cliente.');error.status=response.status;throw error;}return data;}
  const value=name=>form.elements.namedItem(name).value.trim();
  const set=(name,val)=>{form.elements.namedItem(name).value=val ?? '';};
  const demo=c=>({legalName:c[0],tradeName:'',segment:c[1],state:c[3],icmsStatus:'',cnpj:'',stateRegistration:'',municipalRegistration:'',delivery:{recipient:c[0],postalCode:'',street:'',number:'',complement:'',district:'',city:'',state:c[3]},commercial:{name:c[2],email:'',phone:''},financial:{name:'',email:'',phone:''},equipment:'',software:'',hasBought:'',lastSaleDate:'',lastSaleDescription:''});
  function identityIndex(){
    const group=(rows,name,state)=>{const map=new Map();for(const row of rows){const k=key(name(row),state(row));if(!map.has(k))map.set(k,[]);map.get(k).push(row);}return map;};
    return {clients:group(clients,c=>c[0],c=>c[3]),activities:group(activityRecords,a=>a.client,a=>a.state),deals:group(deals,d=>d.client,d=>d.state)};
  }
  function syncIdentity(oldName,oldState,profile,deferRender=false,index=null){
    let changed=false;const oldKey=key(oldName,oldState),newKey=key(profile.legalName,profile.state);
    for(const c of (index?index.clients.get(oldKey)||[]:clients))if(key(c[0],c[3])===key(oldName,oldState)){c[0]=profile.legalName;c[3]=profile.state;c[1]=profile.segment||'';c[2]=profile.commercial.name||c[2];changed=true;}
    if(index&&oldKey!==newKey&&index.clients.has(oldKey)){const moved=index.clients.get(oldKey);index.clients.delete(oldKey);index.clients.set(newKey,[...(index.clients.get(newKey)||[]),...moved]);}
    if(index?!index.clients.has(newKey):!clients.some(c=>key(c[0],c[3])===newKey)){
      const row=[profile.legalName,profile.segment,profile.commercial.name,profile.state,'—','Contato'];clients.push(row);index?.clients.set(newKey,[row]);
    }
    for(const a of (index?index.activities.get(oldKey)||[]:activityRecords))if(key(a.client,a.state)===key(oldName,oldState)){a.clientProfileId=profile.id;a.client=profile.legalName;a.state=profile.state;a.segment=profile.segment||'Não informado';a.contact=profile.commercial.name||a.contact;a.phone=profile.commercial.phone||a.phone;a.email=profile.commercial.email||a.email;window.BorealAcceptImportedActivityState?.(a);changed=true;}
    for(const d of (index?index.deals.get(oldKey)||[]:deals))if(key(d.client,d.state)===key(oldName,oldState)){d.client=profile.legalName;d.state=profile.state;d.segment=profile.segment||'Não informado';d.contact=profile.commercial.name||d.contact;d.phone=profile.commercial.phone||d.phone;}
    if(!deferRender){
      if(changed){persistActivities();renderActivities();}
      window.BorealSyncPipeline?.(activityRecords);
      renderKanban();renderDashboard();
    }
    return changed;
  }
  function createInitialActivity(profile){
    if(activityRecords.some(record=>key(record.client,record.state)===key(profile.legalName,profile.state)))return false;
    const user=window.BorealAuth?.user,owner=String(user?.consultantName||user?.name||'').trim();
    activityRecords.push({id:Date.now()+Math.floor(Math.random()*1000),clientProfileId:profile.id,subject:'Realizar primeiro contato',client:profile.legalName,project:'Primeiro contato',projectExplicit:true,value:0,stage:'Contato',segment:profile.segment||'Não informado',state:profile.state,software:profile.software||null,type:'Tarefa',priority:'Normal',contact:profile.commercial?.name||'',email:profile.commercial?.email||'',phone:profile.commercial?.phone||'',organization:profile.segment||'',owner,date:isoWithOffset(0),time:'09:00',endTime:'09:30',description:'Cliente cadastrado no CRM. Registrar o primeiro contato e definir o próximo passo.',completed:false,notes:[]});
    persistActivities();renderActivities();return true;
  }
  function visibleRows(){
    const covered=new Set(profiles.flatMap(p=>[key(p.legalName,p.state),...(p.origin?[key(p.origin.name,p.origin.state)]:[])]));
    const profileNames=new Map();for(const profile of profiles){const normalized=nameKey(profile.legalName);profileNames.set(normalized,(profileNames.get(normalized)||0)+1);}
    const saved=profiles.map(p=>({profile:p}));
    const pending=clients.map((c,i)=>({legacy:c,index:i})).filter(({legacy:c})=>!covered.has(key(c[0],c[3])) && !(!String(c[3]||'').trim()&&profileNames.get(nameKey(c[0]))===1));
    return [...saved,...pending];
  }
  function render(filter=''){
    const needle=String(filter||'').normalize('NFC').toLocaleLowerCase('pt-BR').trim();
    const all=visibleRows(),rows=all.filter(item=>{const p=item.profile||demo(item.legacy);return [p.legalName,p.tradeName,p.cnpj,p.software,p.commercial.name,p.equipment].join(' ').toLocaleLowerCase('pt-BR').includes(needle)});
    el('clientCount').textContent=`${all.length} ${all.length===1?'cliente':'clientes'}`;
    el('clientRows').innerHTML=rows.length?rows.map(item=>{const p=item.profile||demo(item.legacy),cnpj=p.cnpj?`${p.cnpj.slice(0,2)}.${p.cnpj.slice(2,5)}.${p.cnpj.slice(5,8)}/${p.cnpj.slice(8,12)}-${p.cnpj.slice(12)}`:'A completar',sale=p.hasBought==='no'?'Sem compras':p.lastSaleDate?new Date(`${p.lastSaleDate}T12:00:00`).toLocaleDateString('pt-BR'):'—',ident=item.profile?`data-edit-profile="${item.profile.id}"`:`data-edit-legacy="${item.index}"`;
      const remove=item.profile&&window.BorealAuth?.user?.role==='admin'?`<button type="button" class="client-delete" data-delete-profile="${item.profile.id}" aria-label="Excluir cliente ${escape(p.legalName)}">Excluir</button>`:'';
      const classification=item.profile?`<select class="client-classification" data-classify-profile="${item.profile.id}" aria-label="Classificação de ${escape(p.legalName)}"><option value="">Classificar</option>${classifications.map(value=>`<option value="${value}" ${p.segment===value?'selected':''}>${value}</option>`).join('')}</select>`:`<span class="client-classification-readonly">${escape(p.segment||'Não classificado')}</span>`;
      return `<tr ${ident} tabindex="0" role="button" aria-label="Editar cadastro de ${escape(p.legalName)}"><td><b>${escape(p.legalName)}</b>${!item.profile||p.registrationStatus==='incomplete'||p.imported&&(!p.cnpj||!p.state)?'<small>Cadastro a completar</small>':p.tradeName?`<small>${escape(p.tradeName)}</small>`:''}</td><td>${escape(cnpj)}</td><td>${escape(p.state)}</td><td>${escape(p.commercial.name||'—')}</td><td>${escape(p.equipment||'—')}</td><td>${classification}</td><td>${escape(sale)}</td><td><div class="client-row-actions"><button type="button" class="secondary" aria-label="Editar cadastro de ${escape(p.legalName)}">Editar</button>${remove}</div></td></tr>`;}).join(''):'<tr><td colspan="8" class="client-empty">Nenhum cliente encontrado.</td></tr>';
    el('clientRows').querySelectorAll('[data-edit-profile],[data-edit-legacy]').forEach(row=>{const open=()=>row.dataset.editProfile?openProfile(profiles.find(p=>p.id===row.dataset.editProfile)):openLegacy(clients[Number(row.dataset.editLegacy)]);row.onclick=open;row.onkeydown=event=>{if(event.target.closest('.client-classification'))return;if(event.key==='Enter'||event.key===' '){event.preventDefault();open();}};});
    el('clientRows').querySelectorAll('[data-classify-profile]').forEach(select=>{select.onclick=event=>event.stopPropagation();select.onkeydown=event=>event.stopPropagation();select.onchange=()=>quickClassify(select);});
    el('clientRows').querySelectorAll('[data-delete-profile]').forEach(button=>button.onclick=event=>{event.stopPropagation();openDelete(profiles.find(p=>p.id===button.dataset.deleteProfile));});
  }
  async function quickClassify(select){
    const profile=profiles.find(p=>p.id===select.dataset.classifyProfile);if(!profile)return;const previous=profile.segment||'',classification=select.value;select.disabled=true;select.classList.add('saving');
    try{const data=await api(`/api/clients/${profile.id}/classification`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({revision:profile.revision,classification})});const updated=data.client,index=profiles.findIndex(item=>item.id===updated.id);if(index>=0)profiles[index]=updated;syncIdentity(profile.legalName,profile.state,updated);render(el('clientSearch').value);document.dispatchEvent(new CustomEvent('boreal:clients-updated'));toast(`${updated.legalName}: ${classification||'sem classificação'}.`);}catch(error){select.value=previous;select.disabled=false;select.classList.remove('saving');toast(error.message);}
  }
  async function load(){const version=++loadVersion;listStatus.hidden=false;listStatus.textContent='Carregando cadastros…';try{const data=await api('/api/clients');if(version!==loadVersion)return false;profiles=data.clients;let activitiesChanged=false;const indexLookup=identityIndex();
    for(let index=0;index<profiles.length;index++){
      const p=profiles[index];activitiesChanged=syncIdentity(p.origin?.name||p.legalName,p.origin?.state||p.state,p,true,indexLookup)||activitiesChanged;
      if(index%100===99){await new Promise(resolve=>setTimeout(resolve,0));if(version!==loadVersion)return false;}
    }
    if(activitiesChanged){persistActivities();renderActivities();}
    if(!globalThis.document?.getElementById('kanban'))return false;window.BorealSyncPipeline?.(activityRecords);renderKanban();renderDashboard();window.BorealLinkActivityClients?.();render(el('clientSearch').value);listStatus.hidden=true;return true;}catch(error){if(version!==loadVersion||!globalThis.document?.getElementById('clientListStatus'))return false;listStatus.hidden=false;listStatus.textContent=`${error.message} `;const retry=document.createElement('button');retry.type='button';retry.textContent='Tentar novamente';retry.onclick=load;listStatus.appendChild(retry);return false;}}
  function show(message,error=false){status.textContent=message;status.classList.toggle('error',error);}
  function setBusy(state){busy=state;fields.disabled=state;el('saveProfile').disabled=state;el('closeProfile').disabled=state;el('cancelProfile').disabled=state;form.setAttribute('aria-busy',String(state));}
  function refreshConditional(){const bought=value('hasBought')==='yes';el('lastSaleFields').hidden=!bought;for(const name of ['lastSaleDate','lastSaleDescription'])form.elements.namedItem(name).required=bought;}
  function populate(p){
    for(const name of ['legalName','tradeName','segment','state','icmsStatus','cnpj','stateRegistration','municipalRegistration','equipment','software','hasBought','lastSaleDate','lastSaleDescription'])set(name,p[name]);
    for(const name of contactNames){const [group,part]=name.split('.');set(name,p[group]?.[part]);}
    for(const name of deliveryNames)set('delivery.'+name,p.delivery?.[name]);refreshConditional();
  }
  function openBase(profile,origin){
    if(!modal.hidden)return;if(el('importedClientContacts'))el('importedClientContacts').innerHTML='';current=profile||null;initial=origin||null;dirty=false;previousFocus=document.activeElement;
    inertNodes=[...document.body.children].filter(node=>node!==modal && node.tagName!=='SCRIPT').map(node=>[node,node.inert]);for(const [node] of inertNodes)node.inert=true;
    modal.hidden=false;el('profileTitle').textContent=profile?.id?'Atualizar cliente':profile?'Completar cadastro':'Novo cliente';el('profileDiscard').hidden=true;show('');resetPostalLookup();form.reset();populate(profile||demo(['','','','','','']));setBusy(false);modal.querySelector('[role="dialog"]').focus();setTimeout(()=>form.elements.namedItem('legalName').focus(),0);
  }
  function openLegacy(c){if(c)openBase(demo(c),{name:c[0],state:c[3]});}
  function openProfile(p){if(p){openBase(p,p.origin);let list=el('importedClientContacts');if(!list){list=document.createElement('div');list.id='importedClientContacts';form.appendChild(list);}list.innerHTML=(p.importContacts||[]).length?'<h3>Contatos importados</h3>'+p.importContacts.map(c=>`<p>${escape(c.name)} · ${escape(c.role)} · ${escape(c.email)} · ${escape(c.phone)}</p>`).join(''):'';}}
  let deleting=null,deleteFocus=null;
  function openDelete(profile){if(!profile||window.BorealAuth?.user?.role!=='admin')return;deleting=profile;deleteFocus=document.activeElement;el('deleteClientDescription').innerHTML=`Você está prestes a excluir <strong>${escape(profile.legalName)}</strong>.`;el('deleteClientStatus').textContent='';el('deleteClientStatus').classList.remove('error');deleteModal.hidden=false;deleteModal.querySelector('[role="alertdialog"]').focus();el('cancelDeleteClient').focus();}
  function closeDelete(){if(el('confirmDeleteClient').disabled)return;deleteModal.hidden=true;deleting=null;deleteFocus?.focus();}
  function removeLocalReferences(profile){
    const matches=(name,state,id)=>id===profile.id||key(name,state)===key(profile.legalName,profile.state)||profile.origin&&key(name,state)===key(profile.origin.name,profile.origin.state);
    for(let i=clients.length-1;i>=0;i--)if(matches(clients[i][0],clients[i][3]))clients.splice(i,1);
    for(let i=activityRecords.length-1;i>=0;i--)if(matches(activityRecords[i].client,activityRecords[i].state,activityRecords[i].clientProfileId))activityRecords.splice(i,1);
    for(let i=deals.length-1;i>=0;i--)if(matches(deals[i].client,deals[i].state))deals.splice(i,1);
    persistActivities();renderActivities();renderKanban();renderDashboard();
  }
  el('cancelDeleteClient').onclick=closeDelete;
  deleteModal.onclick=event=>{if(event.target===deleteModal)closeDelete();};
  el('confirmDeleteClient').onclick=async()=>{if(!deleting)return;const profile=deleting,button=el('confirmDeleteClient');button.disabled=true;el('cancelDeleteClient').disabled=true;el('deleteClientStatus').textContent='Excluindo cliente…';try{await api(`/api/clients/${profile.id}`,{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({revision:profile.revision})});profiles=profiles.filter(item=>item.id!==profile.id);removeLocalReferences(profile);deleteModal.hidden=true;deleting=null;render(el('clientSearch').value);document.dispatchEvent(new CustomEvent('boreal:clients-updated'));toast(`Cliente ${profile.legalName} excluído.`);}catch(error){el('deleteClientStatus').textContent=error.message;el('deleteClientStatus').classList.add('error');}finally{button.disabled=false;el('cancelDeleteClient').disabled=false;}};
  function close(force=false){if(busy)return;if(dirty && !force){el('profileDiscard').hidden=false;el('keepProfile').focus();return;}modal.hidden=true;for(const [node,was] of inertNodes)node.inert=was;inertNodes=[];dirty=false;previousFocus?.focus();}
  function collect(){const p={};for(const name of ['legalName','tradeName','segment','state','icmsStatus','cnpj','stateRegistration','municipalRegistration','equipment','software','hasBought','lastSaleDate','lastSaleDescription'])p[name]=value(name);p.commercial={};p.financial={};p.delivery={};for(const name of contactNames){const [group,part]=name.split('.');p[group][part]=value(name);}for(const name of deliveryNames)p.delivery[name]=value('delivery.'+name);return p;}
  function existingProfileFor(profile,legacy){
    const cnpj=String(profile.cnpj||'').replace(/\D/g,'');if(cnpj){const byCnpj=profiles.find(item=>String(item.cnpj||'').replace(/\D/g,'')===cnpj);if(byCnpj)return byCnpj;}
    const sameName=profiles.filter(item=>nameKey(item.legalName)===nameKey(profile.legalName));
    const exact=sameName.find(item=>String(item.state||'').toUpperCase()===String(profile.state||'').toUpperCase());if(exact)return exact;
    return legacy && !String(legacy.state||'').trim() && sameName.length===1?sameName[0]:null;
  }
  form.addEventListener('input',()=>{dirty=true;el('profileDiscard').hidden=true;});
  form.addEventListener('change',event=>{dirty=true;el('profileDiscard').hidden=true;if(event.target.name==='hasBought')refreshConditional();if(event.target.name==='state' && !value('delivery.state'))set('delivery.state',value('state'));});
  form.addEventListener('submit',async event=>{
    event.preventDefault();if(busy || !form.reportValidity())return;
    const savedBefore=current,submitted=collect();setBusy(true);show('Salvando cadastro…');
    try{
      const existing=current?.id?current:existingProfileFor(submitted,current),updating=Boolean(existing?.id),requestOrigin=!updating&&initial?{...initial,state:initial.state||submitted.state}:null;
      const data=await api(updating?`/api/clients/${existing.id}`:'/api/clients',{method:updating?'PUT':'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({revision:existing?.revision||0,origin:requestOrigin,profile:submitted})});
      const p=data.client,oldName=savedBefore?.legalName||existing?.legalName||p.legalName,oldState=savedBefore?.state||existing?.state||p.state,isNew=!updating;
      const index=profiles.findIndex(other=>other.id===p.id);if(index>=0)profiles[index]=p;else profiles.unshift(p);
      syncIdentity(oldName,oldState,p);const activityCreated=isNew&&createInitialActivity(p);render(el('clientSearch').value);dirty=false;setBusy(false);close(true);document.dispatchEvent(new CustomEvent('boreal:clients-updated'));toast(activityCreated?'Cadastro salvo e atividade inicial criada.':'Cadastro do cliente salvo.');
    }catch(error){setBusy(false);show(error.message,true);}
  });
  el('newClientBtn').onclick=()=>openBase(null,null);el('closeProfile').onclick=()=>close();el('cancelProfile').onclick=()=>close();el('discardProfile').onclick=()=>close(true);el('keepProfile').onclick=()=>{el('profileDiscard').hidden=true;el('saveProfile').focus();};
  document.addEventListener('keydown',event=>{if(modal.hidden)return;if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();close();}if(event.key==='Tab'){const focusable=[...modal.querySelectorAll('button,input,select,textarea')].filter(node=>!node.matches(':disabled') && !node.closest('[hidden]'));if(!focusable.length){event.preventDefault();return;}const first=focusable[0],last=focusable.at(-1);if(event.shiftKey && (document.activeElement===first || document.activeElement===modal.querySelector('[role="dialog"]'))){event.preventDefault();last.focus();}else if(!event.shiftKey && document.activeElement===last){event.preventDefault();first.focus();}}},true);
  function upsert(profile,oldName=profile.legalName,oldState=profile.state){const index=profiles.findIndex(item=>item.id===profile.id);if(index>=0)profiles[index]=profile;else profiles.unshift(profile);syncIdentity(oldName,oldState,profile);render(el('clientSearch').value);document.dispatchEvent(new CustomEvent('boreal:clients-updated'));return profile;}
  window.BorealClients={clear:()=>{profiles=[];render('');},render,get:(name,state)=>profiles.find(p=>key(p.legalName,p.state)===key(name,state))||null,getById:id=>profiles.find(p=>p.id===id)||null,openById:id=>openProfile(profiles.find(p=>p.id===id)),all:()=>[...profiles],upsert,reload:load,ready:load()};
})();
