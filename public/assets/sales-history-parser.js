(()=>{
const norm=v=>String(v??'').trim().normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
const months=['janeiro','fevereiro','marco','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];
function parse(matrix){
 const first=matrix.findIndex(row=>row.some(cell=>norm(cell)==='janeiro'));if(first<1)throw new Error('Use a planilha com os meses de janeiro a dezembro e os vendedores nas colunas.');
 const monthColumn=matrix[first].findIndex(cell=>norm(cell)==='janeiro');let header;
 for(let i=first-1;i>=0;i--)if(typeof matrix[i][monthColumn+1]==='string'&&norm(matrix[i][monthColumn+1])&&!['-','referencia:'].includes(norm(matrix[i][monthColumn+1]))){header=matrix[i];break;}
 if(!header)throw new Error('Não foi possível identificar os vendedores.');
 const sellers=[];for(let col=monthColumn+1;col<header.length;col++){const name=header[col];if(typeof name!=='string'||!name.trim()||norm(name).includes('meta')||norm(name).includes('total'))break;sellers.push({name:name.trim(),column:col});}
 if(!sellers.length)throw new Error('Não foram encontrados vendedores.');
 const records=[];for(const row of matrix){const month=months.indexOf(norm(row[monthColumn]))+1;if(!month)continue;for(const seller of sellers){const value=row[seller.column];if(value==null||String(value).trim()==='')continue;const amount=typeof value==='number'?value:Number(String(value).replace(/R\$\s*/g,'').replace(/\./g,'').replace(',','.').trim());if(!Number.isFinite(amount)||amount<0)throw new Error(`Confira ${seller.name}, mês ${month}.`);records.push({source:seller.name,month,amount:Math.round(amount*100)/100});}}
 const title=matrix.flat().find(value=>typeof value==='string'&&/20\d\d/.test(value));const year=Number(title?.match(/20\d\d/)?.[0])||new Date().getFullYear();
 return {year,sellers:sellers.map(s=>s.name),records};
}
window.BorealSalesHistoryParser={parse};
})();
