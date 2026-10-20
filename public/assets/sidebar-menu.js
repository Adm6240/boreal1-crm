(() => {
 'use strict';
 const toggle=document.getElementById('sidebarToggle'),scrim=document.getElementById('sidebarScrim');
 let expanded=false;try{expanded=localStorage.getItem('boreal-sidebar-expanded')==='true';}catch{}
 function apply(){document.body.dataset.menuExpanded=String(expanded);toggle.setAttribute('aria-expanded',String(expanded));toggle.title=expanded?'Recolher menu':'Expandir menu';toggle.querySelector('b').textContent=expanded?'«':'»';toggle.querySelector('span').textContent=expanded?'Recolher':'Expandir';scrim.hidden=!expanded;try{localStorage.setItem('boreal-sidebar-expanded',String(expanded));}catch{}}
 toggle.onclick=()=>{expanded=!expanded;apply();};scrim.onclick=()=>{expanded=false;apply();toggle.focus();};
 document.addEventListener('keydown',event=>{if(event.key==='Escape'&&expanded&&document.activeElement?.closest('.sidebar')){expanded=false;apply();toggle.focus();}});
 document.addEventListener('boreal:view',event=>{document.querySelectorAll('[data-operation-jump]').forEach(button=>{const active=button.dataset.operationJump===event.detail;button.classList.toggle('active',active);if(active)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current');});if(expanded&&window.matchMedia?.('(max-width:760px)').matches){expanded=false;apply();}});
 document.addEventListener('click',event=>{const button=event.target.closest('.sidebar .nav[data-view]');if(!button||!['maintenance','dispatch'].includes(button.dataset.view))return;const group=document.getElementById(button.dataset.view+'Subsections');if(!group||group.hidden)return;const open=group.dataset.subsectionsOpen!=='true';group.dataset.subsectionsOpen=String(open);button.setAttribute('aria-expanded',String(open));if(!expanded){expanded=true;apply();}});
 apply();
})();
