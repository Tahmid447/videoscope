import {mkdir,copyFile,readFile,writeFile} from 'node:fs/promises';
await mkdir('dist',{recursive:true});
for(const name of ['styles.css','metadata.css'])await copyFile('static/'+name,'dist/'+name);
for(const name of ['index.html','app.js','v4.css'])await copyFile('web/'+name,'dist/'+name);
const html=await readFile('dist/index.html','utf8');
if(!html.includes('v4.css') || !html.includes('id="sourceForm"'))throw new Error('Incomplete v4 frontend.');
await writeFile('dist/_headers',`/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: no-referrer\n  X-Frame-Options: DENY\n  Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' https: http: data:; connect-src 'self'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'\n`);
console.log('VideoScope v4 static assets built; v3 rollback remains in static/.');
