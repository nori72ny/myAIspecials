import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import request from 'supertest';

import { createOriginApp } from '../src/server/createOriginApp.js';

const execute=promisify(execFile);

const tasks=[
  'AIエージェントに関する最新情報を複数ソースで調査してください。',
  'Cloudflare Workers AIの最新情報を複数ソースで調査してください。',
  'GitHub Actionsの最新情報を複数ソースで調査してください。',
] as const;

async function main():Promise<void>{
  const {stdout}=await execute('git',['rev-parse','HEAD'],{cwd:process.cwd()});
  const candidateSha=stdout.trim().toLowerCase();
  if(!/^[a-f0-9]{40}$/.test(candidateSha))throw new Error('RESEARCH_LIVE_CANDIDATE_SHA_INVALID');

  const app=createOriginApp({
    ...process.env,
    NODE_ENV:'test',
    ORIGIN_RELEASE_SHA:candidateSha,
  });

  const status=await request(app).get('/api/research/v1.1/status');
  if(
    status.status!==200
    || status.body?.ok!==true
    || status.body?.retrieval!=='free-public-web'
    || status.body?.freeOnly!==true
    || status.body?.costUsd!==0
    || status.body?.paidFallbackEnabled!==false
  )throw new Error('RESEARCH_LIVE_STATUS_CONTRACT_INVALID');

  const results:Array<Record<string,unknown>>=[];
  let solved=0;

  for(let index=0;index<tasks.length;index+=1){
    const query=tasks[index];
    const started=Date.now();
    const response=await request(app)
      .post('/api/research/v1.1/query')
      .set('content-type','application/json')
      .send({query});
    const elapsedMs=Date.now()-started;
    const body=response.body as Record<string,unknown>;

    if(response.status===200){
      const sources=Array.isArray(body.sources)?body.sources:[];
      if(
        body.ok!==true
        || body.freeOnly!==true
        || body.costUsd!==0
        || body.paidFallbackUsed!==false
        || typeof body.report!=='string'
        || !body.report.trim()
        || sources.length<1
      )throw new Error('RESEARCH_LIVE_SUCCESS_CONTRACT_INVALID');

      const domains=new Set<string>();
      for(const source of sources){
        if(!source||typeof source!=='object'||Array.isArray(source))throw new Error('RESEARCH_LIVE_SOURCE_INVALID');
        const url=(source as Record<string,unknown>).url;
        if(typeof url!=='string'||!/^https?:\/\//i.test(url))throw new Error('RESEARCH_LIVE_SOURCE_URL_INVALID');
        try{ domains.add(new URL(url).hostname.toLowerCase().replace(/^www\./,'')); }
        catch{ throw new Error('RESEARCH_LIVE_SOURCE_URL_INVALID'); }
      }

      const meetsMultiSource=sources.length>=2&&domains.size>=2;
      if(meetsMultiSource) solved+=1;
      results.push({
        taskId:`research-live-${index+1}`,
        status:meetsMultiSource?'completed':'insufficient-evidence',
        sourceCount:sources.length,
        distinctDomainCount:domains.size,
        provider:body.provider??null,
        latencyMs:elapsedMs,
        costUsd:0,
      });
      continue;
    }

    if(
      ![429,503].includes(response.status)
      || body.freeOnly!==true
      || body.costUsd!==0
      || body.paidFallbackUsed!==false
    )throw new Error('RESEARCH_LIVE_FAILURE_CONTRACT_INVALID');

    const failure=body.failure&&typeof body.failure==='object'&&!Array.isArray(body.failure)
      ? body.failure as Record<string,unknown>
      : null;
    const fallback=body.fallback&&typeof body.fallback==='object'&&!Array.isArray(body.fallback)
      ? body.fallback as Record<string,unknown>
      : null;
    results.push({
      taskId:`research-live-${index+1}`,
      status:'blocked',
      httpStatus:response.status,
      code:typeof body.code==='string'?body.code:'UNKNOWN',
      failure:failure?{stage:failure.stage??null,code:failure.code??null}:null,
      fallback:fallback?{stage:fallback.stage??null,code:fallback.code??null}:null,
      latencyMs:elapsedMs,
      costUsd:0,
    });
  }

  process.stdout.write(JSON.stringify({
    evaluation:'GENERAL_AGENT_RESEARCH_LIVE_V1',
    candidateSha,
    attempted:tasks.length,
    solved,
    solveRate:solved/tasks.length,
    zeroCostSafe:true,
    paidFallbackUsed:false,
    providerRequests:0,
    results,
    limitation:'Public-web internal live research measurement; not final sealed or external comparative qualification.',
  })+'\n');
}

main().catch((error:unknown)=>{
  process.stderr.write((error instanceof Error?error.message:'RESEARCH_LIVE_EVALUATION_FAILED')+'\n');
  process.exitCode=1;
});
