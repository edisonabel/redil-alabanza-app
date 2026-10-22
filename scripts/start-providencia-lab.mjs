import { createRequire } from 'node:module';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { createServer } from 'node:http';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const require=createRequire(resolve(root,'package.json'));
const {build}=require('esbuild');
const {compile}=require('@tailwindcss/node');
const {Scanner}=require('@tailwindcss/oxide');
const fixturePath=process.env.LD_LAB_FIXTURE || resolve(root,'.lab/songs.json');
const fixture=JSON.parse(await readFile(fixturePath,'utf8'));
const media=new Map();
const songs=fixture.songs.map((song,songIndex)=>({...song,multitrack_session:{...song.multitrack_session,folder:undefined,manifestUrl:undefined,tracks:song.multitrack_session.tracks.map((track,index)=>{
  const local=`/lab-media/${songIndex}/${index}.m4a`;
  media.set(local,track.optimizedUrl || track.url);
  return {...track,url:local,iosUrl:undefined,nativeUrl:undefined,optimizedUrl:undefined,cafUrl:undefined,pcmUrl:undefined};
})}}));
const allowedSources=new Set(media.values());
const safeSource=(raw)=>{if(allowedSources.has(raw))return raw;try{const url=new URL(raw);if(url.protocol==='https:'&&url.hostname==='stems.alabanzaredilestadio.com'&&url.pathname.startsWith('/pads/')&&!url.pathname.includes('..'))return url.href;}catch{}return null;};
const stats={mediaRequests:0,mediaFailures:0,blockedWrites:0};
const headers={'Cross-Origin-Opener-Policy':'same-origin','Cross-Origin-Embedder-Policy':'require-corp','Cross-Origin-Resource-Policy':'same-origin'};
const sendJson=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
await mkdir(resolve(root,'.lab'),{recursive:true});
console.log('Compilando la pantalla de LiveDirector...');
const bundle=await build({entryPoints:[resolve(root,'lab/main.tsx')],bundle:true,write:false,metafile:true,format:'esm',platform:'browser',jsx:'automatic',define:{'process.env.NODE_ENV':'"production"','import.meta.env':'{}'},plugins:[{name:'lab-assets',setup(builder){
  builder.onLoad({filter:/\.css$/},()=>({contents:'',loader:'js'}));
  builder.onLoad({filter:/\/utils\/padAudio\.ts$/},async({path})=>({contents:(await readFile(path,'utf8')).replace('return `${PAD_BASE_URL}/${encodeURIComponent(fileName)}`;','return `/api/mp3-proxy?src=${encodeURIComponent(`${PAD_BASE_URL}/${encodeURIComponent(fileName)}`)}`;'),loader:'ts'}));
}}]});
const scanner=new Scanner({});
const content=await Promise.all(Object.keys(bundle.metafile.inputs).filter(path=>!path.startsWith('<')).map(async path=>({content:await readFile(resolve(path),'utf8'),extension:extname(path).slice(1)})));
const candidates=scanner.scanFiles(content);
const compiler=await compile(await readFile(resolve(root,'src/styles/global.css'),'utf8'),{base:resolve(root,'src/styles'),onDependency:()=>{}});
const css=compiler.build(candidates)+'\n'+await readFile(resolve(root,'src/components/react/live-director/LiveDirectorTools.css'),'utf8')+'\n'+await readFile(resolve(root,'lab/style.css'),'utf8');
await writeFile(resolve(root,'.lab/lab.js'),bundle.outputFiles[0].contents);
await writeFile(resolve(root,'.lab/lab.css'),css);
const index=(await readFile(resolve(root,'lab/index.html'),'utf8')).replace('src="/lab/main.tsx"','src="/lab.js"').replace('</head>','<link rel="stylesheet" href="/lab.css"></head>');
const server=createServer(async(req,res)=>{
    for(const [name,value]of Object.entries(headers))res.setHeader(name,value);
    const url=new URL(req.url,'http://127.0.0.1');
    if(!['GET','HEAD'].includes(req.method)){stats.blockedWrites++;sendJson(res,405,{error:'Los cambios de esta prueba se mantienen en la pantalla.'});return;}
    if(url.pathname==='/'){res.setHeader('Content-Type','text/html; charset=utf-8');res.end(index);return;}
    if(url.pathname==='/lab.js'){res.setHeader('Content-Type','text/javascript');res.end(bundle.outputFiles[0].contents);return;}
    if(url.pathname==='/lab.css'){res.setHeader('Content-Type','text/css');res.end(css);return;}
    if(url.pathname==='/api/lab/songs')return sendJson(res,200,{songs});
    if(url.pathname==='/api/lab/status')return sendJson(res,200,{branch:'codex/livedirector-providencia-lab',songs:songs.map(s=>({title:s.titulo,tracks:s.multitrack_session.tracks.length})),stats});
    if(url.pathname==='/api/live-director-upload-permission')return sendJson(res,200,{allowed:false});
    const source=media.get(url.pathname) || (url.pathname==='/api/mp3-proxy'?safeSource(url.searchParams.get('src')):null);
    if(source){
      stats.mediaRequests++;
      const abort=new AbortController();res.on('close',()=>{if(!res.writableFinished)abort.abort();});
      try{
        const upstream=await fetch(source,{method:req.method,headers:req.headers.range?{Range:req.headers.range}:{},signal:AbortSignal.any([abort.signal,AbortSignal.timeout(60000)])});
        for(const name of ['content-type','content-length','content-range','accept-ranges','etag'])if(upstream.headers.has(name))res.setHeader(name,upstream.headers.get(name));
        if(!upstream.ok)stats.mediaFailures++;
        res.writeHead(upstream.status);
        if(upstream.body){
          const stream=Readable.fromWeb(upstream.body);
          stream.on('error',()=>{if(!abort.signal.aborted)stats.mediaFailures++;if(!res.destroyed)res.destroy();});
          stream.pipe(res);
        }else res.end();
      }catch(error){if(abort.signal.aborted)return;stats.mediaFailures++;if(!res.headersSent)res.writeHead(502);res.end('No se pudo leer el audio. Reintenta la carga.');}
      return;
    }
    if(url.pathname.startsWith('/api/'))return sendJson(res,404,{error:'Ruta no disponible en el laboratorio.'});
    if(['/workers/','/vendor/','/fonts/','/audio/guide-es/'].some(prefix=>url.pathname.startsWith(prefix))){
      const path=resolve(root,'public','.'+decodeURIComponent(url.pathname));
      if(!path.startsWith(resolve(root,'public')+'/')){res.writeHead(404);res.end();return;}
      try{const body=await readFile(path);res.setHeader('Content-Type',path.endsWith('.js')?'text/javascript':path.endsWith('.woff2')?'font/woff2':path.endsWith('.wav')?'audio/wav':path.endsWith('.json')?'application/json':'application/octet-stream');res.end(body);}catch{res.writeHead(404);res.end();}return;
    }
    res.writeHead(404);res.end();
});
await new Promise(resolve=>server.listen(Number(process.env.PORT||4322),'127.0.0.1',resolve));
console.log(`http://127.0.0.1:${server.address().port}/`);
console.log('LiveDirector experimental listo. Copia de prueba; sin guardados en Alabanza.');
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{server.closeAllConnections();server.close(()=>process.exit(0));});
