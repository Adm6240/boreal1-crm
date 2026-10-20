import PostalMime from 'postal-mime';
import MsgReaderModule from '@kenjiuno/msgreader';

export const MAX_FILE = 10 * 1024 * 1024;
export class UserError extends Error { constructor(message, status=400) { super(message); this.status=status; } }
export function clientKey(name, state) { return `${state.trim().toUpperCase()}|${name.trim().normalize('NFC').toLocaleLowerCase('pt-BR')}`; }
const address = value => value?.address ? (value.name ? `${value.name} <${value.address}>` : value.address) : '';
const list = values => (values || []).map(address).filter(Boolean);
const sentDate = value => { const date=new Date(value || ''); return Number.isFinite(date.valueOf()) ? date.toISOString() : null; };
const cleanName = value => String(value || 'anexo').replace(/[\x00-\x1f\x7f/\\]/g,'_').slice(0,220);
export async function digest(bytes) { const hash=await crypto.subtle.digest('SHA-256',bytes); return [...new Uint8Array(hash)].map(x=>x.toString(16).padStart(2,'0')).join(''); }
export function guessType(name) { const extension=name.split('.').pop()?.toLowerCase(); return ({pdf:'application/pdf',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',gif:'image/gif',webp:'image/webp',txt:'text/plain',docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'})[extension] || 'application/octet-stream'; }

export async function parseEmail(raw, filename) {
  if (!raw.byteLength || raw.byteLength>MAX_FILE) throw new UserError('Selecione um e-mail de até 10 MB.',413);
  let email;
  if (/\.msg$/i.test(filename)) {
    const signature = [...new Uint8Array(raw).slice(0,8)].map(v=>v.toString(16).padStart(2,'0')).join('');
    if(signature !== 'd0cf11e0a1b11ae1') throw new UserError('Este arquivo não é uma mensagem MSG válida. Salve novamente pelo Outlook.');
    const MsgReader = MsgReaderModule.default || MsgReaderModule;
    const reader = new MsgReader(raw);
    const data = reader.getFileData();
    if(data.error) throw new UserError('Não foi possível ler este MSG. Salve a mensagem como EML no Outlook.');
    const recipients=(data.recipients || []).map(r=>({address:r.smtpAddress || r.email || '',name:r.name || '',kind:r.recipType}));
    const html = typeof data.bodyHtml==='string' ? data.bodyHtml : (data.html ? new TextDecoder().decode(data.html) : '');
    email={subject:data.subject || '(Sem assunto)',from:address({name:data.senderName,address:data.senderSmtpAddress || data.senderEmail || ''}),to:list(recipients.filter(r=>r.kind!=='cc' && r.kind!=='bcc')),cc:list(recipients.filter(r=>r.kind==='cc')),date:sentDate(data.clientSubmitTime || data.messageDeliveryTime || data.creationTime),text:data.body || '',html,messageId:data.messageId || '',attachments:(data.attachments || []).map((a,index)=>{
      const file=reader.getAttachment(index);
      return {name:cleanName(file.fileName || a.fileName || a.fileNameShort),type:a.attachMimeTag || guessType(file.fileName || a.fileName || ''),bytes:new Uint8Array(file.content),cid:a.pidContentId?.replace(/^<|>$/g,'') || null,inline:Boolean(a.pidContentId)};
    })};
  } else if (/\.eml$/i.test(filename)) {
    const prefix=new TextDecoder().decode(new Uint8Array(raw).slice(0,12000));
    if(!/^(from|to|subject|date|mime-version|received):/im.test(prefix)) throw new UserError('O arquivo não contém os cabeçalhos de uma mensagem de e-mail.');
    const parsed=await PostalMime.parse(raw);
    email={subject:parsed.subject || '(Sem assunto)',from:address(parsed.from),to:list(parsed.to),cc:list(parsed.cc),date:sentDate(parsed.date),text:parsed.text || '',html:parsed.html || '',messageId:parsed.messageId || '',attachments:(parsed.attachments || []).map(a=>({name:cleanName(a.filename),type:a.mimeType || guessType(a.filename || ''),bytes:new Uint8Array(a.content),cid:a.contentId?.replace(/^<|>$/g,'') || null,inline:a.disposition==='inline' || Boolean(a.contentId)}))};
  } else throw new UserError('Selecione uma mensagem do Outlook no formato .eml ou .msg.');
  if (!email.from || (!email.to.length && !email.cc.length)) throw new UserError('A mensagem precisa conter remetente e destinatário.');
  if(email.attachments.length>40) throw new UserError('O limite por mensagem é de 40 anexos.');
  if(email.text.length>450000 || email.html.length>450000) throw new UserError('O conteúdo desta mensagem ultrapassa o limite de armazenamento.');
  if(email.attachments.reduce((sum,a)=>sum+a.bytes.byteLength,0)>MAX_FILE) throw new UserError('Os anexos ultrapassam o limite de 10 MB.',413);
  email.dedupe=await digest(email.messageId ? new TextEncoder().encode(email.messageId.trim()) : raw);
  return email;
}

export async function limitedBody(request, max=MAX_FILE+1024*1024) {
  const limitMessage=`O arquivo ultrapassa o limite de ${max===MAX_FILE+1024*1024?10:max/(1024*1024)} MB.`;
  if(Number(request.headers.get('content-length'))>max) throw new UserError(limitMessage,413);
  const reader=request.body?.getReader(); if(!reader) throw new UserError('Nenhuma mensagem recebida.');
  const chunks=[];let length=0;
  while(true){const {done,value}=await reader.read();if(done)break;length+=value.byteLength;if(length>max){await reader.cancel();throw new UserError(limitMessage,413);}chunks.push(value);}
  const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}return bytes;
}
