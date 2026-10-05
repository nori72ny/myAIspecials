import { createHash } from 'node:crypto';
import type {
  RasterImageRequestV15,
  RasterImageResultV15,
  RasterProviderStatusV15,
} from './rasterImageProviderV15.js';

const MODEL='@cf/black-forest-labs/flux-2-klein-4b';
const MAX_IMAGE_BYTES=12*1024*1024;
const MAX_REFERENCE_IMAGES=4;
const MAX_REFERENCE_DIMENSION_EXCLUSIVE=512;
const REQUEST_TIMEOUT_MS=45_000;

type GatewayConfig={url:string;secret:string;zeroCostVerified:boolean};

function config(env:NodeJS.ProcessEnv):GatewayConfig|null{
  const rawUrl=env.ORIGIN_RASTER_GATEWAY_URL?.trim()??'';
  const secret=env.ORIGIN_RASTER_GATEWAY_SECRET?.trim()??'';
  if(!rawUrl||secret.length<32||secret.length>4096)return null;
  let parsed:URL;
  try{parsed=new URL(rawUrl);}catch{return null;}
  if(parsed.protocol!=='https:'||parsed.username||parsed.password||parsed.search||parsed.hash)return null;
  if(parsed.pathname!=='/'&&parsed.pathname!=='')return null;
  return {
    url:parsed.origin,
    secret,
    zeroCostVerified:env.ORIGIN_RASTER_GATEWAY_ZERO_COST_VERIFIED?.trim().toLowerCase()==='true',
  };
}

export function cloudflareRasterGatewayConfiguredV15(env:NodeJS.ProcessEnv=process.env):boolean{
  const cfg=config(env);
  return Boolean(cfg?.zeroCostVerified);
}

async function timedFetch(url:string,init:RequestInit,fetchImpl:typeof fetch):Promise<Response>{
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),REQUEST_TIMEOUT_MS);
  try{return await fetchImpl(url,{...init,signal:controller.signal,redirect:'error',cache:'no-store'});}
  finally{clearTimeout(timer);}
}

async function readBoundedImageBody(response:Response):Promise<Buffer>{
  const declared=Number(response.headers.get('content-length')??'0');
  if(Number.isFinite(declared)&&declared>MAX_IMAGE_BYTES)throw new Error('CLOUDFLARE_IMAGE_SIZE_OUT_OF_BOUNDS');
  if(!response.body){
    const body=Buffer.from(await response.arrayBuffer());
    if(!body.length||body.length>MAX_IMAGE_BYTES)throw new Error('CLOUDFLARE_IMAGE_SIZE_OUT_OF_BOUNDS');
    return body;
  }
  const reader=response.body.getReader();
  const chunks:Buffer[]=[];
  let total=0;
  try{
    while(true){
      const next=await reader.read();
      if(next.done)break;
      const chunk=Buffer.from(next.value);
      total+=chunk.length;
      if(total>MAX_IMAGE_BYTES){
        await reader.cancel();
        throw new Error('CLOUDFLARE_IMAGE_SIZE_OUT_OF_BOUNDS');
      }
      chunks.push(chunk);
    }
  }finally{
    reader.releaseLock();
  }
  if(total<=0)throw new Error('CLOUDFLARE_IMAGE_SIZE_OUT_OF_BOUNDS');
  return Buffer.concat(chunks,total);
}

function validateReferenceImages(input:RasterImageRequestV15):void{
  const references=input.referenceImages??[];
  if(references.length>MAX_REFERENCE_IMAGES)throw new Error('CLOUDFLARE_REFERENCE_IMAGE_LIMIT_EXCEEDED');
  if(references.some(reference=>
    !Number.isInteger(reference.width)
    || !Number.isInteger(reference.height)
    || reference.width<=0
    || reference.height<=0
    || reference.width>=MAX_REFERENCE_DIMENSION_EXCLUSIVE
    || reference.height>=MAX_REFERENCE_DIMENSION_EXCLUSIVE
  ))throw new Error('CLOUDFLARE_REFERENCE_IMAGE_DIMENSIONS_UNSUPPORTED');
}

function imageMime(bytes:Buffer):RasterImageResultV15['mimeType']|null{
  if(bytes.length>=24&&bytes.subarray(0,8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a])))return'image/png';
  if(bytes.length>=4&&bytes[0]===0xff&&bytes[1]===0xd8&&bytes.at(-2)===0xff&&bytes.at(-1)===0xd9)return'image/jpeg';
  if(bytes.length>=12&&bytes.subarray(0,4).toString('ascii')==='RIFF'&&bytes.subarray(8,12).toString('ascii')==='WEBP')return'image/webp';
  return null;
}

function dimensions(bytes:Buffer,mime:RasterImageResultV15['mimeType']):{width:number;height:number}|null{
  if(mime==='image/png'&&bytes.length>=24){
    const width=bytes.readUInt32BE(16),height=bytes.readUInt32BE(20);
    return width>0&&height>0?{width,height}:null;
  }
  if(mime==='image/jpeg'){
    const sof=new Set([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf]);
    let offset=2;
    while(offset+8<bytes.length){
      if(bytes[offset]!==0xff){offset+=1;continue;}
      while(offset<bytes.length&&bytes[offset]===0xff)offset+=1;
      if(offset>=bytes.length)break;
      const marker=bytes[offset++];
      if(marker===0xd8||marker===0xd9||marker===0x01||(marker>=0xd0&&marker<=0xd7))continue;
      if(offset+2>bytes.length)break;
      const length=bytes.readUInt16BE(offset);
      if(length<2||offset+length>bytes.length)break;
      if(sof.has(marker)&&length>=7){
        const height=bytes.readUInt16BE(offset+3),width=bytes.readUInt16BE(offset+5);
        return width>0&&height>0?{width,height}:null;
      }
      offset+=length;
    }
  }
  if(mime==='image/webp'&&bytes.length>=30){
    const chunk=bytes.subarray(12,16).toString('ascii');
    if(chunk==='VP8X')return{width:1+bytes.readUIntLE(24,3),height:1+bytes.readUIntLE(27,3)};
  }
  return null;
}

export async function getCloudflareRasterGatewayStatusV15(
  env:NodeJS.ProcessEnv=process.env,
  fetchImpl:typeof fetch=fetch,
):Promise<RasterProviderStatusV15>{
  const cfg=config(env);
  if(!cfg)return{
    configured:false,ready:false,providerId:'cloudflare-workers-ai-gateway',
    model:null,zeroCostVerified:false,paidFallbackEnabled:false,paymentMethodRequired:false,
    secretDelivery:'server-only',externalNetwork:true,reason:'CLOUDFLARE_WORKERS_AI_GATEWAY_NOT_CONFIGURED',
  };
  if(!cfg.zeroCostVerified)return{
    configured:true,ready:false,providerId:'cloudflare-workers-ai-gateway',
    model:null,zeroCostVerified:false,paidFallbackEnabled:false,paymentMethodRequired:false,
    secretDelivery:'server-only',externalNetwork:true,reason:'CLOUDFLARE_WORKERS_AI_GATEWAY_ZERO_COST_UNVERIFIED',
  };
  try{
    const response=await timedFetch(`${cfg.url}/status`,{
      method:'GET',
      headers:{'x-origin-gateway-secret':cfg.secret,'accept':'application/json','user-agent':'ORIGIN-Personal/1.5'},
    },fetchImpl);
    if(!response.ok)return{
      configured:true,ready:false,providerId:'cloudflare-workers-ai-gateway',
      model:null,zeroCostVerified:false,paidFallbackEnabled:false,paymentMethodRequired:false,
      secretDelivery:'server-only',externalNetwork:true,reason:`CLOUDFLARE_WORKERS_AI_GATEWAY_HTTP_${response.status}`,
    };
    const body=await response.json().catch(()=>null) as Record<string,unknown>|null;
    const safe=body?.ok===true
      && body?.provider==='cloudflare-workers-ai-binding'
      && body?.model===MODEL
      && body?.aiBindingConfigured===true
      && body?.secretConfigured===true
      && body?.freeOnly===true
      && body?.paidFallbackEnabled===false;
    return{
      configured:true,ready:safe,providerId:'cloudflare-workers-ai-gateway',
      model:safe?MODEL:null,zeroCostVerified:safe,paidFallbackEnabled:false,paymentMethodRequired:false,
      secretDelivery:'server-only',externalNetwork:true,reason:safe?null:'CLOUDFLARE_WORKERS_AI_GATEWAY_STATUS_UNVERIFIED',
    };
  }catch{
    return{
      configured:true,ready:false,providerId:'cloudflare-workers-ai-gateway',
      model:null,zeroCostVerified:false,paidFallbackEnabled:false,paymentMethodRequired:false,
      secretDelivery:'server-only',externalNetwork:true,reason:'CLOUDFLARE_WORKERS_AI_GATEWAY_UNAVAILABLE',
    };
  }
}

export async function generateCloudflareRasterGatewayImageV15(
  input:RasterImageRequestV15,
  env:NodeJS.ProcessEnv=process.env,
  fetchImpl:typeof fetch=fetch,
):Promise<RasterImageResultV15>{
  const cfg=config(env);
  if(!cfg||!cfg.zeroCostVerified)throw new Error('CLOUDFLARE_WORKERS_AI_GATEWAY_NOT_READY');

  const prompt=input.prompt.normalize('NFKC').trim();
  if(!prompt||prompt.length>2048)throw new Error('INVALID_RASTER_PROMPT');
  validateReferenceImages(input);
  const width=input.width??1024,height=input.height??1024;

  const status=await getCloudflareRasterGatewayStatusV15(env,fetchImpl);
  if(!status.ready||!status.zeroCostVerified)throw new Error(status.reason??'CLOUDFLARE_WORKERS_AI_GATEWAY_NOT_READY');
  const form=new FormData();
  form.append('prompt',[
    input.referenceImages?.length
      ? 'Reference images are authoritative. Preserve unrequested identity, composition, and subject details.'
      : '',
    prompt,
    input.negativePrompt?.trim()? `Avoid these visual elements when possible: ${input.negativePrompt.trim().slice(0,1000)}`:'',
  ].filter(Boolean).join('\n'));
  form.append('width',String(width));
  form.append('height',String(height));
  (input.referenceImages??[]).forEach((reference,index)=>{
    form.append(
      `input_image_${index}`,
      new Blob([Uint8Array.from(reference.bytes)],{type:reference.mimeType}),
      `reference-${index}.${reference.mimeType==='image/png'?'png':reference.mimeType==='image/webp'?'webp':'jpg'}`,
    );
  });

  const response=await timedFetch(`${cfg.url}/${input.referenceImages?.length?'edit':'generate'}`,{
    method:'POST',
    headers:{'x-origin-gateway-secret':cfg.secret,'accept':'image/png, image/jpeg, image/webp'},
    body:form,
  },fetchImpl);
  if(!response.ok)throw new Error(`CLOUDFLARE_WORKERS_AI_GATEWAY_HTTP_${response.status}`);
  const raw=await readBoundedImageBody(response);
  const mimeType=imageMime(raw);
  if(!mimeType)throw new Error('CLOUDFLARE_IMAGE_SIGNATURE_MISMATCH');
  const actual=dimensions(raw,mimeType);
  if(!actual||actual.width!==width||actual.height!==height)throw new Error('RASTER_IMAGE_DIMENSION_MISMATCH');
  return{
    bytes:raw,mimeType,sha256:createHash('sha256').update(raw).digest('hex'),
    model:MODEL,providerId:'cloudflare-workers-ai-gateway',width:actual.width,height:actual.height,
    costUsd:0,freeOnly:true,externalNetworkRequests:2,
  };
}
