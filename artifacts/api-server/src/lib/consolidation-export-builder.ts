import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { mkdtemp, readFile, readdir, lstat, mkdir, writeFile, rm } from "node:fs/promises";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { financeRepositoryRoot } from "./finance-wiring";
import { validateInvoiceConfig, type ConsolidationCase } from "./consolidation-recipes";
import { deterministicZip, extract, subprocess, SolutionExportBuildError, type SolutionExportResult, type SolutionExportCheck } from "./solution-export-builder";

const hash = (v: Buffer | string) => createHash("sha256").update(v).digest("hex");
const json = (v: unknown) => JSON.stringify(v, null, 2) + "\n";

/** Inputs are fixed reviewed application paths, never user-uploaded paths or commands. */
async function inputs(recipe: "invoice" | "finance") {
  const root = financeRepositoryRoot(), files = new Map<string, Buffer>();
  const paths = recipe === "invoice" ? [
    "artifacts/invoice-consolidation/src", "artifacts/invoice-consolidation/tests",
    "artifacts/invoice-consolidation/index.html", "artifacts/invoice-consolidation/vite.config.ts",
    "artifacts/invoice-consolidation/package.json", "artifacts/invoice-consolidation/public",
    "lib/api-zod/src/invoice-features.ts",
    ...["invoice-finder", "approval-desk", "spend-tracker"].map(id => `artifacts/${id}/src/domain`),
  ] : [
    "artifacts/finance-consolidation-demo/finance", "artifacts/finance-consolidation-demo/vendor",
    ...["wiring-worker.py", "standalone-server.py", "standalone.html", "provenance.json", "CONTRACT.md", "SOURCE-REVIEW.md", "WIRING.md"].map(p => `artifacts/finance-consolidation-demo/${p}`),
  ];
  paths.push("artifacts/api-server/src/lib/consolidation-export-builder.ts", "artifacts/api-server/src/lib/solution-export-builder.ts", "pnpm-lock.yaml");
  async function visit(path: string) {
    const stat = await lstat(join(root, path));
    if (stat.isSymbolicLink()) throw new Error("Symlink in reviewed export sources.");
    if (stat.isDirectory()) {
      for (const name of (await readdir(join(root, path))).sort()) {
        if (name === "__pycache__" || name.startsWith(".")) continue;
        await visit(`${path}/${name}`);
      }
    } else if (stat.isFile() && !path.endsWith(".pyc")) files.set(path, await readFile(join(root, path)));
  }
  for (const path of paths) await visit(path);
  const fingerprint = hash(json([...files].sort(([a],[b]) => a.localeCompare(b)).map(([path, body]) => ({path,sha256:hash(body)}))));
  return {root,files,fingerprint};
}
export async function getConsolidationExportFingerprint(recipe: "invoice" | "finance") {
  return (await inputs(recipe)).fingerprint;
}
export function invoiceExportRecipe(c: ConsolidationCase) {
  const config = validateInvoiceConfig(c.config, c.capabilityIds);
  return { schemaVersion: 1, snapshotId: c.fingerprint, sources: c.selectedSources.map(s => s.id), capabilities: c.capabilityIds,
    baseSourceId: c.baseSolutionId, wiring: c.wiring,
    ...(config.featureIds !== undefined ? { featureIds: [...config.featureIds] } : {}),
    ...(config.experience !== undefined ? { experience: config.experience } : {}) };
}

const staticServer = `
import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
const root=resolve('public');
http.createServer(async(req,res)=>{
 try {
  let path=decodeURIComponent(new URL(req.url,'http://local').pathname);
  if(path==='/')path='/index.html';
  const file=resolve(root,'.'+path);
  if(!file.startsWith(root+'/')) {res.writeHead(403);res.end();return;}
  const bytes=await readFile(file);
  const type={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml'}[extname(file)]||'application/octet-stream';
  res.writeHead(200,{'Content-Type':type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(bytes);
 }catch {res.writeHead(404);res.end('Not found');}
}).listen(Number(process.env.PORT||3000),'0.0.0.0');
`;

const financeTest = `
import json, unittest
from pathlib import Path
from finance.wiring import run_config
class SnapshotTest(unittest.TestCase):
 def test_saved_forecast_report(self):
  saved=json.loads(Path('saved-wiring.json').read_text())
  expected=json.loads(Path('expected-result.json').read_text())
  actual=run_config(saved['config'])
  self.assertEqual(actual,expected)
  self.assertEqual(actual['fingerprint'],saved['version']['fingerprint'])
 def test_changed_assumption(self):
  config=json.loads(Path('saved-wiring.json').read_text())['config']
  before=run_config(config)
  config['adjustment']=0 if config['adjustment'] else 360
  after=run_config(config)
  self.assertNotEqual(before['fingerprint'],after['fingerprint'])
  self.assertNotEqual(before['lines'],after['lines'])
if __name__=='__main__':unittest.main()
`;
const httpTest = `
import {spawn} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import net from 'node:net';
import assert from 'node:assert/strict';
const snapshot=JSON.parse(await readFile('consolidation-snapshot.json','utf8'));
const port=await new Promise(resolve=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});
const finance=snapshot.recipeId==='finance';
const child=spawn(finance?'python3':process.execPath,finance?['-B','server.py']:['server.mjs'],{env:{PATH:process.env.PATH,PORT:String(port)},stdio:'ignore'});
let failure;child.on('error',e=>failure=e);
try {
 let response;
 for(let i=0;i<100;i++){if(failure)throw failure;try{response=await fetch('http://127.0.0.1:'+port+'/');if(response.ok)break;}catch{}await new Promise(r=>setTimeout(r,50));}
 assert(response?.ok,'Export server must serve its application');
 const html=await response.text();assert(html.includes('<html'),'Actual application HTML');
 if(finance){
  const run=await fetch('http://127.0.0.1:'+port+'/api/run',{method:'POST',headers:{'content-type':'application/json'},body:'{}'});
  assert.equal(run.status,200);assert.deepEqual(await run.json(),JSON.parse(await readFile('expected-result.json','utf8')));
 }else{
  const recipe=await fetch('http://127.0.0.1:'+port+'/recipe.json');
  assert.deepEqual(await recipe.json(),JSON.parse(await readFile('recipe.json','utf8')));
  for(const match of html.matchAll(/(?:src|href)="(\\.\\/assets\\/[^"]+)"/g)){assert.equal((await fetch('http://127.0.0.1:'+port+'/'+match[1])).status,200);}
 }
 console.log('Extracted application HTTP and saved configuration passed');
}finally{child.kill('SIGKILL');}
`;

/** Package the same reviewed application, then test only bytes extracted from that ZIP. */
export async function buildConsolidationExport(c: ConsolidationCase, expectedSource: string): Promise<SolutionExportResult> {
  const checks: SolutionExportCheck[] = [], content = new Map<string, Buffer>();
  const temp = await mkdtemp(join(tmpdir(), "combined-export-"));
  let bytes: Buffer | undefined, sha256: string | undefined;
  const add = (path: string, value: Buffer | string) => content.set(path, Buffer.isBuffer(value) ? value : Buffer.from(value));
  try {
    const source = await inputs(c.recipeId);
    if (source.fingerprint !== expectedSource) throw new Error("Application source changed before export. Retry with the current snapshot.");
    const require = createRequire(join(source.root, "artifacts/api-server/package.json"));
    if (c.recipeId === "invoice") {
      const app = join(source.root, "artifacts/invoice-consolidation");
      const vite = join(dirname(createRequire(join(app,"package.json")).resolve("vite/package.json")),"bin/vite.js");
      await subprocess(process.execPath, [vite,"build","--outDir",join(temp,"built"),"--base","./"], app, 90_000);
      async function collect(dir: string, prefix: string) {
        for (const name of await readdir(dir)) {
          const p = join(dir,name), dest = `${prefix}${name}`;
          if ((await lstat(p)).isDirectory()) await collect(p,`${dest}/`);
          else add(dest,await readFile(p));
        }
      }
      await collect(join(temp,"built"),"public/");
      const recipe = invoiceExportRecipe(c);
      add("public/recipe.json",json(recipe)); add("recipe.json",json(recipe)); add("server.mjs",staticServer);
      const esbuild = join(dirname(require.resolve("esbuild/package.json")),"bin/esbuild");
      for (const [entry,output] of [["src/domain/integration.test.ts","integration.test.mjs"],["tests/export-snapshot.test.ts","snapshot.test.mjs"]]) {
        await subprocess(esbuild,[join(app,entry),"--bundle","--platform=node","--format=esm",`--outfile=${join(temp,output)}`],temp);
        add(output,await readFile(join(temp,output)));
      }
      add("package.json",json({name:"invoice-operations-export",private:true,type:"module",scripts:{start:"node server.mjs",test:"node --test integration.test.mjs snapshot.test.mjs"}}));
      add(".replit",'run = "npm start"\n');
      for (const [path,body] of source.files) add(`source/${path}`,body);
    } else {
      const prefix = "artifacts/finance-consolidation-demo/";
      for (const [path,body] of source.files) if(path.startsWith(prefix)) add(path.slice(prefix.length),body);
      add("server.py",content.get("standalone-server.py")!); add("index.html",content.get("standalone.html")!);
      // Run captured modules in a private staging directory, not a second read of mutable host source.
      const stage=join(temp,"finance-stage"); await mkdir(stage);
      for(const [path,body] of content){await mkdir(dirname(join(stage,path)),{recursive:true});await writeFile(join(stage,path),body);}
      await writeFile(join(stage,"config.json"),json(c.config));
      const output=await subprocess("python3",["-B","-c","import json; from finance.wiring import run_config; print(json.dumps(run_config(json.load(open('config.json')))))"],stage);
      const result=JSON.parse(output);
      add("expected-result.json",json(result));
      add("saved-wiring.json",json({config:c.config,version:{id:c.id,number:c.revision,fingerprint:result.fingerprint}}));
      add("test_snapshot.py",financeTest);
      add(".replit",'run = "python3 -B server.py"\n');
    }
    if ((await inputs(c.recipeId)).fingerprint !== expectedSource) throw new Error("Application source changed during build. No export was accepted.");
    checks.push({name:"registered-application-build",passed:true,detail:"Built the selected reviewed application with pinned source inputs, selected capabilities and exact wiring."});
    add("consolidation-snapshot.json",json(c));
    add("verify-http.mjs",httpTest);
    add("source-manifest.json",json({sourceFingerprint:expectedSource,recipeFingerprint:c.fingerprint,sources:c.selectedSources,files:[...source.files].map(([path,body])=>({path,sha256:hash(body)}))}));
    add("README.md",`# ${c.recipeId === "invoice" ? "Invoice Operations" : "Forecast to Report"} — immutable combination\n\nSynthetic local demonstration. Original source ownership/provenance is retained in source-manifest.json. Only selected capabilities are integrated.\n\nRun: ${c.recipeId === "invoice" ? "npm start (Node 20+, no install)" : "python3 -B server.py (Python 3.11+, standard library)"}.\nTest: ${c.recipeId === "invoice" ? "npm test" : "python3 -B test_snapshot.py"}.\nUses PORT (default 3000). No external accounts, secrets or workspace services required. Open root without a case query parameter. Browser invoice decisions belong to this snapshot only. Finance config is immutable; edit in Workbench and export again.\n\nNo authentication: do not host sensitive data. Import and publication require user action. No app has been provisioned or published by this export.\n`);
    add("files.sha256",[...content].map(([path,body])=>`${hash(body)}  ${path}`).join("\n")+"\n");
    bytes=deterministicZip(content); sha256=hash(bytes);
    if(bytes.length>10_000_000)throw new Error("Combined export exceeds size limit.");
    const clean=join(temp,"extracted");await mkdir(clean);await extract(bytes,clean,content);
    checks.push({name:"archive-extraction",passed:true,detail:"Extracted the immutable ZIP independently and verified every file hash."});
    const detail=c.recipeId==="invoice"
      ? await subprocess(process.execPath,["--test","integration.test.mjs","snapshot.test.mjs"],clean)
      : await subprocess("python3",["-B","test_snapshot.py"],clean);
    checks.push({name:"exported-selected-scenarios",passed:true,detail});
    checks.push({name:"exported-application-http",passed:true,detail:await subprocess(process.execPath,["verify-http.mjs"],clean)});
    return {bytes,sha256,checks,gaps:[],files:[...content].map(([path,body])=>({path,sha256:hash(body)}))};
  } catch(e) {
    const detail=e instanceof Error?e.message:String(e);
    checks.push({name:"combined-export",passed:false,detail});
    throw new SolutionExportBuildError(detail,sha256,checks,bytes);
  } finally {await rm(temp,{recursive:true,force:true});}
}
