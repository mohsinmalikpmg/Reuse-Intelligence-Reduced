/** Trusted templates only: snapshot text is always serialized as JSON, never interpolated into code. */
export const runtimeTemplate = `
import { readFile } from 'node:fs/promises';
import { executeWorkflow } from './engine/run.js';
export const config = JSON.parse(await readFile(new URL('../configuration.json', import.meta.url), 'utf8'));
export const samples = JSON.parse(await readFile(new URL('../samples.json', import.meta.url), 'utf8'));
export function run(input) {
  if (typeof input !== 'string' || input.length > 100000) throw new Error('Input must be text of at most 100000 characters.');
  return executeWorkflow(config.capabilities, config.configValues, input);
}
`;

export const serverTemplate = `
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { config, samples, run } from './runtime.js';
const html = await readFile(new URL('../public/index.html', import.meta.url));
const server = http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'");
  const json = (status, data) => { res.writeHead(status, {'content-type':'application/json'}); res.end(JSON.stringify(data)); };
  if (req.method === 'GET' && req.url === '/') { res.writeHead(200, {'content-type':'text/html; charset=utf-8'}); res.end(html); return; }
  if (req.method === 'GET' && req.url === '/api/config') return json(200, config);
  if (req.method === 'GET' && req.url === '/api/samples') return json(200, samples);
  if (req.method !== 'POST' || req.url !== '/api/run') return json(404, {error:'Not found'});
  try {
    let size = 0; const chunks = [];
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 150000) { json(413, {error:'Request too large'}); req.resume(); return; }
      chunks.push(chunk);
    }
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    json(200, run(body.input));
  } catch (error) { json(400, {error:error.message}); }
});
server.requestTimeout = 10000;
server.headersTimeout = 10000;
server.maxConnections = 32;
const port = Number(process.env.PORT ?? 3000);
if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid PORT');
server.listen(port, '0.0.0.0', () => console.log('LISTENING ' + server.address().port));
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => server.close(() => process.exit(0)));
`;

export const htmlTemplate = `<!doctype html>
<html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Standalone workflow</title><style>
body{font:16px system-ui;max-width:960px;margin:40px auto;padding:0 24px;color:#182528;background:#f4f7f5}
textarea{box-sizing:border-box;width:100%;min-height:220px;padding:14px;font:14px monospace}
button,select{padding:10px;margin:12px 8px 12px 0}pre{white-space:pre-wrap;background:white;padding:20px}
.notice{border-left:4px solid #a76116;padding:12px;background:#fff5e4}li{margin:6px 0}
</style><h1 id="title">Standalone workflow</h1>
<p class="notice">Demo engine, not a production integration. No login, audit persistence, external notifications, or enterprise data connections. Do not expose publicly or submit sensitive data.</p>
<h2>Scope and gaps</h2><ul id="gaps"></ul><label for="sample">Sample input</label> <select id="sample"></select>
<label for="input">Workflow input</label><textarea id="input" maxlength="100000"></textarea>
<button id="run">Run selected workflow</button><p id="status" role="status"></p><pre id="output"></pre>
<script type="module">
const el = id => document.getElementById(id);
try {
 const [config,samples] = await Promise.all(['/api/config','/api/samples'].map(async p => {const r=await fetch(p);if(!r.ok)throw Error('Load failed');return r.json()}));
 el('title').textContent=config.title;
 for(const gap of config.gaps){const li=document.createElement('li');li.textContent=gap;el('gaps').append(li)}
 for(const [i,s] of samples.entries()){const option=document.createElement('option');option.value=i;option.textContent=s.name;el('sample').append(option)}
 const load=()=>{el('input').value=samples[Number(el('sample').value)]?.text ?? ''};el('sample').onchange=load;load();
 el('run').onclick=async()=>{el('run').disabled=true;el('status').textContent='Running…';try{
 const r=await fetch('/api/run',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({input:el('input').value})});
 const result=await r.json();if(!r.ok)throw Error(result.error);el('output').textContent=JSON.stringify(result,null,2);el('status').textContent=result.errors.length?'Completed with errors':'Completed';
 }catch(e){el('status').textContent=e.message}finally{el('run').disabled=false}};
}catch(e){el('status').textContent=e.message}
</script></html>`;

export const testTemplate = `
import test from 'node:test';
import assert from 'node:assert/strict';
import { executeWorkflow, executableSteps } from '../src/engine/run.js';
import { config, samples, run } from '../src/runtime.js';
const caps = ids => ids.map(id => ({id,name:id,workflowStep:'Analyze'}));
const execute = (ids,input,settings={}) => executeWorkflow(caps(ids),settings,input);
const items = result => result.output.sections.flatMap(s=>s.items);
test('selected configuration runs with exact selected executable steps', () => {
 assert.ok(samples.length);
 for(const sample of samples) {
  const result=run(sample.text);assert.deepEqual(result.errors,[]);
  assert.deepEqual(result.trace.filter(t=>t.stepId!=='input').map(t=>t.stepId),executableSteps(config.capabilities).map(c=>c.id));
 }
 assert.throws(()=>run(null));assert.throws(()=>run('x'.repeat(100001)));
});
test('maintenance parser -> findings -> review -> routing -> actions', () => {
 const input='WO-1 | 2026-01-01 | North | P-104 (pump) | vibration alarm\\nWO-2 | 2026-01-02 | North | P-104 (pump) | vibration again';
 const ids=['cap-wo-ingest','cap-summarize','cap-recurring','cap-review-queue','cap-routing','cap-action-tracking'];
 const low=execute(ids,input,{'cap-review-queue':'Flag after 2 occurrences','cap-routing':'Central queue'});
 assert.deepEqual(low.errors,[]);
 assert.ok(items(low).some(i=>i.kind==='recurring'&&i.refs.length===2));
 assert.ok(items(low).some(i=>i.kind==='route'&&i.text.includes('Central maintenance')));
 assert.ok(items(low).some(i=>i.kind==='action'&&i.text.includes('2026-01-16')));
 const high=execute(ids,input,{'cap-review-queue':'Flag after 5 occurrences'});
 assert.equal(items(high).filter(i=>i.kind==='review').length,0);
 const compact=execute(['cap-wo-ingest','cap-summarize'],input,{'cap-summarize':'Approved model: Compact LLM'});
 assert.ok(items(compact).some(i=>i.kind==='summary'&&!i.text.includes('North')));
});
test('safety -> review -> approval', () => {
 const result=execute(['cap-safety-signals','cap-review-queue','cap-approval'],'A hydrocarbon leak was found.');
 assert.ok(items(result).some(i=>i.kind==='safety'));
 assert.ok(items(result).some(i=>i.kind==='review'));
 assert.ok(items(result).some(i=>i.kind==='control'&&i.text.includes('approval required')));
});
test('procedure search -> cited answer and no-match path', () => {
 const ids=['cap-proc-index','cap-proc-answers'];
 assert.ok(items(execute(ids,'pump vibration bearing')).some(i=>i.kind==='answer'&&i.refs.includes('SOP-052')));
 assert.ok(items(execute(ids,'zzzz')).some(i=>i.kind==='answer'&&i.text.includes('could not find')));
});
test('incident and handover transformations', () => {
 assert.ok(items(execute(['cap-incident-actions'],'Supervisor requested a gasket replacement before restart.')).some(i=>i.kind==='action'));
 assert.ok(items(execute(['cap-handover-summary'],'22:10 Pump alarm acknowledged. Day shift watch pump.')).some(i=>i.kind==='watch'));
});
test('aliases and cross-site clustering -> ranking', () => {
 const text='WO-1 | 2026-01-01 | North | P-104 (pump) | vibration\\nWO-2 | 2026-01-02 | South | P-220 (pump) | vibration';
 const r=execute(['cap-csv-ingest','cap-b-summarize','cap-clustering','cap-similarity'],text);
 assert.deepEqual(r.errors,[]);
 assert.ok(items(r).some(i=>i.kind==='pattern'&&i.text.startsWith('#1')));
 assert.equal(items(r).filter(i=>i.kind==='summary').length,2);
});
`;

export const httpTestTemplate = `
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { config, samples, run } from '../src/runtime.js';
const child=spawn(process.execPath,['--max-old-space-size=96','src/server.js'],{cwd:process.cwd(),env:{PORT:'0',NODE_ENV:'production',TZ:'UTC'},stdio:['ignore','pipe','pipe']});
let output='', errors='';
child.stdout.on('data',d=>output+=d);child.stderr.on('data',d=>errors+=d);
try {
 let port;
 for(let i=0;i<100;i++){port=output.match(/LISTENING (\\d+)/)?.[1];if(port)break;if(child.exitCode!==null)throw Error('Server exited: '+errors);await delay(50)}
 assert.ok(port,'Server did not start');
 const base='http://127.0.0.1:'+port;
 const request=async(path,options)=>{const response=await fetch(base+path,{...options,signal:AbortSignal.timeout(3000)});return response};
 assert.ok((await (await request('/')).text()).includes('Run selected workflow'));
 assert.deepEqual(await (await request('/api/config')).json(),config);
 assert.deepEqual(await (await request('/api/samples')).json(),samples);
 const stable=r=>({output:r.output,stats:r.stats,errors:r.errors,steps:r.trace.map(t=>({stepId:t.stepId,status:t.status,itemCount:t.itemCount}))});
 for(const sample of samples) {
  const response=await request('/api/run',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({input:sample.text})});
  assert.equal(response.status,200);assert.deepEqual(stable(await response.json()),stable(run(sample.text)));
 }
 assert.equal((await request('/api/run',{method:'POST',body:'invalid'})).status,400);
 assert.equal((await request('/api/run',{method:'POST',body:JSON.stringify({input:7})})).status,400);
 assert.equal((await request('/api/run',{method:'POST',body:JSON.stringify({input:'x'.repeat(100001)})})).status,400);
 assert.equal((await request('/api/run',{method:'POST',body:JSON.stringify({input:'x'.repeat(160000)})})).status,413);
 assert.equal((await request('/not-found')).status,404);
 console.log('Startup, PORT, UI, configuration, samples, HTTP engine parity and invalid input checks passed');
} finally {
 child.kill('SIGTERM');
 await Promise.race([new Promise(resolve=>child.once('exit',resolve)),delay(1000)]);
 if(child.exitCode===null)child.kill('SIGKILL');
}
`;
