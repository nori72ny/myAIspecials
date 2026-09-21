import { appendFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
const exec = promisify(execFile);
const SHA40=/^[a-f0-9]{40}$/;
function req(n){const v=process.env[n]?.trim();if(!v)throw new Error(`AQ_FINAL_STATE_ENV_MISSING:${n}`);return v;}
function headers(t){return{Accept:"application/vnd.github+json",Authorization:`Bearer ${t}`,"X-GitHub-Api-Version":"2022-11-28"};}
async function json(url,t){const r=await fetch(url,{headers:headers(t),redirect:"error",signal:AbortSignal.timeout(15000)});if(!r.ok)throw new Error(`AQ_FINAL_STATE_GITHUB_HTTP_${r.status}`);return r.json();}
async function bytes(url,t){const r=await fetch(url,{headers:headers(t),redirect:"follow",signal:AbortSignal.timeout(30000)});if(!r.ok)throw new Error(`AQ_FINAL_STATE_DOWNLOAD_HTTP_${r.status}`);return Buffer.from(await r.arrayBuffer());}
function valid(v,b,c,i){return v?.schemaVersion==="origin.aq-local-shard-result.v1"&&v?.ok===true&&v?.shard?.schemaVersion==="origin.aq-official-shard-comparison.v1"&&v.shard.shardIndex===i&&v.shard.baselineGitSha===b&&v.shard.candidateGitSha===c&&/^sha256:[a-f0-9]{64}$/.test(String(v.shard.shardDigest||""));}
async function main(){
 const repo=req("GITHUB_REPOSITORY"),token=req("GITHUB_TOKEN"),out=req("GITHUB_OUTPUT"),b=req("BASELINE_SHA"),c=req("CANDIDATE_SHA"),dir=path.resolve(req("AQ_STATE_DIR")),count=Number(req("EXPECTED_SHARD_COUNT"));
 if(!SHA40.test(b)||!SHA40.test(c)||!Number.isInteger(count)||count<1||count>50)throw new Error("AQ_FINAL_STATE_INPUT_INVALID");
 await rm(dir,{recursive:true,force:true});await mkdir(dir,{recursive:true,mode:0o700});
 const artifacts=[];for(let p=1;p<=10;p++){const x=await json(`https://api.github.com/repos/${repo}/actions/artifacts?per_page=100&page=${p}`,token);const a=Array.isArray(x?.artifacts)?x.artifacts:[];artifacts.push(...a);if(a.length<100)break;}
 const done=[];
 for(let i=0;i<count;i++){const name=`aq-live-final-shard-${c}-s${i}`;const a=artifacts.filter(x=>x&&!x.expired&&x.name===name&&typeof x.archive_download_url==="string").sort((x,y)=>Date.parse(y.created_at||"")-Date.parse(x.created_at||""))[0];if(!a)continue;
  const zip=path.join(dir,`a-${i}.zip`),ex=path.join(dir,`x-${i}`);await writeFile(zip,await bytes(a.archive_download_url,token),{mode:0o600});await mkdir(ex,{recursive:true,mode:0o700});await exec("unzip",["-q","-o",zip,"-d",ex],{timeout:15000,maxBuffer:1048576});
  const src=path.join(ex,`aq-official-shard-${i}.json`),raw=await readFile(src,"utf8"),v=JSON.parse(raw);if(!valid(v,b,c,i))throw new Error(`AQ_FINAL_STATE_ARTIFACT_INVALID:${i}`);
  await writeFile(path.join(dir,`aq-official-shard-${i}.json`),raw,{mode:0o600});done.push(i);await rm(zip,{force:true});await rm(ex,{recursive:true,force:true});
 }
 const missing=Array.from({length:count},(_,i)=>i).filter(i=>!done.includes(i)),complete=missing.length===0;
 await appendFile(out,`complete=${complete?"true":"false"}\ncompleted_count=${done.length}\nnext_index=${complete?"":missing[0]}\n`,"utf8");
 process.stdout.write(`AQ final state ${done.length}/${count}${complete?" complete":` next=${missing[0]}`}\n`);
}
main().catch(e=>{process.stderr.write(`${e instanceof Error?e.message:"AQ_FINAL_STATE_FAILED"}\n`);process.exitCode=1;});