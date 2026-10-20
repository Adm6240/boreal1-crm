import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {JSDOM} from 'jsdom';
test('Maintenance board groups OS, preserves pending flags, opens cards and switches to list',async()=>{
 const dom=new JSDOM('<div id="maintenanceAftersalesSection"></div><div id="dispatchAftersalesSection"></div>',{url:'https://boreal.test',runScripts:'dangerously'}),w=dom.window;
 const payload={client:'Cliente <teste>',model:'XM7-40',serial:'123',classification:'budget',diagnosis:'Teste',piecePending:'Bateria',enteredAt:'2026-10-01',events:[],warranty:{classification:'budget',repairs:[]},priority:{level:'urgent',reason:'Prazo',by:'Técnico',at:'2026-10-15'}};
 w.BorealAuth={user:{role:'maintenance'}};w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.fetch=async()=>({ok:true,json:async()=>({orders:[{id:1,number:'OS-000001',status:'waiting_piece',payload}]})});
 w.eval(fs.readFileSync('public/assets/maintenance.js','utf8'));w.document.dispatchEvent(new w.CustomEvent('boreal:view',{detail:'maintenance-aftersales'}));await new Promise(r=>setTimeout(r,10));
 const panel=w.document.querySelector('[data-area="maintenance"]');assert.equal(panel.querySelectorAll('.service-lane').length,7);assert.equal(panel.querySelector('[data-stage="waiting_piece"] .service-card').textContent.includes('Autorização pendente'),true);assert.equal(panel.querySelector('[data-stage="waiting_piece"] .service-card').textContent.includes('Bateria'),true);assert.equal(panel.querySelector('.service-card b').textContent,'Cliente <teste>');assert.equal(panel.querySelector('.service-table-wrap').hidden,true);
 panel.querySelector('.service-card').click();assert.equal(w.document.querySelector('#serviceTitle').textContent,'OS-000001');
 panel.querySelector('[data-service-view="list"]').click();assert.equal(panel.querySelector('.service-board').hidden,true);assert.equal(panel.querySelector('.service-table-wrap').hidden,false);assert.equal(w.localStorage.getItem('boreal-service-view'),'list');
 panel.querySelector('[data-service-search]').value='inexistente';panel.querySelector('[data-service-search]').dispatchEvent(new w.Event('input'));assert.equal(panel.querySelectorAll('.service-card').length,0);dom.window.close();
});
