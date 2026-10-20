import {build} from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
const root=process.cwd();
const files={};
const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.ico':'image/x-icon'};
fs.copyFileSync(path.join(root,'node_modules/dompurify/dist/purify.min.js'),path.join(root,'public/assets/purify.min.js'));
function walk(directory){for(const item of fs.readdirSync(directory,{withFileTypes:true})){const full=path.join(directory,item.name);if(item.isDirectory())walk(full);else{const relative='/'+path.relative(path.join(root,'public'),full).split(path.sep).join('/');files[relative]={type:types[path.extname(full)] || 'application/octet-stream',data:fs.readFileSync(full).toString('base64')};}}}
fs.copyFileSync(path.join(root,'node_modules/xlsx/dist/xlsx.full.min.js'),path.join(root,'public/assets/xlsx.min.js'));
walk(path.join(root,'public'));
// Version script and stylesheet URLs by content so refreshes cannot mix releases.
for(const [url,asset] of Object.entries(files)){
  if(!asset.type.startsWith('text/html'))continue;
  const html=Buffer.from(asset.data,'base64').toString('utf8').replace(/((?:src|href)=["'])(\/?assets\/[^"'?]+)(?:\?[^"']*)?(["'])/g,(match,prefix,resource,suffix)=>{
    const target=files['/'+resource.replace(/^\//,'')];
    if(!target||! /\.(?:js|css)$/.test(resource))return match;
    const version=createHash('sha256').update(Buffer.from(target.data,'base64')).digest('hex').slice(0,16);
    return `${prefix}${resource}?v=${version}${suffix}`;
  });
  asset.data=Buffer.from(html).toString('base64');
}
fs.writeFileSync('server/static-assets.generated.mjs','export default '+JSON.stringify(files)+';\n');
fs.rmSync('dist',{recursive:true,force:true});fs.mkdirSync('dist/server',{recursive:true});fs.mkdirSync('dist/.openai',{recursive:true});
await build({entryPoints:['server/index.mjs'],outfile:'dist/server/index.js',bundle:true,format:'esm',platform:'browser',target:'es2022',minify:true});
if(fs.existsSync('.openai/hosting.json'))fs.copyFileSync('.openai/hosting.json','dist/.openai/hosting.json');
console.log(`Built Worker with ${Object.keys(files).length} preserved static resources.`);
