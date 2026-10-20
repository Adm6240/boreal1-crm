(() => {
  'use strict';
  const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const quick=document.getElementById('detailQuickNote'),description=document.getElementById('activityDescription');
  const boldButtons=new Map([[quick,document.getElementById('detailBoldButton')],[description,document.getElementById('activityDescriptionBold')]]);
  const formatButtons=[...document.querySelectorAll('.activity-rich-tools [data-format]')];
  const inlineTags={B:'strong',STRONG:'strong',I:'em',EM:'em',U:'u'};
  const blockTags={DIV:'div',P:'p',OL:'ol',UL:'ul',LI:'li',BLOCKQUOTE:'blockquote'};
  function safeMarkup(node){
    if(node.nodeType===3)return escape(node.nodeValue);
    if(node.nodeType!==1 || /^(SCRIPT|STYLE|IFRAME|OBJECT|SVG|MATH|IMG)$/.test(node.tagName))return '';
    if(node.tagName==='BR')return '<br>';
    let content=[...node.childNodes].map(safeMarkup).join('');
    const tag=inlineTags[node.tagName]||blockTags[node.tagName];
    if(tag)content=`<${tag}>${content}</${tag}>`;
    if(node.tagName==='SPAN'){
      const style=node.getAttribute('style')||'';
      if(/(?:^|;)\s*font-weight\s*:\s*(?:bold|[6-9]00)/i.test(style))content=`<strong>${content}</strong>`;
      if(/(?:^|;)\s*font-style\s*:\s*italic/i.test(style))content=`<em>${content}</em>`;
      if(/(?:^|;)\s*text-decoration(?:-line)?\s*:[^;]*underline/i.test(style))content=`<u>${content}</u>`;
    }
    return content;
  }
  function read(editor=quick){
    const segments=[];
    function add(text,bold=false){if(!text)return;const last=segments.at(-1);if(last?.bold===bold)last.text+=text;else segments.push({text,bold});}
    function visit(node,bold=false){
      if(node.nodeType===3){add(node.nodeValue.replace(/\u00a0/g,' '),bold);return;}
      if(node.nodeType!==1 || /^(SCRIPT|STYLE|IFRAME|OBJECT|SVG|MATH|IMG)$/.test(node.tagName))return;
      if(node.tagName==='BR'){add('\n');return;}
      const nextBold=bold || node.tagName==='B' || node.tagName==='STRONG' || (node.tagName==='SPAN' && /(?:^|;)\s*font-weight\s*:\s*(?:bold|[6-9]00)/i.test(node.getAttribute('style')||''));
      const block=node!==editor && /^(DIV|P|LI|OL|UL|BLOCKQUOTE)$/.test(node.tagName);
      if(block && segments.length && !segments.at(-1).text.endsWith('\n'))add('\n');
      for(const child of node.childNodes)visit(child,nextBold);
      if(block && node.nextSibling && !segments.at(-1)?.text.endsWith('\n'))add('\n');
    }
    for(const child of editor.childNodes)visit(child);
    if(!segments.some(part=>part.text.trim()))return null;
    segments[0].text=segments[0].text.replace(/^\s+/,'');segments.at(-1).text=segments.at(-1).text.replace(/\s+$/,'');
    const clean=segments.filter(part=>part.text),result={text:clean.map(part=>part.text).join(''),segments:clean};
    if(editor===description)result.html=[...editor.childNodes].map(safeMarkup).join('');
    return result;
  }
  function render(note){
    if(typeof note.html==='string' && note.html.trim()){
      const source=document.createElement('div');source.innerHTML=note.html;
      return [...source.childNodes].map(safeMarkup).join('');
    }
    if(!Array.isArray(note.segments) || !note.segments.length)return escape(note.text);
    return note.segments.filter(part=>typeof part.text==='string').map(part=>part.bold?`<strong>${escape(part.text)}</strong>`:escape(part.text)).join('');
  }
  function updateButtons(editor){
    for(const button of editor===quick?[boldButtons.get(quick)]:formatButtons){
      if(!button.hasAttribute('aria-pressed'))continue;
      const command=button.dataset.format||'bold';
      button.setAttribute('aria-pressed',String(!!document.queryCommandState?.(command)));
    }
  }
  function format(editor,button,command){
    const selection=window.getSelection();
    const selected=selection?.rangeCount && editor.contains(selection.anchorNode)?selection.getRangeAt(0).cloneRange():null;
    if(!selected)return;
    editor.focus();selection.removeAllRanges();selection.addRange(selected);
    if(typeof document.execCommand==='function')document.execCommand(command,false,null);
    else if(['bold','italic','underline'].includes(command) && !selection.isCollapsed){
      const range=selection.getRangeAt(0),tag={bold:'strong',italic:'em',underline:'u'}[command],wrapper=document.createElement(tag);
      wrapper.appendChild(range.extractContents());range.insertNode(wrapper);selection.removeAllRanges();const end=document.createRange();end.selectNodeContents(wrapper);end.collapse(false);selection.addRange(end);
    }
    updateButtons(editor);
  }
  for(const [editor,button] of boldButtons){
    button.addEventListener('mousedown',event=>event.preventDefault());
    button.addEventListener('click',()=>format(editor,button,'bold'));
    editor.addEventListener('paste',event=>{
      event.preventDefault();const plain=event.clipboardData?.getData('text/plain')||'';
      if(typeof document.execCommand==='function')document.execCommand('insertText',false,plain);
      else{const selection=window.getSelection();if(!selection?.rangeCount)return;const range=selection.getRangeAt(0);range.deleteContents();const node=document.createTextNode(plain);range.insertNode(node);range.setStartAfter(node);range.collapse(true);selection.removeAllRanges();selection.addRange(range);}
    });
    editor.addEventListener('keyup',()=>updateButtons(editor));
  }
  for(const button of formatButtons){
    if(button===boldButtons.get(description))continue;
    button.addEventListener('mousedown',event=>event.preventDefault());
    button.addEventListener('click',()=>format(description,button,button.dataset.format));
  }
  function clear(editor=quick){editor.replaceChildren();editor.blur();boldButtons.get(editor)?.setAttribute('aria-pressed','false');}
  window.BorealNotes={read,render,clear};
})();
