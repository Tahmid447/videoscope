import test from 'node:test';
import {ProviderError} from '../../engine/errors.ts';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {detect} from '../../engine/providers/index.ts';
import {youtube} from '../../engine/providers/youtube.ts';
import {meta} from '../../engine/providers/meta.ts';
import {generic,scopedFeed} from '../../engine/providers/generic.ts';
import {tokyomotion,tokyoLinks} from '../../engine/providers/tokyomotion.ts';
import {htmlRecords,feedRecords,oembedRecord,wordpressRecords,sitemapRecords} from '../../engine/extractors.ts';
import {type ProviderContext,type ReadResult} from '../../engine/model.ts';
const fixture=(file:string)=>readFileSync(new URL('./fixtures/'+file,import.meta.url),'utf8');
const response=(text:string,url='https://fixture.example.com'):ReadResult=>({text,url,status:200,headers:new Headers()});
const context=(extra:Partial<ProviderContext>={}):ProviderContext=>({env:{},retryAttempt:0,read:async()=>{throw new Error('Unexpected network');},seen:async()=>false,collected:0,expected:null,now:'2026-09-20T00:00:00Z',...extra});
test('regression sources detect by host/type, and lookalike hosts are not official providers',()=>{
  assert.equal(detect('https://www.youtube.com/@FilmiIndian/videos').provider,'youtube');
  assert.equal(detect('https://www.tokyomotion.net/user/yua_xx/videos').sourceType,'profile');
  assert.equal(detect('https://www.tokyomotion.net/search?search_query=%E3%82%A8%E3%82%B9%E3%83%86&search_type=videos').sourceType,'search');
  assert.equal(detect('https://www.youtube.com.evil.example.com/@x/videos').provider,'generic');
  for(const url of ['https://www.youtube.com/channel/UCfixture/videos','https://www.youtube.com/playlist?list=PLfixture','https://youtu.be/fixture0001'])assert.equal(detect(url).provider,'youtube');
});
test('YouTube missing credential is explicit before any generic HTML request',async()=>{await assert.rejects(youtube.enumerate(detect('https://youtube.com/@fixture/videos'),null,context()),/YOUTUBE_API_KEY/);});
test('YouTube resolves uploads, follows more than 50 IDs, then enriches batches with real zero and null',async()=>{
  const f=JSON.parse(fixture('youtube.json')),calls:URL[]=[];
  const ctx=context({env:{YOUTUBE_API_KEY:'test-only-key'},read:async(url,opts)=>{
    const u=new URL(url);calls.push(u);assert.equal(opts?.headers?.['x-goog-api-key'],'test-only-key');assert.ok(!url.includes('test-only-key'));
    if(u.pathname.endsWith('/channels'))return response(JSON.stringify(f.channel),url);
    if(u.pathname.endsWith('/videos'))return response(JSON.stringify({items:[f.video]}),url);
    const next=u.searchParams.get('pageToken'),offset=next?50:0;
    return response(JSON.stringify({items:Array.from({length:next?11:50},(_,i)=>({snippet:{title:`Video ${offset+i}`,resourceId:{videoId:`id${offset+i}`}},contentDetails:{videoId:`id${offset+i}`}})),pageInfo:{totalResults:61},...(!next?{nextPageToken:'opaque-next'}:{})}),url);
  }});
  const source=detect('https://youtube.com/@fixture/videos');const a=await youtube.enumerate(source,null,ctx),b=await youtube.enumerate(source,a.nextCursor,ctx);
  assert.equal(a.items.length+b.items.length,61);assert.ok(b.complete);assert.equal(calls.filter(u=>u.pathname.endsWith('channels')).length,1);assert.equal(a.items[0].views,null);
  const v=await youtube.enrich!([{...a.items[0],id:'youtube:fixture0001',sourceVideoId:'fixture0001'}],ctx);assert.equal(v[0].views,0);assert.equal(v[0].durationSeconds,3723);assert.equal(v[0].likes,12);
});
test('JSON-LD, OpenGraph, oEmbed, RSS, Atom, WordPress, sitemap fixture extractors',()=>{
  const schema=htmlRecords(fixture('standards.html'),'https://standards.example.com/');assert.equal(schema.items[0].views,0);assert.equal(schema.items[0].likes,null);
  const og=htmlRecords('<meta property="og:type" content="video.other"><meta property="og:title" content="A lesson"><meta property="og:image" content="https://images.example.com/1.jpg">','https://standards.example.com/watch');assert.equal(og.items[0].title,'A lesson');
  const oe=oembedRecord({type:'video',title:'A video',author_name:'Teacher',width:1920,height:1080},'https://standards.example.com/watch');assert.equal(oe?.uploader,'Teacher');assert.equal(oe?.width,null);
  const rss=feedRecords(fixture('rss.xml'),'https://archive.example.com/topic/feed/');assert.equal(rss.items[0].uploader,'Teaching Lab');assert.ok(rss.next?.includes('paged=2'));assert.equal(rss.items[0].views,null);
  const atom=feedRecords(fixture('atom.xml'),'https://archive.example.com/atom');assert.equal(atom.items.length,1);assert.ok(atom.next?.includes('page=2'));
  const wp=wordpressRecords(JSON.parse(fixture('wordpress.json')),'https://archive.example.com/wp-json/wp/v2/posts');assert.equal(wp[0].thumbnailUrl,'https://images.example.com/lesson.jpg');
  const sitemap=sitemapRecords('<urlset xmlns:video="x"><url><loc>https://standards.example.com/v/1</loc><video:video><video:title>Lesson</video:title><video:duration>45</video:duration></video:video></url></urlset>','https://standards.example.com/sitemap.xml');assert.equal(sitemap.items[0].durationSeconds,45);
});
test('RSS fallback is generic, preserves archive scope, and does not fallback searches to a root feed',async()=>{
  const ctx=context({read:async(url)=>{if(url.includes('/actress/any-name/feed'))return response(fixture('rss.xml'),url);throw new Error('HTML blocked');}});
  const page=await generic.enumerate(detect('https://internetchicks.com/actress/any-name/'),null,ctx);assert.equal(page.items.length,1);assert.equal(page.items[0].provider,'wordpress-rss');
  let feed=false;await assert.rejects(generic.enumerate(detect('https://archive.example.com/search?q=hello'),null,context({read:async(url)=>{feed ||= url.includes('feed');return response('<h1>Search</h1>',url);}})));assert.equal(feed,false);
});
test('Meta authorized Graph cursor is reconstructed without saving access tokens',async()=>{
  const source=detect('https://instagram.com/fixture/');await assert.rejects(meta.enumerate(source,null,context()),/authorization|authorized/i);
  const p=await meta.enumerate(source,null,context({env:{META_ACCESS_TOKEN:'secret',META_GRAPH_VERSION:'v26.0',META_AUTHORIZED_SOURCES:JSON.stringify([{url:source.url,objectId:'123',kind:'instagram'}])},read:async(url,opts)=>{assert.equal(opts?.headers?.Authorization,'Bearer secret');return response(fixture('meta.json'),url);}}));
  assert.equal(p.items.length,1);assert.equal(p.items[0].likes,0);assert.deepEqual(p.nextCursor,{after:'opaqueCursor'});assert.ok(!JSON.stringify(p).includes('DO_NOT_PERSIST'));
});
test('TokyoMotion pagination has no 25 or 1000 page cap, keeps queries, and discovers public sort windows',()=>{
  const url='https://www.tokyomotion.net/search?search_query=arbitrary&search_type=videos';
  const links=tokyoLinks(`<a href="${url}&page=1001">1001</a><a href="${url}&o=mv">Most Viewed</a><a href="${url.replace('arbitrary','wrong')}&page=2">2</a>`,url,url);
  assert.equal(links.pages.length,1);assert.ok(links.pages[0].includes('1001'));assert.equal(links.orders.length,1);
});
test('TokyoMotion source layouts preserve nullable rating and stable identity',async()=>{
  const url='https://www.tokyomotion.net/user/arbitrary/videos';
  const html='<h1>Videos</h1><div id="video_123"><a href="/video/123/old-slug" title="Lesson video"><img src="https://images.example.com/1.jpg"></a><span class="video-views">0 views</span><span class="duration">3:00</span><span class="video-rating no-rating">0%</span></div><p>Showing 1 to 1 of 1 videos</p>';
  const p=await tokyomotion.enumerate(detect(url),null,context({read:async()=>response(html,url)}));assert.equal(p.items[0].id,'tokyomotion:123');assert.equal(p.items[0].views,0);assert.equal(p.items[0].rating,null);
});

test('archive feeds cannot broaden a collection to the site-wide feed',()=>{
 assert.equal(scopedFeed('https://archive.example.com/feed/','https://archive.example.com/category/science/'),false);
 assert.equal(scopedFeed('https://archive.example.com/category/science/feed/','https://archive.example.com/category/science/'),true);
});

test('only a verified WordPress inferred continuation may end on 404; access denials remain errors',async()=>{
 const source=detect('https://archive.example.com/category/lessons/');
 const first=await generic.enumerate(source,null,context({read:async url=>response(fixture('rss.xml'),url.endsWith('/feed/')?url:source.url+'/feed/')}));
 assert.ok(first.nextCursor);
 const missing=context({read:async()=>{throw new ProviderError('http_404','Not found',404);}});
 const last=await generic.enumerate(source,first.nextCursor,missing);assert.ok(last.complete);assert.equal(last.items.length,0);
 await assert.rejects(generic.enumerate(source,{url:source.url+'/feed/',mode:'feed'},missing),/Not found/);
 await assert.rejects(generic.enumerate(source,first.nextCursor,context({read:async()=>{throw new ProviderError('http_403','Denied',403);}})),/Denied/);
 const other=feedRecords(fixture('rss.xml').replace(/<generator>.*?<\/generator>/,''),'https://archive.example.com/feed/');assert.equal(other.next,null);assert.equal(other.bounded,true);
});

test('TokyoMotion fills a published numeric range when an intermediate page omits its pager',async()=>{
 const source=detect('https://www.tokyomotion.net/user/fixture/videos');
 const html=(n:number)=>`<div id="video_${n}"><a href="/video/${n}/lesson" title="Video lesson"><img src="https://images.example.com/${n}.jpg"></a><span>1 views</span></div>`;
 const read=async(url:string)=>{const n=Number(new URL(url).searchParams.get('page')||1);return response(html(n)+(n===1?'<a href="?page=4">4</a>':''),url);};
 let cursor:any=null;const seen:number[]=[];
 for(let n=0;n<4;n++){const page=await tokyomotion.enumerate(source,cursor,context({read}));seen.push(Number(page.items[0].sourceVideoId));cursor=page.nextCursor;}
 assert.deepEqual(seen,[1,2,3,4]);assert.equal(cursor,null);
});

test('an empty page reporting 1150 videos is a retryable parser gap, not a successful zero collection',async()=>{
 const url='https://www.tokyomotion.net/search?search_query=fixture&search_type=videos';
 await assert.rejects(tokyomotion.enumerate(detect(url),null,context({read:async()=>response('<p>1150 videos</p>',url)})),(e:any)=>e.code==='empty_intermediate_page'&&e.retryable);
});

test('TokyoMotion revisits an empty intermediate page once after reading other published pages',async()=>{
 const source=detect('https://www.tokyomotion.net/user/fixture/videos');let calls=0;
 const read=async(url:string)=>{const page=Number(new URL(url).searchParams.get('page')||1);calls++;return response(calls===2?'<p>Showing 21 to 40 of 60 videos</p>':`<div id="video_${page}"><a href="/video/${page}/lesson" title="Video lesson"><img src="https://images.example.com/${page}.jpg"></a></div>${page===1?'<a href="?page=3">3</a>':''}`,url);};
 let page=await tokyomotion.enumerate(source,null,context({read}));page=await tokyomotion.enumerate(source,page.nextCursor,context({read,retryAttempt:2}));
 assert.equal(page.partial,false);page=await tokyomotion.enumerate(source,page.nextCursor,context({read}));assert.match(String((page.nextCursor as any).checkpointKey),/gap-recheck/);
 page=await tokyomotion.enumerate(source,page.nextCursor,context({read}));assert.equal(page.complete,true);assert.equal(page.partial,false);assert.equal(page.items[0].sourceVideoId,'2');
});

test('an empty message inside an advertised range retries even when it says no videos found',async()=>{
 const url='https://www.tokyomotion.net/user/fixture/videos';
 await assert.rejects(tokyomotion.enumerate(detect(url),{url:url+'?page=2',orders:[],seenOrders:[],lastPage:3,maxAdvertisedPage:3},context({expected:60,read:async()=>response('<p>No videos found</p>',url+'?page=2')})),(e:any)=>e.retryable);
});
