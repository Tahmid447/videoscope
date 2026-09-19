import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import vm from 'node:vm';
const core=readFileSync('src/core.js','utf8'),app=readFileSync('src/app.js','utf8');
new vm.Script(core);new vm.Script(app);
const script=s=>'<script>'+s.replace(/<\/script/gi,'<\\/script')+'</script>';
const html=readFileSync('src/index.template.html','utf8').replace('<!-- VIDEOSCOPE_STYLE -->','<style>'+readFileSync('src/styles.css','utf8')+'</style>').replace('<!-- VIDEOSCOPE_SCRIPTS -->',script(core)+'\n'+script(app));
if(html.indexOf('<script>')<html.indexOf('</main>'))throw new Error('Scripts must follow page controls');
mkdirSync('static',{recursive:true});writeFileSync('static/index.html',html);
console.log('Built dashboard; scripts follow page controls.');
