import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';

import express from 'express';
import { chromium, type Browser } from 'playwright';

import { createRasterImageV15Router } from '../src/creative/rasterImageV15Router.js';
import { critiqueRasterStructureV15, readRasterDimensionsV15 } from '../src/creative/rasterImageCriticV15.js';
import { scoreRasterPixelsV15 } from '../src/creative/rasterTechnicalCriticV15.js';
import { critiqueCloudflareRasterSemanticV15 } from '../src/creative/cloudflareRasterSemanticCriticV15.js';
import type { ImageBenchmarkOutputV15, ImageTechnicalEvidenceV15 } from '../src/release/OriginImageBlindBenchmarkV15.js';
import {
  validateImagePrivateCorpusV1,
  type ImagePrivateTaskV1,
  type OriginImagePrivateCorpusV1,
} from '../src/release/OriginImagePrivateCorpusV1.js';

type CandidateCaseEvidence={
  caseId:string;
  family:ImagePrivateTaskV1['family'];
  challengeTags:ImagePrivateTaskV1['challengeTags'];
  promptSha256:string;
  width:number;
  height:number;
  requiresText:boolean;
  taskDigest:string;
  output:ImageBenchmarkOutputV15;
  failureCode:string|null;
  providerId:string|null;
  modelId:string|null;
  semantic:{
    passed:boolean;
    safetyPassed:boolean;
    safetyIssues:readonly string[];
    score:number;
    issues:readonly string[];
    model:string;
  }|null;
};

const EMPTY_SHA256=createHash('sha256').update(Buffer.alloc(0)).digest('hex');

function requiredEnv(name:string):string{
  const value=process.env[name]?.trim();
  if(!value) throw new Error(`IMAGE_PRIVATE_REQUIRED_ENV_MISSING:${name}`);
  return value;
}
function sha256(value:Buffer|string):string{
  return createHash('sha256').update(value).digest('hex');
}
function emptyTechnical():ImageTechnicalEvidenceV15{
  return {
    signatureValid:false,
    dimensionsValid:false,
    structuralCriticPassed:false,
    technicalCriticPassed:false,
    safetyPassed:false,
    deliveryIntegrityPassed:false,
  };
}
function safeCode(value:unknown,fallback:string):string{
  return typeof value==='string' && /^[A-Z][A-Z0-9_:.-]{0,180}$/.test(value)?value:fallback;
}
async function errorJson(response:Response):Promise<Record<string,unknown>|null>{
  try{
    const value=await response.json();
    return value && typeof value==='object' && !Array.isArray(value)?value as Record<string,unknown>:null;
  }catch{return null;}
}
function classifyFailure(status:number,code:string|null):ImageBenchmarkOutputV15['executionStatus']{
  if(status===429 || code==='CLOUDFLARE_FREE_ALLOCATION_EXHAUSTED') return 'quota-limited';
  if(status===409 || status===422 || status===403) return 'blocked';
  return 'failed';
}
function extension(mime:string):string{
  if(mime==='image/png') return 'png';
  if(mime==='image/webp') return 'webp';
  return 'jpg';
}

async function pixelCritic(browser:Browser,bytes:Buffer,mimeType:string){
  const page=await browser.newPage();
  try{
    const dataUrl=`data:${mimeType};base64,${bytes.toString('base64')}`;
    const decoded=await page.evaluate(async ({dataUrl})=>{
      const image=new Image();
      image.decoding='async';
      const loaded=new Promise<void>((resolve,reject)=>{
        image.onload=()=>resolve();
        image.onerror=()=>reject(new Error('IMAGE_PRIVATE_BROWSER_DECODE_FAILED'));
      });
      image.src=dataUrl;
      await loaded;
      const naturalWidth=image.naturalWidth||image.width;
      const naturalHeight=image.naturalHeight||image.height;
      if(!naturalWidth||!naturalHeight) throw new Error('IMAGE_PRIVATE_BROWSER_DIMENSIONS_INVALID');
      const longest=Math.max(naturalWidth,naturalHeight);
      const scale=Math.min(1,96/longest);
      const width=Math.max(2,Math.round(naturalWidth*scale));
      const height=Math.max(2,Math.round(naturalHeight*scale));
      const canvas=document.createElement('canvas');
      canvas.width=width;
      canvas.height=height;
      const context=canvas.getContext('2d',{willReadFrequently:true});
      if(!context) throw new Error('IMAGE_PRIVATE_BROWSER_CANVAS_UNAVAILABLE');
      context.drawImage(image,0,0,width,height);
      const data=context.getImageData(0,0,width,height).data;
      return {width,height,pixels:Array.from(data)};
    },{dataUrl});
    return scoreRasterPixelsV15(Uint8ClampedArray.from(decoded.pixels),decoded.width,decoded.height);
  }finally{
    await page.close();
  }
}

async function evaluateCase(
  baseUrl:string,
  browser:Browser,
  task:ImagePrivateTaskV1,
  budgetMs:number,
  outputDir:string,
):Promise<CandidateCaseEvidence>{
  const started=Date.now();
  let response:Response;
  try{
    response=await fetch(`${baseUrl}/api/creative/v1.5/raster/generate`,{
      method:'POST',
      headers:{'content-type':'application/json','accept':'image/png,image/jpeg,image/webp,application/json'},
      body:JSON.stringify({
        prompt:task.prompt,
        ...(task.negativePrompt?{negativePrompt:task.negativePrompt}:{}),
        width:task.width,
        height:task.height,
      }),
      signal:AbortSignal.timeout(Math.min(Math.max(budgetMs,10_000),120_000)),
    });
  }catch{
    return {
      caseId:task.caseId,family:task.family,challengeTags:task.challengeTags,promptSha256:task.promptSha256,
      width:task.width,height:task.height,requiresText:task.requiresText,taskDigest:task.taskDigest,
      output:{blindKey:'ORIGIN',systemId:'origin-raster-v15',role:'origin',executionStatus:'failed',durationMs:Date.now()-started,imageSha256:EMPTY_SHA256,technical:emptyTechnical()},
      failureCode:'IMAGE_PRIVATE_FETCH_FAILED',providerId:null,modelId:null,semantic:null,
    };
  }

  if(!response.ok){
    const body=await errorJson(response);
    const code=safeCode(body?.code,`IMAGE_PRIVATE_HTTP_${response.status}`);
    return {
      caseId:task.caseId,family:task.family,challengeTags:task.challengeTags,promptSha256:task.promptSha256,
      width:task.width,height:task.height,requiresText:task.requiresText,taskDigest:task.taskDigest,
      output:{blindKey:'ORIGIN',systemId:'origin-raster-v15',role:'origin',executionStatus:classifyFailure(response.status,code),durationMs:Date.now()-started,imageSha256:EMPTY_SHA256,technical:emptyTechnical()},
      failureCode:code,providerId:null,modelId:null,semantic:null,
    };
  }

  const bytes=Buffer.from(await response.arrayBuffer());
  const mime=(response.headers.get('content-type')??'').split(';')[0].trim().toLowerCase();
  const typedMime=mime==='image/png'||mime==='image/jpeg'||mime==='image/webp'?mime:null;
  const actualSha=sha256(bytes);
  const dimensions=typedMime?readRasterDimensionsV15(bytes,typedMime):null;
  const structural=typedMime
    ? critiqueRasterStructureV15(bytes,typedMime,task.width,task.height)
    : {passed:false};
  let technicalPassed=false;
  try{
    technicalPassed=typedMime ? (await pixelCritic(browser,bytes,typedMime)).passed : false;
  }catch{
    technicalPassed=false;
  }

  const providerId=response.headers.get('x-origin-visual-provider');
  const modelId=response.headers.get('x-origin-visual-model');
  const deliveryIntegrityPassed=Boolean(
    response.headers.get('x-origin-visual-verified')==='true'
    && response.headers.get('x-origin-visual-sha256')===actualSha
    && response.headers.get('x-origin-free-only')==='true'
    && response.headers.get('x-origin-cost-usd')==='0'
    && response.headers.get('x-origin-paid-fallback')==='false'
    && response.headers.get('x-origin-secret-delivery')==='server-only'
    && providerId==='cloudflare-workers-ai-free'
    && modelId
  );
  let semantic:CandidateCaseEvidence['semantic']=null;
  let semanticFailureCode:string|null=null;
  if(typedMime){
    try{
      const result=await critiqueCloudflareRasterSemanticV15({
        originalRequest:task.prompt,
        bytes,
        mimeType:typedMime,
      },process.env);
      semantic={
        passed:result.passed,
        safetyPassed:result.safetyPassed,
        safetyIssues:[...result.safetyIssues],
        score:result.score,
        issues:[...result.issues],
        model:result.model,
      };
    }catch(error){
      semanticFailureCode=safeCode(
        error instanceof Error?error.message:null,
        'IMAGE_PRIVATE_SEMANTIC_CRITIC_FAILED',
      );
    }
  }

  const technical:ImageTechnicalEvidenceV15={
    signatureValid:Boolean(typedMime&&dimensions),
    dimensionsValid:Boolean(dimensions&&dimensions.width===task.width&&dimensions.height===task.height),
    structuralCriticPassed:Boolean(structural.passed),
    technicalCriticPassed:technicalPassed,
    safetyPassed:semantic?.safetyPassed===true,
    deliveryIntegrityPassed,
  };

  await fs.writeFile(path.join(outputDir,`${task.caseId}.${extension(mime)}`),bytes,{mode:0o600});
  const passed=Object.values(technical).every(Boolean);
  return {
    caseId:task.caseId,family:task.family,challengeTags:task.challengeTags,promptSha256:task.promptSha256,
    width:task.width,height:task.height,requiresText:task.requiresText,taskDigest:task.taskDigest,
    output:{blindKey:'ORIGIN',systemId:'origin-raster-v15',role:'origin',executionStatus:'completed',durationMs:Date.now()-started,imageSha256:actualSha,technical},
    failureCode:passed?null:(semanticFailureCode??(semantic?.safetyPassed===false?'IMAGE_PRIVATE_OUTPUT_SAFETY_FAILED':'IMAGE_PRIVATE_TECHNICAL_VALIDATION_FAILED')),
    providerId,modelId,semantic,
  };
}

async function main():Promise<void>{
  const candidateSha=requiredEnv('ORIGIN_IMAGE_CANDIDATE_SHA').toLowerCase();
  const expectedCorpusId=requiredEnv('ORIGIN_IMAGE_CORPUS_ID');
  const encoded=requiredEnv('ORIGIN_IMAGE_PRIVATE_CORPUS_GZIP_B64');
  requiredEnv('CLOUDFLARE_ACCOUNT_ID');
  requiredEnv('CLOUDFLARE_API_TOKEN');
  const outputRoot=path.resolve(process.env.ORIGIN_IMAGE_OUTPUT_DIR??'test-results/image-private');
  const imagesDir=path.join(outputRoot,'candidate-images');

  if(!/^[a-f0-9]{40}$/.test(candidateSha)) throw new Error('IMAGE_PRIVATE_CANDIDATE_SHA_INVALID');
  if(encoded.length>4_000_000||!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) throw new Error('IMAGE_PRIVATE_CORPUS_ENCODING_INVALID');

  let raw:Buffer;
  let corpus:OriginImagePrivateCorpusV1;
  try{
    raw=gunzipSync(Buffer.from(encoded,'base64'),{maxOutputLength:4_000_000});
    corpus=JSON.parse(raw.toString('utf8')) as OriginImagePrivateCorpusV1;
  }catch{
    throw new Error('IMAGE_PRIVATE_CORPUS_PARSE_FAILED');
  }
  const blockers=[...validateImagePrivateCorpusV1(corpus)];
  if(corpus.corpusId!==expectedCorpusId) blockers.push('IMAGE_PRIVATE_CORPUS_ID_MISMATCH');
  if(corpus.candidateSha.toLowerCase()!==candidateSha) blockers.push('IMAGE_PRIVATE_CORPUS_SHA_MISMATCH');
  if(blockers.length) throw new Error('IMAGE_PRIVATE_CORPUS_VALIDATION_FAILED');

  const app=express();
  app.disable('x-powered-by');
  app.use(express.json({limit:'64kb'}));
  app.use(createRasterImageV15Router(process.env));
  const server=http.createServer(app);
  await new Promise<void>((resolve,reject)=>{
    server.once('error',reject);
    server.listen(0,'127.0.0.1',()=>resolve());
  });

  const browser=await chromium.launch({headless:true});
  const cases:CandidateCaseEvidence[]=[];
  const runBlockers:string[]=[];
  const corpusDigest=sha256(raw);
  try{
    const address=server.address();
    if(!address||typeof address==='string') throw new Error('IMAGE_PRIVATE_SERVER_BIND_FAILED');
    const baseUrl=`http://127.0.0.1:${address.port}`;
    const status=await fetch(`${baseUrl}/api/creative/v1.5/raster/status`,{signal:AbortSignal.timeout(30_000)});
    const statusBody=await errorJson(status);
    if(!status.ok||statusBody?.ready!==true||statusBody?.zeroCostVerified!==true||statusBody?.paymentMethodRequired!==false||statusBody?.paidFallbackEnabled!==false){
      throw new Error('IMAGE_PRIVATE_RASTER_NOT_QUALIFIED');
    }

    await fs.mkdir(imagesDir,{recursive:true});
    for(const task of corpus.tasks){
      const item=await evaluateCase(baseUrl,browser,task,corpus.executionBudgetMs,imagesDir);
      cases.push(item);
      if(item.output.durationMs>corpus.executionBudgetMs) runBlockers.push(`IMAGE_PRIVATE_EXECUTION_BUDGET_EXCEEDED:${item.caseId}`);
    }

    const identities=new Set(
      cases.filter((item)=>item.providerId&&item.modelId).map((item)=>`${item.providerId}::${item.modelId}`)
    );
    if(identities.size!==1) runBlockers.push('IMAGE_PRIVATE_PROVIDER_IDENTITY_DRIFT');

    await fs.mkdir(outputRoot,{recursive:true});
    await fs.writeFile(path.join(outputRoot,'public-tasks.json'),JSON.stringify({
      schemaVersion:'origin.image-private-public-tasks.v1',
      corpusId:corpus.corpusId,corpusDigest,candidateSha,executionBudgetMs:corpus.executionBudgetMs,
      tasks:corpus.tasks.map((task)=>({
        caseId:task.caseId,family:task.family,challengeTags:[...task.challengeTags],promptSha256:task.promptSha256,
        width:task.width,height:task.height,requiresText:task.requiresText,taskDigest:task.taskDigest,
      })),
    },null,2)+'\n',{encoding:'utf8',mode:0o600});

    await fs.writeFile(path.join(outputRoot,'candidate-evidence.json'),JSON.stringify({
      schemaVersion:'origin.image-private-candidate-evidence.v1',
      corpusId:corpus.corpusId,corpusDigest,candidateSha,evaluatorSha:candidateSha,
      originSystemId:'origin-raster-v15',executionBudgetMs:corpus.executionBudgetMs,
      providerIdentities:[...identities],
      cases,
      blockers:[...new Set(runBlockers)],
    },null,2)+'\n',{encoding:'utf8',mode:0o600});

    const completed=cases.filter((item)=>item.output.executionStatus==='completed').length;
    const technicallyPassed=cases.filter((item)=>item.output.executionStatus==='completed'&&Object.values(item.output.technical).every(Boolean)).length;
    await fs.writeFile(path.join(outputRoot,'candidate-summary.json'),JSON.stringify({
      schemaVersion:'origin.image-private-candidate-summary.v1',
      corpusId:corpus.corpusId,corpusDigest,candidateSha,attempted:cases.length,completed,technicallyPassed,
      providerIdentityCount:identities.size,blockers:[...new Set(runBlockers)],
      failures:cases.filter((item)=>item.failureCode).map((item)=>({caseId:item.caseId,failureCode:item.failureCode,status:item.output.executionStatus})),
    },null,2)+'\n',{encoding:'utf8',mode:0o600});

    process.stdout.write(JSON.stringify({
      event:'image-private-round-completed',corpusId:corpus.corpusId,corpusDigest,candidateSha,
      attempted:cases.length,completed,technicallyPassed,providerIdentityCount:identities.size,
      blockerCount:new Set(runBlockers).size,
    })+'\n');
  }finally{
    await browser.close();
    await new Promise<void>((resolve)=>server.close(()=>resolve()));
  }
}

main().catch((error:unknown)=>{
  const message=error instanceof Error?error.message:'';
  process.stderr.write((/^[A-Z0-9_:-]{3,200}$/.test(message)?message:'IMAGE_PRIVATE_RUN_FAILED')+'\n');
  process.exitCode=1;
});
