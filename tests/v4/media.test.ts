import test from 'node:test';import assert from 'node:assert/strict';
import {mediaFile,validateMp4,MAX_MEDIA_BYTES} from '../../engine/media.ts';
const box=(type:string,content:string)=>{const data=Buffer.from(content);const out=Buffer.alloc(8+data.length);out.writeUInt32BE(out.length);out.write(type,4);data.copy(out,8);return out;};
const mp4=Buffer.concat([box('ftyp','isom'),box('moov','vide'),box('mdat','media bytes')]);
test('MP4 containers require complete video tracks and reject protected/truncated content',()=>{
  assert.doesNotThrow(()=>validateMp4(mp4));assert.throws(()=>validateMp4(mp4.subarray(0,-1)),/incomplete/);
  assert.throws(()=>validateMp4(Buffer.from('<html>not a video</html>')));
  assert.throws(()=>validateMp4(Buffer.concat([box('ftyp','isom'),box('moov','vide encv'),box('mdat','x')])),/Protected/);
});
test('media retrieval checks MIME, size, robots, redirects and returns actual bytes',async()=>{
  const resolve=async()=>{};
  const fetcher=(async(url:string)=>url.endsWith('/robots.txt')?new Response('',{status:404}):new Response(mp4,{headers:{'content-type':'video/mp4','content-length':String(mp4.length)}})) as typeof fetch;
  assert.deepEqual(Buffer.from((await mediaFile('https://example.com/clip.mp4',{fetcher,resolve})).bytes),mp4);
  await assert.rejects(mediaFile('https://example.com/clip.mp4',{resolve,fetcher:(async u=>String(u).endsWith('/robots.txt')?new Response('',{status:404}):new Response('oops',{headers:{'content-type':'text/html'}})) as typeof fetch}),/MP4/);
  await assert.rejects(mediaFile('https://example.com/clip.mp4',{resolve,fetcher:(async u=>String(u).endsWith('/robots.txt')?new Response('',{status:404}):new Response(mp4,{headers:{'content-type':'video/mp4','content-length':String(MAX_MEDIA_BYTES+1)}})) as typeof fetch}),/16 MB/);
  await assert.rejects(mediaFile('https://example.com/clip.mp4',{resolve,fetcher:(async u=>String(u).endsWith('/robots.txt')?new Response('User-agent: *\nDisallow: /clip.mp4'):new Response(mp4)) as typeof fetch}),/disallow/);
  await assert.rejects(mediaFile('https://example.com/clip.mp4',{resolve,fetcher:(async u=>String(u).endsWith('/robots.txt')?new Response('',{status:404}):new Response(null,{status:302,headers:{location:'http://127.0.0.1/private'}})) as typeof fetch}),/Private/);
});
