import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const html=readFileSync('static/index.html','utf8');
for(const path of ['static/app.js','static/styles.css'])if(!readFileSync(path,'utf8').trim())throw new Error('Missing '+path);
new vm.Script(readFileSync('static/app.js','utf8'));
if(!html.includes('id="sourceForm"')||!html.includes('id="themeButton"'))throw new Error('Missing working form controls.');
if(/(?:src|href)="\/static\//.test(html))throw new Error('Wrong publish directory asset paths.');
console.log('Static dashboard, startup script and publish paths validated.');
