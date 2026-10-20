(() => {
  'use strict';
  function attach(form,{name='postalCode',status}){
    const postal=form.elements.namedItem(name);
    const field=part=>form.elements.namedItem(name==='postalCode'?part:`delivery.${part}`);
    let pending=null,resolved='';
    const digits=()=>postal.value.replace(/\D/g,'');
    async function lookup(){
      const cep=digits();
      if(cep.length!==8){pending?.abort();pending=null;resolved='';status.textContent=cep?'Informe os 8 dígitos do CEP.':'';return;}
      postal.value=`${cep.slice(0,5)}-${cep.slice(5)}`;
      if(cep===resolved || (pending && pending.cep===cep))return;
      pending?.abort();const controller=new AbortController();controller.cep=cep;pending=controller;
      const before=Object.fromEntries(['street','district','city','state'].map(part=>[part,field(part).value]));
      status.textContent='Consultando CEP…';
      try{
        const response=await fetch(`/api/cep/${cep}`,{credentials:'same-origin',signal:controller.signal});
        const address=await response.json();
        if(!response.ok)throw new Error(address.error||'Consulta de CEP indisponível. Preencha o endereço manualmente.');
        if(pending!==controller || digits()!==cep)return;
        for(const part of ['street','district','city','state']){
          if(address[part] && field(part).value===before[part])field(part).value=address[part];
        }
        resolved=cep;status.textContent='Endereço preenchido. Confira o número e o complemento.';
      }catch(error){
        if(error.name!=='AbortError' && pending===controller)status.textContent=error.message||'Consulta de CEP indisponível. Preencha o endereço manualmente.';
      }finally{if(pending===controller)pending=null;}
    }
    postal.addEventListener('input',()=>{if(digits().length===8)lookup();else{pending?.abort();pending=null;resolved='';status.textContent='';}});
    postal.addEventListener('blur',lookup);
    return ()=>{pending?.abort();pending=null;resolved='';status.textContent='';};
  }
  window.BorealPostalCode={attach};
})();
