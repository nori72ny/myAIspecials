import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import http from 'node:http';
import path from 'node:path';

import express from 'express';
import { chromium, type Browser } from 'playwright';

import { createWorldClassImageV16Router } from '../src/creative/worldClassImageV16Router.js';
import { readRasterDimensionsV15 } from '../src/creative/rasterImageCriticV15.js';
import { scoreRasterPixelsV15 } from '../src/creative/rasterTechnicalCriticV15.js';
import {
  evaluateOriginImageBlindBenchmarkV15,
  IMAGE_RUBRIC_AXES_V15,
  type ImageBenchmarkCaseV15,
  type ImageBenchmarkOutputV15,
  type ImageFamilyV15,
  type ImageJudgeScoreV15,
  type ImageRubricScoresV15,
  type ImageTechnicalEvidenceV15,
  type OriginImageBlindBenchmarkInputV15,
} from '../src/release/OriginImageBlindBenchmarkV15.js';

type Task = {
  caseId: string;
  family: ImageFamilyV15;
  challengeTags: readonly (
    'text'|'hands-anatomy'|'material-realism'|'complex-lighting'|'counting-layout'|'small-size-readability'|'style-fidelity'|'information-density'
  )[];
  prompt: string;
  width: number;
  height: number;
  requiresText: boolean;
};

type Generated = {
  systemId: string;
  role: 'origin'|'reference';
  bytes: Buffer | null;
  mime: string | null;
  durationMs: number;
  costUsd: number;
  failureCode: string | null;
  technical: ImageTechnicalEvidenceV15;
  modelId: string;
};

type JudgeParsed = {
  firstChoiceBlindKey: string;
  scores: Record<string, ImageRubricScoresV15>;
  safetyPassedByKey?: Record<string, boolean>;
  failureNotesByKey?: Record<string, string[]>;
};

const OPENROUTER_IMAGES_URL = 'https://openrouter.ai/api/v1/images';
const OPENROUTER_IMAGE_MODELS_URL = 'https://openrouter.ai/api/v1/images/models';
const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models';
const OPENROUTER_CHAT_URL = 'https://openrouter.ai/api/v1/chat/completions';
const MAX_TOTAL_USD = Number(process.env.ORIGIN_IMAGE_COMPARISON_MAX_TOTAL_USD ?? '6');
const MAX_IMAGE_USD = Number(process.env.ORIGIN_IMAGE_COMPARISON_MAX_IMAGE_USD ?? '0.25');
const SOFT_STOP_USD = Math.max(0, MAX_TOTAL_USD - MAX_IMAGE_USD);
const ORIGIN_SYSTEM = 'origin-world-class-v16';
const REFERENCES = [
  'openai/gpt-image-2.5-sunburst',
  'microsoft/mai-image-2.6',
  'x-ai/grok-imagine-image-2.0',
] as const;
const FULL_SHA = /^[0-9a-f]{40}$/i;

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(\`IMAGE_RUNTIME_COMPARISON_REQUIRED_ENV_MISSING:\${name}\`);
  return value;
}
function sha256(value: Buffer|string): string {
  return createHash('sha256').update(value).digest('hex');
}
function technicalFalse(): ImageTechnicalEvidenceV15 {
  return {
    signatureValid:false,
    dimensionsValid:false,
    structuralCriticPassed:false,
    technicalCriticPassed:false,
    safetyPassed:false,
    deliveryIntegrityPassed:false,
  };
}
function ratio(width:number,height:number): string {
  const ratios = [['1:1',1],['3:2',1.5],['2:3',2/3],['4:3',4/3],['3:4',3/4],['16:9',16/9],['9:16',9/16]] as const;
  const target=width/height;
  return [...ratios].sort((a,b)=>Math.abs(a[1]-target)-Math.abs(b[1]-target))[0][0];
}
function mimeType(bytes:Buffer): 'image/png'|'image/jpeg'|'image/webp'|null {
  if(bytes.length>=8 && bytes.subarray(0,8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]))) return 'image/png';
  if(bytes.length>=4 && bytes[0]===0xff && bytes[1]===0xd8) return 'image/jpeg';
  if(bytes.length>=12 && bytes.subarray(0,4).toString('ascii')==='RIFF' && bytes.subarray(8,12).toString('ascii')==='WEBP') return 'image/webp';
  return null;
}
async function api(url:string,key:string,init:RequestInit={},timeout=120000):Promise<Response>{
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),timeout);
  try{
    return await fetch(url,{
      ...init,
      signal:controller.signal,
      redirect:'error',
      cache:'no-store',
      headers:{
        Authorization:\`Bearer \${key}\`,
        Accept:'application/json',
        'Content-Type':'application/json',
        'HTTP-Referer':'https://origin-personal.vercel.app',
        'X-Title':'ORIGIN Personal Image Runtime Comparison',
        ...(init.headers??{}),
      },
    });
  } finally { clearTimeout(timer); }
}
async function pixelCritic(browser:Browser,bytes:Buffer,mime:string){
  const page=await browser.newPage();
  try{
    const dataUrl=\`data:\${mime};base64,\${bytes.toString('base64')}\`;
    const decoded=await page.evaluate(async ({dataUrl})=>{
      const image=new Image();
      image.decoding='async';
      const loaded=new Promise<void>((resolve,reject)=>{image.onload=()=>resolve();image.onerror=()=>reject(new Error('decode'));});
      image.src=dataUrl; await loaded;
      const nw=image.naturalWidth||image.width, nh=image.naturalHeight||image.height;
      const longest=Math.max(nw,nh), scale=Math.min(1,96/longest);
      const width=Math.max(2,Math.round(nw*scale)), height=Math.max(2,Math.round(nh*scale));
      const canvas=document.createElement('canvas'); canvas.width=width; canvas.height=height;
      const ctx=canvas.getContext('2d',{willReadFrequently:true}); if(!ctx) throw new Error('canvas');
      ctx.drawImage(image,0,0,width,height);
      return {width,height,pixels:Array.from(ctx.getImageData(0,0,width,height).data)};
    },{dataUrl});
    return scoreRasterPixelsV15(Uint8ClampedArray.from(decoded.pixels),decoded.width,decoded.height).passed;
  } finally { await page.close(); }
}

function tasks():Task[] {
  return [
    {caseId:'photo-01',family:'photograph-scene',challengeTags:['complex-lighting','material-realism'],width:1536,height:1024,requiresText:false,prompt:'雨上がりの東京・銀座の夜。濡れた路面にネオンが反射し、黒いタクシーが交差点を曲がる瞬間を35mm実写写真として表現。人物は自然な歩行姿勢、映画的だが現実的な光。文字・ロゴなし。'},
    {caseId:'photo-02',family:'photograph-scene',challengeTags:['complex-lighting','information-density'],width:1024,height:1536,requiresText:false,prompt:'早朝の築地場外市場。湯気の立つ屋台、魚箱、働く人々を縦構図のドキュメンタリー写真として自然に撮影したように。細部は豊富だが主役が分かる構図。文字・透かしなし。'},
    {caseId:'photo-03',family:'photograph-scene',challengeTags:['material-realism','counting-layout'],width:1536,height:1024,requiresText:false,prompt:'白い大理石のテーブルに透明なワイングラスを正確に3脚、銀のカトラリーを左右対称に配置した高級レストランの実写広告写真。ガラス、金属、大理石の質感を正確に。文字なし。'},

    {caseId:'portrait-01',family:'portrait-anatomy',challengeTags:['hands-anatomy','complex-lighting'],width:1024,height:1536,requiresText:false,prompt:'自然光の窓辺で微笑む30代の日本人女性。両手で白い陶器のマグカップを自然に持つフォトリアルな縦ポートレート。指は各手5本、手首と関節が自然、肌は過度に滑らかにしない。'},
    {caseId:'portrait-02',family:'portrait-anatomy',challengeTags:['hands-anatomy','material-realism'],width:1024,height:1536,requiresText:false,prompt:'黒いスーツを着た日本人男性バリスタが、右手で金属のミルクピッチャー、左手で白いカップを持ちラテアートを注ぐ瞬間。手指、取っ手、液体の流れを破綻なく実写で。'},
    {caseId:'portrait-03',family:'portrait-anatomy',challengeTags:['hands-anatomy','counting-layout'],width:1536,height:1024,requiresText:false,prompt:'4人の友人がテーブルを囲んで乾杯する自然な実写写真。人物は正確に4人、それぞれ片手にグラスを1つ。顔の重複、余分な腕や指を出さず、自然な笑顔と視線。'},

    {caseId:'product-01',family:'product-commercial',challengeTags:['material-realism','complex-lighting'],width:1024,height:1024,requiresText:false,prompt:'透明な香水ボトル1本を黒い鏡面台に置いたラグジュアリー商品広告。液体、厚いガラス、金属キャップ、反射、影を物理的に自然に。ブランド名や文字は入れない。'},
    {caseId:'product-02',family:'product-commercial',challengeTags:['material-realism','counting-layout'],width:1536,height:1024,requiresText:false,prompt:'白背景に3種類の高級和菓子を正確に3個、左から桜色・抹茶色・白の順に一直線で配置。柔らかなスタジオ光、食品として食欲をそそる質感。文字なし。'},
    {caseId:'product-03',family:'product-commercial',challengeTags:['material-realism','small-size-readability'],width:1024,height:1024,requiresText:true,prompt:'ミニマルなスキンケア商品広告。白いポンプボトル中央、ラベルには「LUMINA」と「SERUM 30mL」の2行だけを正確に表示。文字は読める大きさ、他の文字は追加しない。'},

    {caseId:'ad-01',family:'advertisement-social',challengeTags:['text','small-size-readability'],width:1080,height:1350,requiresText:true,prompt:'美容サロンのInstagram広告。清潔感のある女性モデル写真と余白を使い、見出し「初回限定 50%OFF」、価格「¥4,980」を正確に大きく表示。日本語と記号を変えない。高級感、押し売り感なし。'},
    {caseId:'ad-02',family:'advertisement-social',challengeTags:['text','information-density'],width:1080,height:1350,requiresText:true,prompt:'飲食店向け予約管理サービスのSNS広告。スマホ予約画面を主役にして、見出し「予約管理をもっとシンプルに」、補足「1名100円」を正確に表示。情報量はあるが見やすく、余計な文字を入れない。'},
    {caseId:'ad-03',family:'advertisement-social',challengeTags:['text','counting-layout'],width:1080,height:1350,requiresText:true,prompt:'フィットネス体験キャンペーン広告。人物1名、メリットを3つのカードで表示し、カード文言は「手ぶらOK」「30分体験」「駅徒歩3分」。カードは正確に3枚、文字を変えない。'},

    {caseId:'poster-01',family:'poster-key-visual',challengeTags:['text','complex-lighting'],width:1024,height:1536,requiresText:true,prompt:'東京の夜景を背景にした音楽イベントの縦ポスター。タイトル「TOKYO NIGHT 2026」、日付「10.25」、会場「SHIBUYA」を正確に表示。ネオン照明だが文字は高い可読性。'},
    {caseId:'poster-02',family:'poster-key-visual',challengeTags:['style-fidelity','small-size-readability'],width:1024,height:1536,requiresText:true,prompt:'和紙と墨の質感を活かした現代的な日本茶イベントポスター。大見出し「茶と光」、小見出し「秋の一服」を正確に配置。余白を大きく取り、静かな美術館品質。'},
    {caseId:'poster-03',family:'poster-key-visual',challengeTags:['text','material-realism'],width:1024,height:1536,requiresText:true,prompt:'高級腕時計の新作発表ポスター。黒背景に金属時計を大きく置き、文字は「THE NEW STANDARD」と「2026.11.08」のみ。時計の金属・ガラス反射を精密に、文字を正確に。'},

    {caseId:'thumb-01',family:'thumbnail',challengeTags:['text','small-size-readability'],width:1536,height:1024,requiresText:true,prompt:'YouTubeサムネイル。AIマーケティング解説動画で、人物の驚いた表情とグラフを使い、文字「3分でわかる AI広告」を正確に大きく表示。小さくしても読める。余計な文字なし。'},
    {caseId:'thumb-02',family:'thumbnail',challengeTags:['text','counting-layout'],width:1536,height:1024,requiresText:true,prompt:'料理動画のサムネイル。湯気の立つラーメンを中央、左に「東京」、右に「BEST 5」を正確に配置。「5」が明確に読める。要素を詰め込みすぎない。'},
    {caseId:'thumb-03',family:'thumbnail',challengeTags:['small-size-readability','information-density'],width:1536,height:1024,requiresText:true,prompt:'ビジネス解説動画のサムネイル。スマホ、上向きグラフ、人物を整理して配置し、見出し「売上2倍の仕組み」を正確に表示。強いコントラストだが安っぽくしない。'},

    {caseId:'illust-01',family:'illustration-style',challengeTags:['style-fidelity','complex-lighting'],width:1536,height:1024,requiresText:false,prompt:'手描きセルアニメ調。夕暮れの海辺を自転車で走る高校生2人、風で制服と髪がなびく。背景は絵の具で描いたような空と海。線、影、背景のタッチを一貫させる。文字なし。'},
    {caseId:'illust-02',family:'illustration-style',challengeTags:['style-fidelity','material-realism'],width:1024,height:1024,requiresText:false,prompt:'高級絵本向けの水彩イラスト。木製テーブルに赤いリンゴ、青い陶器、透明な花瓶。水彩紙のにじみと透明感を統一し、物体の材質差も分かるように。文字なし。'},
    {caseId:'illust-03',family:'illustration-style',challengeTags:['style-fidelity','hands-anatomy'],width:1024,height:1536,requiresText:false,prompt:'洗練されたファッションイラスト。女性デザイナーが左手でスケッチブック、右手で鉛筆を持つ。長い手足のスタイル表現だが、手指とポーズは自然。限定色のインク画調。'},

    {caseId:'info-01',family:'infographic-ui',challengeTags:['text','information-density'],width:1536,height:1024,requiresText:true,prompt:'SaaSダッシュボード風のインフォグラフィック。3ステップ「予約 → 来店 → 再来店」を横方向に正確に表示し、各ステップにシンプルなアイコン。情報は整理され、文字が読める。'},
    {caseId:'info-02',family:'infographic-ui',challengeTags:['counting-layout','information-density'],width:1536,height:1024,requiresText:true,prompt:'マーケティングファネルの説明図。左から「認知」「興味」「予約」「来店」の4段階を正確に4列で表示。各列に1つのアイコンと短いラベルのみ。整列と余白を重視。'},
    {caseId:'info-03',family:'infographic-ui',challengeTags:['text','small-size-readability'],width:1024,height:1536,requiresText:true,prompt:'スマホ向け料金比較UI。縦に3プランを表示し、プラン名「Basic」「Pro」「Premium」、価格「¥980」「¥2,980」「¥5,980」を正確に対応させる。文字は小画面でも読みやすく、余計な価格を追加しない。'},
  ];
}

function buildPromptSha(task:Task):string { return sha256(task.prompt.normalize('NFKC').trim()); }

async function modelCatalog(key:string){
  const r=await api(OPENROUTER_IMAGE_MODELS_URL,key,{},30000);
  if(!r.ok) throw new Error(\`IMAGE_MODELS_HTTP_\${r.status}\`);
  const j=await r.json() as {data?:Record<string,unknown>[]};
  return Array.isArray(j.data)?j.data:[];
}
function supportedParams(row:Record<string,unknown>):Record<string,unknown>{
  return row.supported_parameters && typeof row.supported_parameters==='object' && !Array.isArray(row.supported_parameters)
    ? row.supported_parameters as Record<string,unknown> : {};
}
async function directGenerate(
  key:string,
  browser:Browser,
  model:string,
  task:Task,
  catalog:Record<string,unknown>[],
):Promise<Generated>{
  const started=Date.now();
  const row=catalog.find(x=>x.id===model);
  if(!row) return {systemId:model,role:'reference',bytes:null,mime:null,durationMs:0,costUsd:0,failureCode:'MODEL_UNAVAILABLE',technical:technicalFalse(),modelId:model};
  const params=supportedParams(row);
  const payload:Record<string,unknown>={model,prompt:task.prompt,n:1};
  if('resolution' in params) payload.resolution='1K';
  if('aspect_ratio' in params) payload.aspect_ratio=ratio(task.width,task.height);
  if('quality' in params) payload.quality='high';
  if('output_format' in params) payload.output_format='png';
  try{
    const r=await api(OPENROUTER_IMAGES_URL,key,{method:'POST',body:JSON.stringify(payload)},180000);
    if(!r.ok) return {systemId:model,role:'reference',bytes:null,mime:null,durationMs:Date.now()-started,costUsd:0,failureCode:\`IMAGE_HTTP_\${r.status}\`,technical:technicalFalse(),modelId:model};
    const j=await r.json() as Record<string,unknown>;
    const data=Array.isArray(j.data)?j.data as Record<string,unknown>[]:[];
    const b64=typeof data[0]?.b64_json==='string'?String(data[0].b64_json):'';
    const cost=Number((j.usage as Record<string,unknown>|undefined)?.cost ?? (j.usage as Record<string,unknown>|undefined)?.cost_usd ?? NaN);
    if(!b64 || !Number.isFinite(cost) || cost<0 || cost>MAX_IMAGE_USD){
      return {systemId:model,role:'reference',bytes:null,mime:null,durationMs:Date.now()-started,costUsd:Number.isFinite(cost)?cost:0,failureCode:'IMAGE_RESPONSE_INVALID_OR_COST_CAP',technical:technicalFalse(),modelId:model};
    }
    const bytes=Buffer.from(b64,'base64');
    const mime=mimeType(bytes);
    const dims=mime?readRasterDimensionsV15(bytes,mime):null;
    const structural=Boolean(mime&&dims&&dims.width>=512&&dims.height>=512&&bytes.length>=1024);
    let pixel=false;
    try{pixel=Boolean(mime&&await pixelCritic(browser,bytes,mime));}catch{}
    return {
      systemId:model,role:'reference',bytes,mime,durationMs:Date.now()-started,costUsd:cost,failureCode:structural&&pixel?null:'REFERENCE_TECHNICAL_FAILED',
      technical:{signatureValid:Boolean(mime&&dims),dimensionsValid:Boolean(dims&&dims.width>=512&&dims.height>=512),structuralCriticPassed:structural,technicalCriticPassed:pixel,safetyPassed:true,deliveryIntegrityPassed:true},
      modelId:model,
    };
  } catch {
    return {systemId:model,role:'reference',bytes:null,mime:null,durationMs:Date.now()-started,costUsd:0,failureCode:'IMAGE_FETCH_FAILED',technical:technicalFalse(),modelId:model};
  }
}

async function originGenerate(baseUrl:string,browser:Browser,task:Task,candidateSha:string):Promise<Generated>{
  const started=Date.now();
  try{
    const r=await fetch(\`\${baseUrl}/api/creative/v1.6/world-class/generate\`,{
      method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({prompt:task.prompt,width:task.width,height:task.height}),signal:AbortSignal.timeout(180000)
    });
    if(!r.ok) return {systemId:ORIGIN_SYSTEM,role:'origin',bytes:null,mime:null,durationMs:Date.now()-started,costUsd:0,failureCode:\`ORIGIN_HTTP_\${r.status}\`,technical:technicalFalse(),modelId:r.headers.get('x-origin-visual-model')??'unknown'};
    const bytes=Buffer.from(await r.arrayBuffer());
    const mime=(r.headers.get('content-type')??'').split(';')[0].trim();
    const mt=mime==='image/png'||mime==='image/jpeg'||mime==='image/webp'?mime:null;
    const dims=mt?readRasterDimensionsV15(bytes,mt):null;
    const structural=Boolean(mt&&dims&&dims.width>=512&&dims.height>=512&&bytes.length>=1024);
    let pixel=false; try{pixel=Boolean(mt&&await pixelCritic(browser,bytes,mt));}catch{}
    const cost=Number(r.headers.get('x-origin-cost-usd')??NaN);
    const delivery=Boolean(
      r.headers.get('x-origin-visual-verified')==='true' &&
      r.headers.get('x-origin-release-sha')===candidateSha &&
      r.headers.get('x-origin-world-class-evaluation')==='true' &&
      r.headers.get('x-origin-paid-fallback')==='false' &&
      Number.isFinite(cost) && cost>=0 && cost<=MAX_IMAGE_USD
    );
    return {
      systemId:ORIGIN_SYSTEM,role:'origin',bytes,mime:mt,durationMs:Date.now()-started,costUsd:Number.isFinite(cost)?cost:0,failureCode:structural&&pixel&&delivery?null:'ORIGIN_TECHNICAL_FAILED',
      technical:{signatureValid:Boolean(mt&&dims),dimensionsValid:Boolean(dims&&dims.width>=512&&dims.height>=512),structuralCriticPassed:structural,technicalCriticPassed:pixel,safetyPassed:true,deliveryIntegrityPassed:delivery},
      modelId:r.headers.get('x-origin-visual-model')??'unknown',
    };
  }catch{
    return {systemId:ORIGIN_SYSTEM,role:'origin',bytes:null,mime:null,durationMs:Date.now()-started,costUsd:0,failureCode:'ORIGIN_FETCH_FAILED',technical:technicalFalse(),modelId:'unknown'};
  }
}

function supportsImage(row:Record<string,unknown>):boolean{
  const arch=row.architecture && typeof row.architecture==='object'?row.architecture as Record<string,unknown>:{};
  const blob=JSON.stringify(arch).toLowerCase();
  return blob.includes('image');
}
function chooseJudges(rows:Record<string,unknown>[]):string[]{
  const available=rows.filter(supportsImage).map(r=>String(r.id??'')).filter(Boolean);
  const picks:string[]=[];
  const patterns=[
    /google\/gemini-.*flash/i,
    /openai\/gpt-5.*mini/i,
    /anthropic\/claude-.*haiku/i,
    /google\/gemini-/i,
    /openai\/gpt-/i,
    /anthropic\/claude-/i,
  ];
  const provider=(id:string)=>id.split('/')[0];
  for(const p of patterns){
    const hit=available.find(id=>p.test(id)&&!picks.some(x=>provider(x)===provider(id)));
    if(hit) picks.push(hit);
    if(picks.length===2) break;
  }
  if(picks.length<2) throw new Error('INDEPENDENT_VISION_JUDGES_UNAVAILABLE');
  return picks;
}
function parseJsonText(value:unknown):Record<string,unknown>{
  let text='';
  if(typeof value==='string') text=value;
  else if(Array.isArray(value)) text=value.map(x=>typeof x==='object'&&x&&'text' in x?String((x as Record<string,unknown>).text??''):'').join('\n');
  const first=text.indexOf('{'), last=text.lastIndexOf('}');
  if(first<0||last<=first) throw new Error('JUDGE_JSON_MISSING');
  return JSON.parse(text.slice(first,last+1)) as Record<string,unknown>;
}
function validScores(v:unknown,keys:string[]):v is Record<string,ImageRubricScoresV15>{
  if(!v||typeof v!=='object'||Array.isArray(v)) return false;
  const row=v as Record<string,unknown>;
  return keys.every(k=>{
    const s=row[k]; if(!s||typeof s!=='object'||Array.isArray(s)) return false;
    const r=s as Record<string,unknown>;
    return IMAGE_RUBRIC_AXES_V15.every(a=>Number.isFinite(Number(r[a]))&&Number(r[a])>=0&&Number(r[a])<=4);
  });
}
async function judgeCase(
  key:string,judgeId:string,task:Task,blind:{key:string;gen:Generated}[]
):Promise<{judge:ImageJudgeScoreV15|null;safety:Record<string,boolean>;notes:Record<string,string[]>;costUsd:number;failure:string|null}>{
  const content:Record<string,unknown>[]=[{
    type:'text',
    text:[
      'You are an independent blind image-quality judge.',
      'Evaluate four anonymous outputs for the exact user request below.',
      'Score each blind key on seven axes from 0 to 4, where 4 is excellent professional quality.',
      'Axes: promptAdherence, composition, subjectIntegrity, styleExecution, textHandling, artifactControl, professionalUsefulness.',
      'For images without requested text, textHandling means absence of accidental/garbled text and should still be scored.',
      'Also mark safetyPassedByKey true unless the output itself contains clearly unsafe/disallowed visual content.',
      'Do not infer system identity. Judge only pixels and request compliance.',
      'Return JSON only with: firstChoiceBlindKey, scores, safetyPassedByKey, failureNotesByKey.',
      \`USER REQUEST: \${task.prompt}\`,
    ].join('\n')
  }];
  for(const item of blind){
    if(!item.gen.bytes||!item.gen.mime) continue;
    content.push({type:'text',text:\`BLIND KEY \${item.key}\`});
    content.push({type:'image_url',image_url:{url:\`data:\${item.gen.mime};base64,\${item.gen.bytes.toString('base64')}\`}});
  }
  const started=Date.now();
  try{
    const r=await api(OPENROUTER_CHAT_URL,key,{method:'POST',body:JSON.stringify({
      model:judgeId,
      temperature:0,
      max_tokens:1600,
      messages:[{role:'user',content}],
    })},120000);
    if(!r.ok) return {judge:null,safety:{},notes:{},costUsd:0,failure:\`JUDGE_HTTP_\${r.status}\`};
    const j=await r.json() as Record<string,unknown>;
    const choices=Array.isArray(j.choices)?j.choices as Record<string,unknown>[]:[];
    const message=choices[0]?.message as Record<string,unknown>|undefined;
    const parsed=parseJsonText(message?.content);
    const keys=blind.map(x=>x.key);
    if(typeof parsed.firstChoiceBlindKey!=='string'||!keys.includes(parsed.firstChoiceBlindKey)||!validScores(parsed.scores,keys)){
      return {judge:null,safety:{},notes:{},costUsd:0,failure:'JUDGE_SCHEMA_INVALID'};
    }
    const scores=Object.fromEntries(keys.map(k=>[
      k,
      Object.fromEntries(IMAGE_RUBRIC_AXES_V15.map(a=>[a,Number((parsed.scores as Record<string,Record<string,unknown>>)[k][a])])) as ImageRubricScoresV15
    ]));
    const safetyRaw=parsed.safetyPassedByKey&&typeof parsed.safetyPassedByKey==='object'?parsed.safetyPassedByKey as Record<string,unknown>:{};
    const notesRaw=parsed.failureNotesByKey&&typeof parsed.failureNotesByKey==='object'?parsed.failureNotesByKey as Record<string,unknown>:{};
    const safety=Object.fromEntries(keys.map(k=>[k,safetyRaw[k]!==false]));
    const notes=Object.fromEntries(keys.map(k=>[k,Array.isArray(notesRaw[k])?(notesRaw[k] as unknown[]).map(String).slice(0,8):[]]));
    const usage=j.usage&&typeof j.usage==='object'?j.usage as Record<string,unknown>:{};
    const cost=Number(usage.cost??usage.cost_usd??0);
    return {
      judge:{judgeId,firstChoiceBlindKey:parsed.firstChoiceBlindKey,scores},
      safety,notes,costUsd:Number.isFinite(cost)&&cost>=0?cost:0,failure:null
    };
  }catch{
    return {judge:null,safety:{},notes:{},costUsd:0,failure:\`JUDGE_FAILED_\${Date.now()-started}\`};
  }
}

function blindOrder(caseIndex:number,generated:Generated[]){
  const keys=['A','B','C','D'];
  const offset=caseIndex%generated.length;
  return generated.map((gen,i)=>({key:keys[(i+offset)%keys.length],gen}));
}

async function main(){
  const key=required('OPENROUTER_API_KEY');
  const candidateSha=(process.env.ORIGIN_IMAGE_CANDIDATE_SHA??process.env.GITHUB_SHA??'').toLowerCase();
  if(!FULL_SHA.test(candidateSha)) throw new Error('IMAGE_RUNTIME_COMPARISON_CANDIDATE_SHA_INVALID');
  if(!Number.isFinite(MAX_TOTAL_USD)||MAX_TOTAL_USD<=0||MAX_TOTAL_USD>6.0) throw new Error('IMAGE_RUNTIME_COMPARISON_TOTAL_CAP_INVALID');
  if(!Number.isFinite(MAX_IMAGE_USD)||MAX_IMAGE_USD<=0||MAX_IMAGE_USD>0.25) throw new Error('IMAGE_RUNTIME_COMPARISON_IMAGE_CAP_INVALID');

  const outputRoot=path.resolve(process.env.ORIGIN_IMAGE_COMPARISON_OUTPUT_DIR??'test-results/image-runtime-comparison');
  const imageRoot=path.join(outputRoot,'images');
  await fs.mkdir(imageRoot,{recursive:true});

  const runtimeEnv:NodeJS.ProcessEnv={
    ...process.env,
    ORIGIN_IMAGE_WORLD_CLASS_ENABLED:'true',
    ORIGIN_IMAGE_WORLD_CLASS_EVAL:'true',
    ORIGIN_RELEASE_SHA:candidateSha,
    ORIGIN_IMAGE_WORLD_CLASS_MAX_COST_USD:String(MAX_IMAGE_USD),
    VERCEL_ENV:'preview',
    NODE_ENV:'test',
  };
  const app=express();
  app.use(express.json({limit:'64kb'}));
  app.use(createWorldClassImageV16Router(runtimeEnv));
  const server=http.createServer(app);
  await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',()=>resolve());});
  const address=server.address(); if(!address||typeof address==='string') throw new Error('LOCAL_ROUTER_BIND_FAILED');
  const baseUrl=\`http://127.0.0.1:\${address.port}\`;

  const catalog=await modelCatalog(key);
  for(const model of REFERENCES){
    if(!catalog.some(x=>x.id===model)) throw new Error(\`REFERENCE_MODEL_UNAVAILABLE:\${model}\`);
  }
  const allModelsResp=await api(OPENROUTER_MODELS_URL,key,{},30000);
  if(!allModelsResp.ok) throw new Error(\`JUDGE_MODELS_HTTP_\${allModelsResp.status}\`);
  const allModelsJson=await allModelsResp.json() as {data?:Record<string,unknown>[]};
  const judgeModels=chooseJudges(Array.isArray(allModelsJson.data)?allModelsJson.data:[]);

  const browser=await chromium.launch({headless:true});
  let totalCostUsd=0;
  const caseResults:ImageBenchmarkCaseV15[]=[];
  const detail:Record<string,unknown>[]=[];
  const failures:string[]=[];
  try{
    for(const [index,task] of tasks().entries()){
      if(totalCostUsd>=SOFT_STOP_USD){
        failures.push(\`TOTAL_COST_SOFT_STOP_BEFORE:\${task.caseId}\`);
        break;
      }
      const generated:Generated[]=[];
      const origin=await originGenerate(baseUrl,browser,task,candidateSha);
      generated.push(origin); totalCostUsd+=origin.costUsd;
      for(const model of REFERENCES){
        if(totalCostUsd>=SOFT_STOP_USD){ failures.push(\`TOTAL_COST_SOFT_STOP_DURING:\${task.caseId}\`); break; }
        const ref=await directGenerate(key,browser,model,task,catalog);
        generated.push(ref); totalCostUsd+=ref.costUsd;
      }
      if(generated.length!==4||generated.some(x=>!x.bytes)){
        failures.push(\`INCOMPLETE_GENERATION:\${task.caseId}\`);
        detail.push({caseId:task.caseId,family:task.family,generation:generated.map(x=>({systemId:x.systemId,modelId:x.modelId,costUsd:x.costUsd,failureCode:x.failureCode}))});
        continue;
      }

      const blind=blindOrder(index,generated);
      for(const item of blind){
        const ext=item.gen.mime==='image/png'?'png':item.gen.mime==='image/webp'?'webp':'jpg';
        await fs.writeFile(path.join(imageRoot,\`\${task.caseId}-\${item.key}.\${ext}\`),item.gen.bytes!,{mode:0o600});
      }

      const judges:ImageJudgeScoreV15[]=[];
      const safetyVotes:Record<string,boolean[]> = Object.fromEntries(blind.map(x=>[x.key,[]]));
      const noteMap:Record<string,string[]> = Object.fromEntries(blind.map(x=>[x.key,[]]));
      const judgeDetails:Record<string,unknown>[]=[];
      for(const judgeModel of judgeModels){
        const jr=await judgeCase(key,judgeModel,task,blind);
        totalCostUsd+=jr.costUsd;
        judgeDetails.push({judgeModel,costUsd:jr.costUsd,failure:jr.failure});
        if(jr.judge){
          judges.push(jr.judge);
          for(const item of blind){
            safetyVotes[item.key].push(jr.safety[item.key]!==false);
            noteMap[item.key].push(...(jr.notes[item.key]??[]));
          }
        }else failures.push(\`JUDGE_FAILURE:\${task.caseId}:\${judgeModel}:\${jr.failure}\`);
      }

      const outputs:ImageBenchmarkOutputV15[]=blind.map(item=>{
        const safe=(safetyVotes[item.key].length===judgeModels.length)&&safetyVotes[item.key].every(Boolean);
        const tech={...item.gen.technical,safetyPassed:safe};
        return {
          blindKey:item.key,
          systemId:item.gen.systemId,
          role:item.gen.role,
          executionStatus:item.gen.failureCode?'failed':'completed',
          durationMs:item.gen.durationMs,
          imageSha256:item.gen.bytes?sha256(item.gen.bytes):sha256(Buffer.alloc(0)),
          technical:tech,
        };
      });
      const promptSha=buildPromptSha(task);
      caseResults.push({
        caseId:task.caseId,
        family:task.family,
        challengeTags:task.challengeTags,
        promptSha256:promptSha,
        width:Math.min(task.width,1536),
        height:Math.min(task.height,1536),
        requiresText:task.requiresText,
        outputs,
        judges,
      });
      detail.push({
        caseId:task.caseId,
        family:task.family,
        challengeTags:task.challengeTags,
        promptSha256:promptSha,
        generated:blind.map(x=>({blindKey:x.key,systemId:x.gen.systemId,modelId:x.gen.modelId,costUsd:x.gen.costUsd,durationMs:x.gen.durationMs,failureCode:x.gen.failureCode,notes:noteMap[x.key]})),
        judges:judgeDetails,
      });
      if(totalCostUsd>MAX_TOTAL_USD){
        failures.push('TOTAL_COST_CAP_EXCEEDED');
        break;
      }
    }
  } finally {
    await browser.close();
    await new Promise<void>(resolve=>server.close(()=>resolve()));
  }

  const corpusSha=sha256(JSON.stringify(tasks().map(t=>({caseId:t.caseId,prompt:t.prompt,width:t.width,height:t.height}))));
  const createdAt=new Date();
  const input:OriginImageBlindBenchmarkInputV15={
    schema:'origin.image-blind-benchmark.v2',
    candidateSha,
    evaluatorSha:candidateSha,
    corpusSha256:corpusSha,
    originSystemId:ORIGIN_SYSTEM,
    referenceSystemIds:[...REFERENCES],
    executionBudgetMs:300000,
    roundId:\`runtime-24-\${candidateSha.slice(0,12)}\`,
    createdAt:createdAt.toISOString(),
    expiresAt:new Date(createdAt.getTime()+7*24*60*60*1000).toISOString(),
    cases:caseResults,
  };
  const report=evaluateOriginImageBlindBenchmarkV15(input);

  const familySummary=Object.fromEntries([
    'photograph-scene','portrait-anatomy','product-commercial','advertisement-social',
    'poster-key-visual','thumbnail','illustration-style','infographic-ui'
  ].map(family=>{
    const rows=detail.filter(x=>x.family===family);
    const cases=caseResults.filter(x=>x.family===family);
    let wins=0,ties=0,losses=0,originMeans:number[]=[],bestRefMeans:number[]=[];
    for(const c of cases){
      if(c.judges.length<2) continue;
      const origin=c.outputs.find(o=>o.role==='origin'); if(!origin) continue;
      const avg=(key:string)=>IMAGE_RUBRIC_AXES_V15.reduce((sum,a)=>sum+c.judges.reduce((s,j)=>s+j.scores[key][a],0)/c.judges.length,0)/IMAGE_RUBRIC_AXES_V15.length;
      const om=avg(origin.blindKey);
      const br=Math.max(...c.outputs.filter(o=>o.role==='reference').map(o=>avg(o.blindKey)));
      originMeans.push(om);bestRefMeans.push(br);
      if(om>=br+0.1) wins++; else if(om<=br-0.1) losses++; else ties++;
    }
    const cost=rows.reduce((sum,row)=>{
      const gens=Array.isArray(row.generated)?row.generated as Record<string,unknown>[]:[];
      const judges=Array.isArray(row.judges)?row.judges as Record<string,unknown>[]:[];
      return sum+gens.reduce((s,g)=>s+Number(g.costUsd??0),0)+judges.reduce((s,j)=>s+Number(j.costUsd??0),0);
    },0);
    return [family,{
      wins,ties,losses,
      originMean:originMeans.length?Math.round(originMeans.reduce((a,b)=>a+b,0)/originMeans.length*1000)/1000:null,
      bestReferenceMean:bestRefMeans.length?Math.round(bestRefMeans.reduce((a,b)=>a+b,0)/bestRefMeans.length*1000)/1000:null,
      costUsd:Math.round(cost*1e6)/1e6,
      failures:failures.filter(x=>rows.some(r=>x.includes(String(r.caseId??'')))),
    }];
  }));

  await fs.mkdir(outputRoot,{recursive:true});
  await fs.writeFile(path.join(outputRoot,'benchmark-input.json'),JSON.stringify(input,null,2)+'\n');
  await fs.writeFile(path.join(outputRoot,'benchmark-report.json'),JSON.stringify(report,null,2)+'\n');
  await fs.writeFile(path.join(outputRoot,'case-details.json'),JSON.stringify(detail,null,2)+'\n');
  await fs.writeFile(path.join(outputRoot,'summary.json'),JSON.stringify({
    schemaVersion:'origin.image-runtime-comparison.v1',
    candidateSha,
    caseTarget:24,
    casesMeasured:caseResults.length,
    judges:judgeModels,
    references:[...REFERENCES],
    totalCostUsd:Math.round(totalCostUsd*1e6)/1e6,
    maxTotalCostUsd:MAX_TOTAL_USD,
    failures,
    familySummary,
    benchmark:report,
  },null,2)+'\n');

  process.stdout.write(JSON.stringify({
    event:'image-runtime-comparison-completed',
    candidateSha,
    casesMeasured:caseResults.length,
    totalCostUsd:Math.round(totalCostUsd*1e6)/1e6,
    passed:report.passed,
    wins:report.wins,ties:report.ties,losses:report.losses,
    overallMean:report.overallMean,
    blockerCount:report.blockers.length,
    failureCount:failures.length,
    judges:judgeModels,
  })+'\n');
}
main().catch(error=>{
  const message=error instanceof Error?error.message:'IMAGE_RUNTIME_COMPARISON_FAILED';
  process.stderr.write(message+'\n');
  process.exitCode=1;
});