import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {gzipSync} from 'node:zlib';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {validateSelection} from './overview-attribution.mjs';

// Only this fixed aggregate worker is executed. Credentials and order rows remain on the source server.
async function bundle(filename,cache=new Map()) {
  if(cache.has(filename))return cache.get(filename);
  const source=await fs.readFile(filename,'utf8'),imports=[...source.matchAll(/from\s+['"](\.{1,2}\/[^'"]+)['"]/g)];
  let result=source;
  for(const match of imports){const dependency=path.resolve(path.dirname(filename),match[1].split('?')[0]);const code=await bundle(dependency,cache);const uri='data:text/javascript;base64,'+Buffer.from(code).toString('base64');result=result.replace(match[0],match[0].replace(match[1],uri));}
  cache.set(filename,result);return result;
}
const quote=value=>"'"+value.replaceAll("'","'\\''")+"'";
const unavailable=()=>({available:false,notice:'Джерело зв’язку ERP з GA4 тимчасово недоступне.'});

export function createRemoteOverview(target) {
  if(!/^[a-z_][\w-]*@[a-z0-9][a-z0-9.-]*$/i.test(target))throw Error('invalid_preview_source');
  let child,launch,serial=0;
  const pending=new Map();
  async function start(){
    if(launch)return launch;
    if(child)return child;
    launch=(async()=>{
      const source=await bundle(fileURLToPath(new URL('./overview-source-worker.mjs',import.meta.url)));
      const compressed=gzipSync(source).toString('base64');
      const loader=`import {createInterface} from 'node:readline';import {gunzipSync} from 'node:zlib';const input=createInterface({input:process.stdin});input.once('line',async line=>{input.close();const source=gunzipSync(Buffer.from(line,'base64'));process.stdout.write('ready\\n');await import('data:text/javascript;base64,'+source.toString('base64'));});`;
      child=spawn('ssh',['-o','BatchMode=yes','-o','ConnectTimeout=10','-o','ServerAliveInterval=30',target,'node --input-type=module -e '+quote(loader)+' -- --stdio'],{stdio:['pipe','pipe','pipe']});
      const connection = child;
      const lines=createInterface({input:connection.stdout});
      return new Promise(resolve=>{
        let ended = false;
        const disconnected=()=>{
          if (ended) return;
          ended = true;
          clearTimeout(timer);
          if (child===connection) child=null;
          for(const task of pending.values()){clearTimeout(task.timer);task.resolve(unavailable());}
          pending.clear();
          resolve(null);
        };
        const timer=setTimeout(()=>{connection.kill();disconnected();},20000);
        lines.on('line',line=>{
          if (line==='ready') {clearTimeout(timer);resolve(connection);return;}
          try{const message=JSON.parse(line),task=pending.get(message.id);if(task){clearTimeout(task.timer);pending.delete(message.id);task.resolve(message.value);}}catch{}
        });
        connection.stderr.on('data',chunk=>{if(process.env.STUDIO_PREVIEW_SOURCE_DEBUG==='1')process.stderr.write(chunk);});
        connection.on('error',disconnected);
        connection.on('exit',disconnected);
        connection.stdin.on('error',disconnected);
        connection.stdin.write(compressed+'\n');
      });
    })().finally(()=>{launch=null;});
    return launch;
  }
  return {
    async read(input, kind = "overview"){
      const selection=kind === "overview" ? validateSelection(input) : input;
      if(pending.size>=12)return unavailable();
      const process=await start(),id=++serial;
      if (!process) return unavailable();
      return new Promise(resolve=>{
        const timer=setTimeout(()=>{pending.delete(id);resolve(unavailable());},180000);
        pending.set(id,{resolve,timer});
        process.stdin.write(JSON.stringify({id,kind,selection})+'\n',error=>{if(error&&pending.has(id)){clearTimeout(timer);pending.delete(id);resolve(unavailable());}});
      });
    },
    close(){child?.kill();child=null;},
  };
}
