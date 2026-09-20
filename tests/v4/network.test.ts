import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {transport,publicAddress,publicUrl} from '../../engine/network.ts';
import {backoff,retryAfter} from '../../engine/errors.ts';
test('public address validation covers encoded, mapped, IPv6, link-local and metadata addresses',()=>{
 for(const s of ['http://127.0.0.1','http://2130706433','http://0x7f000001','http://[::1]','http://[::ffff:127.0.0.1]','http://169.254.169.254','http://metadata.google.internal','file:///etc/passwd','http://user:pass@example.com','http://10.0.0.1','http://[fc00::1]'])assert.throws(()=>publicUrl(s),s);
 assert.equal(publicAddress('8.8.8.8'),true);assert.equal(publicAddress('192.0.2.1'),false);
 assert.equal(retryAfter('30'),30000);assert.ok(backoff(2,30000,()=>0.5)>=30000);
});
test('mock HTTP server: safe redirects, robots, 429/500/403, bounded response bodies, no credential redirect',async()=>{
 const requests:string[]=[];
 const server=createServer((req,res)=>{requests.push(req.url!);if(req.url==='/robots.txt'){res.end('User-agent: *\nDisallow: /private\n');return;}if(req.url==='/redirect-private'){res.writeHead(302,{location:'https://source.example.com/private'});res.end();return;}if(req.url==='/redirect'){res.writeHead(302,{location:'http://127.0.0.1/secret'});res.end();return;}if(req.url==='/large'){res.end('x'.repeat(4_000_001));return;}if(req.url==='/429'){res.writeHead(429,{'retry-after':'60'});res.end();return;}if(req.url==='/500'||req.url==='/403'){res.writeHead(Number(req.url.slice(1)));res.end();return;}res.end('public metadata');});
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const port=(server.address() as any).port;
 const fetcher:typeof fetch=(input,init)=>fetch(`http://127.0.0.1:${port}${new URL(String(input)).pathname}`,init);
 const read=transport({fetcher,resolve:async()=>{}});
 try{
   assert.equal((await read('https://source.example.com/ok')).text,'public metadata');
   await assert.rejects(read('https://source.example.com/private'),/disallow/);assert.ok(!requests.includes('/private'));
   await assert.rejects(read('https://source.example.com/redirect'),/Private|reserved/);
   await assert.rejects(read('https://source.example.com/redirect-private'),/disallow/);
   await assert.rejects(read('https://source.example.com/large'),/4 MB/);
   await assert.rejects(read('https://source.example.com/429'),(e:any)=>e.retryable&&e.retryAfterMs===60000);
   await assert.rejects(read('https://source.example.com/500'),(e:any)=>e.retryable);
   await assert.rejects(read('https://source.example.com/403'),(e:any)=>!e.retryable);
   await assert.rejects(read('https://www.googleapis.com/redirect',{official:true,headers:{Authorization:'secret'}}),/credentials were not forwarded/);
 }finally{await new Promise<void>(r=>server.close(()=>r()));}
});
