(() => {
  'use strict';
  const form=document.getElementById('clientPreRegistrationForm');if(!form)return;
  const el=id=>document.getElementById(id),value=name=>form.elements.namedItem(name).value.trim(),set=(name,next)=>{form.elements.namedItem(name).value=next||'';};
  const resetPostal=window.BorealPostalCode.attach(form,{name:'delivery.postalCode',status:el('clientPreRegistrationCepStatus')});
  let currentRecord=null,currentProfile=null,busy=false,renderToken=0;
  const incomplete=profile=>!profile || profile.registrationStatus==='incomplete' || !profile.cnpj || !profile.icmsStatus || !['yes','no'].includes(profile.hasBought);
  function profileFor(record){return window.BorealClients?.getById?.(record.clientProfileId)||window.BorealClients?.get?.(record.client,record.state)||null;}
  function status(text,error=false){const node=el('clientPreRegistrationStatus');node.textContent=text;node.classList.toggle('error',error);}
  function lock(state){busy=state;for(const control of form.elements)control.disabled=state;el('generateOrderBtn').disabled=state;form.setAttribute('aria-busy',String(state));}
  async function render(record){
    const token=++renderToken;currentRecord=record;await window.BorealClients?.ready;if(token!==renderToken||currentRecord!==record)return;
    currentProfile=profileFor(record);const profile=currentProfile;
    form.reset();resetPostal();status('');el('clientPreRegistrationName').textContent=record.client||'';
    set('borealCustomer',profile?.borealCustomer||profile?.hasBought);set('state',profile?.state||record.state);set('equipment',profile?.equipment);set('software',profile?.software||record.software);
    for(const part of ['postalCode','street','number','complement','district','city','state'])set('delivery.'+part,profile?.delivery?.[part]||(part==='state'?(profile?.state||record.state):''));
    set('commercial.name',profile?.commercial?.name||record.contact);set('commercial.email',profile?.commercial?.email||record.email);set('commercial.phone',profile?.commercial?.phone||record.phone);
    const badge=el('clientPreRegistrationBadge');badge.className='';
    if(!profile)badge.textContent='Não iniciado';
    else if(incomplete(profile)){badge.textContent='Cadastro a completar';badge.classList.add('incomplete');}
    else{badge.textContent='Cadastro completo';badge.classList.add('complete');}
    const complete=el('completeClientRegistration');complete.hidden=!profile;complete.textContent=incomplete(profile)?'Completar cadastro':'Editar cadastro completo';lock(false);
  }
  document.addEventListener('boreal:activity-detail',event=>render(event.detail));
  form.elements.namedItem('state').addEventListener('change',event=>{if(!value('delivery.state'))set('delivery.state',event.target.value);});
  form.addEventListener('submit',async event=>{
    event.preventDefault();if(busy||!currentRecord||!form.reportValidity())return;
    const record=currentRecord,oldState=record.state||'',profile=profileFor(record);lock(true);status('Salvando o pré-cadastro na base de Clientes…');
    const payload={clientProfileId:profile?.id||record.clientProfileId||null,revision:profile?.revision||0,client:record.client,state:value('state'),owner:record.owner||'',segment:record.segment==='Não informado'?'':record.segment||'',profile:{borealCustomer:value('borealCustomer'),equipment:value('equipment'),software:value('software'),delivery:{postalCode:value('delivery.postalCode'),street:value('delivery.street'),number:value('delivery.number'),complement:value('delivery.complement'),district:value('delivery.district'),city:value('delivery.city'),state:value('delivery.state')},commercial:{name:value('commercial.name'),email:value('commercial.email'),phone:value('commercial.phone')}}};
    try{
      const response=await fetch('/api/clients/pre-registration',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)}),data=await response.json();if(!response.ok)throw new Error(data.error||'Não foi possível salvar o pré-cadastro.');
      const saved=data.client;window.BorealClients.upsert(saved,record.client,oldState);currentProfile=saved;record.clientProfileId=saved.id;record.client=saved.legalName;record.state=saved.state;record.contact=saved.commercial?.name||record.contact;record.email=saved.commercial?.email||record.email;record.phone=saved.commercial?.phone||record.phone;record.software=saved.software||record.software;window.BorealAcceptImportedActivityState?.(record);persistActivities();renderActivities();await render(record);status('Pré-cadastro salvo. O cliente já está disponível na aba Clientes.');toast('Cliente incluído na base para conclusão do cadastro.');
    }catch(error){status(error.message,true);lock(false);}
  });
  el('completeClientRegistration').onclick=async()=>{
    if(busy||!currentProfile)return;const id=currentProfile.id;await window.BorealClients.reload();closeActivityDetail();window.switchView('clients');window.BorealClients.openById(id);
  };
})();
