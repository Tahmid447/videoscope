import {execFileSync} from 'node:child_process';
const run=process.env.ACCEPTANCE_RUN;
if(!/^\d+$/.test(run||''))throw new Error('Production requires a successful preview acceptance run ID.');
const data=JSON.parse(execFileSync('gh',['api',`repos/${process.env.GITHUB_REPOSITORY}/actions/runs/${run}`],{encoding:'utf8'}));
if(data.head_sha!==process.env.GITHUB_SHA || data.conclusion!=='success' || data.path!=='.github/workflows/cloudflare-acceptance.yml')throw new Error('Production blocked: preview acceptance must pass for the exact release commit.');
console.log('Exact-commit preview acceptance passed.');
