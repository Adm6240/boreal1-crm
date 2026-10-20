(()=>{
 const normalize=value=>String(value??'').trim().normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,'');
 const aliases={municipality:'municipio',municipio:'municipio',cidade:'municipio',uf:'estado',state:'estado',estado:'estado',company:'companhia',companhia:'companhia',empresa:'companhia',nome_da_companhia:'companhia',nome_do_prestador:'companhia',prestador:'companhia',nome:'companhia',regiao:'regiao',sigla:'sigla',natureza_juridica:'natureza_juridica',natureza:'natureza_juridica',abrangencia:'abrangencia',codigo_ibge:'codigo_ibge',codigo_municipio:'codigo_ibge',segmento:'segmento',setor:'segmento',tipo:'segmento',tipo_de_servico:'segmento',servico:'segmento',categoria:'segmento',observacao:'observacao',observacoes:'observacao'};
 const states='AC AL AM AP BA CE DF ES GO MA MG MS MT PA PB PE PI PR RJ RN RO RR RS SC SE SP TO'.split(' ');
 const cityKey=value=>normalize(value).replace(/_/g,'');
 const cityAliases={MG:{baraodemontealto:'baraodomontealto',donaeusebia:'donaeuzebia',saothomedasletras:'saotomedasletras'},SE:{amparodesaofrancisco:'amparodosaofrancisco'},BA:{muquemdesaofrancisco:'muquemdosaofrancisco',santateresinha:'santaterezinha'},SP:{florinia:'florinea',saoluisdoparaitinga:'saoluizdoparaitinga'},MT:{santoantoniodoleverger:'santoantoniodeleverger'}};
 const positional=['regiao','municipio','estado','natureza_juridica','abrangencia','companhia','sigla'];
 function parse(matrix){
  const first=matrix.findIndex(row=>row.some(value=>String(value??'').trim()));
  if(first<0)return {rows:[],format:'empty'};
  const headers=matrix[first].map(value=>aliases[normalize(value)]||normalize(value));
  const hasHeaders=['estado','municipio','companhia'].every(key=>headers.includes(key));
  if(!hasHeaders&&(matrix[first].length!==7||!states.includes(String(matrix[first][2]).trim().toUpperCase())))throw new Error('Use cabeçalhos estado, municipio e companhia ou a base de sete colunas sem cabeçalho, com a UF na terceira coluna.');
  const keys=hasHeaders?headers:positional,rows=[];
  for(let i=first+(hasHeaders?1:0);i<matrix.length;i++){
   if(!matrix[i].some(value=>String(value??'').trim()))continue;
   const row={line:i+1};keys.forEach((key,column)=>{row[key]=matrix[i][column]??'';});
   if(!hasHeaders&&!row.segmento)row.segmento='Saneamento';rows.push(row);
  }
  return {rows,format:hasHeaders?'headers':'seven-columns'};
 }
 function canonicalRow(row,index){
  const state=String(row.estado||row.uf||row.state||'').trim().toUpperCase(),city=String(row.municipio||row.municipality||'').trim(),code=String(row.codigo_ibge||row.municipalityCode||'').replace(/\D/g,''),key=cityKey(city),nameMatch=index?.byName.get(cityAliases[state]?.[key]||key),codeMatch=code?index?.byCode.get(code):null,match=code?codeMatch:nameMatch;
  const issue=!states.includes(state)?'Informe uma UF válida do Brasil.':!city?'Informe o município.':!match?'Município não encontrado na malha oficial desta UF.':code&&nameMatch&&nameMatch.code!==code?'Código IBGE e nome do município não correspondem.':!String(row.companhia||row.company||'').trim()?'Informe a companhia.':'';
  return {record:{...row,estado:state,codigo_ibge:match?.code||code,municipio:match?.name||city},issue};
 }
 window.BorealCompanyParser={parse,normalize,states,cityKey,canonicalRow};
})();
