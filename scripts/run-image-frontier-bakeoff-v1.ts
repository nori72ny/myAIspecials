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
  ORIGIN_IMAGE_BLIND_BENCHMARK_SCHEMA,
  IMAGE_RUBRIC_AXES_V15,
  type ImageBenchmarkOutputV15,
  type ImageFamilyV15,
  type ImageChallengeTagV15,
  type ImageRubricScoresV15,
  type ImageTechnicalEvidenceV15,
  type OriginImageBlindBenchmarkInputV15,
} from '../src/release/OriginImageBlindBenchmarkV15.js';

type Task = {
  caseId: string;
  family: ImageFamilyV15;
  challengeTags: ImageChallengeTagV15[];
  prompt: string;
  width: number;
  height: number;
  requiresText: boolean;
};

type Generated = {
  systemId: string;
  role: 'origin' | 'reference';
  bytes: Buffer;
  mime: 'image/png' | 'image/jpeg' | 'image/webp';
  durationMs: number;
  imageSha256: string;
  technical: ImageTechnicalEvidenceV15;
  costUsd: number;
  modelId: string;
  providerId: string;
};

type JudgeResult = {
  judgeId: string;
  firstChoiceBlindKey: string;
  scores: Record<string, ImageRubricScoresV15>;
  criticalSafetyIssues: Record<string, boolean>;
  failureFactors: Record<string, string[]>;
  costUsd: number;
};

const IMAGE_URL = 'https://openrouter.ai/api/v1/images';
const CHAT_URL = 'https://openrouter.ai/api/v1/chat/completions';
const MAX_IMAGE_BYTES = 16 * 1024 * 1024;
const TOTAL_COST_CAP = Number(process.env.ORIGIN_BAKEOFF_MAX_TOTAL_COST_USD ?? '15');
const IMAGE_COST_CAP = Number(process.env.ORIGIN_BAKEOFF_MAX_IMAGE_COST_USD ?? '0.25');
const JUDGE_COST_CAP = Number(process.env.ORIGIN_BAKEOFF_MAX_JUDGE_COST_USD ?? '0.25');
const EXECUTION_BUDGET_MS = 180_000;

const ORIGIN_SYSTEM = 'origin-world-class-v16';
const REFERENCES = [
  { systemId: 'openai/gpt-image-2.5-flare', model: 'openai/gpt-image-2.5-flare', quality: 'high' },
  { systemId: 'x-ai/grok-imagine-image-2.0', model: 'x-ai/grok-imagine-image-2.0', quality: 'medium' },
  { systemId: 'google/gemini-3.1-flash-image', model: 'google/gemini-3.1-flash-image', quality: 'high' },
] as const;
const JUDGES = [
  'google/gemini-3.1-pro-preview',
  'anthropic/claude-opus-4.6',
] as const;

const TASKS: Task[] = [
  {
    caseId: 'photo-01', family: 'photograph-scene',
    challengeTags: ['complex-lighting','material-realism'],
    prompt: '雨上がりの東京・銀座の夜。濡れた石畳にネオンと車のライトが自然に反射し、傘を持つ数人の通行人が奥へ歩く。35mm実写写真、過度なHDRなし、自然な雨粒と反射。',
    width: 1024, height: 1024, requiresText: false,
  },
  {
    caseId: 'photo-02', family: 'photograph-scene',
    challengeTags: ['material-realism','complex-lighting'],
    prompt: '早朝の高級ホテルロビー。大理石、真鍮、ガラス、木材の質感がそれぞれ正しく見え、窓から柔らかな朝日。広角建築写真、直線を保ち、CGのような光沢は避ける。',
    width: 1024, height: 768, requiresText: false,
  },
  {
    caseId: 'photo-03', family: 'photograph-scene',
    challengeTags: ['complex-lighting','information-density'],
    prompt: '夕暮れの屋外フードマーケット。複数の屋台、客、湯気、電球、食器が自然に配置され、奥行きがあるドキュメンタリー写真。雑然としていても主題が読み取れる。',
    width: 1024, height: 768, requiresText: false,
  },
  {
    caseId: 'portrait-01', family: 'portrait-anatomy',
    challengeTags: ['hands-anatomy','material-realism'],
    prompt: '30代の日本人女性バリスタの自然なポートレート。両手で白い陶器のカップを持ち、指は各手5本で自然な握り方。肌、髪、エプロン、陶器の質感を実写らしく。',
    width: 768, height: 1024, requiresText: false,
  },
  {
    caseId: 'portrait-02', family: 'portrait-anatomy',
    challengeTags: ['hands-anatomy','complex-lighting'],
    prompt: '夕方の窓辺でギターを弾く男性。左手はフレットを押さえ、右手は弦を弾く自然な位置。指や腕の関節に破綻がなく、逆光でも顔のディテールを保つ実写。',
    width: 768, height: 1024, requiresText: false,
  },
  {
    caseId: 'portrait-03', family: 'portrait-anatomy',
    challengeTags: ['hands-anatomy','style-fidelity'],
    prompt: 'ファッション誌の表紙用ポートレート。黒いジャケットのモデルが片手を顎の近くに置く。手指・顔・耳・髪の形を自然に、スタジオ照明、上品でミニマル。',
    width: 768, height: 1024, requiresText: false,
  },
  {
    caseId: 'product-01', family: 'product-commercial',
    challengeTags: ['material-realism','text'],
    prompt: '透明ガラスの美容液ボトルの商品広告。ラベルの文字は正確に「LUMINA SERUM」「30 mL」。白背景、柔らかな影、透明ガラスと液体の屈折をリアルに。文字を追加しない。',
    width: 1024, height: 1024, requiresText: true,
  },
  {
    caseId: 'product-02', family: 'product-commercial',
    challengeTags: ['material-realism','counting-layout'],
    prompt: '木のテーブルに同じデザインのコーヒー豆パッケージをちょうど3袋並べる。左から赤・白・黒。各袋の大きさは同じ、重なりなし、スタジオ商品写真。',
    width: 1024, height: 768, requiresText: false,
  },
  {
    caseId: 'product-03', family: 'product-commercial',
    challengeTags: ['text','small-size-readability'],
    prompt: '高級チョコレート箱のEC広告。箱に正確に「NOIR 72%」と表示。下部に価格「¥2,480」。黒と金の上品なデザイン、スマホで縮小しても価格が読める。',
    width: 1024, height: 1024, requiresText: true,
  },
  {
    caseId: 'ad-01', family: 'advertisement-social',
    challengeTags: ['text','small-size-readability','information-density'],
    prompt: '美容サロンのInstagram縦型広告。見出し「初回限定 50%OFF」、価格「¥4,980」、CTA「WEB予約はこちら」を正確に表示。女性の自然な実写写真と余白を活かし、1080×1350向け。',
    width: 1080, height: 1350, requiresText: true,
  },
  {
    caseId: 'ad-02', family: 'advertisement-social',
    challengeTags: ['text','counting-layout','small-size-readability'],
    prompt: 'フィットネスジムのSNS広告。3つのメリットを明確に並べる：「24時間」「駅徒歩3分」「月額¥6,980」。数字と日本語を正確に、強い視線誘導、スマホで読みやすく。',
    width: 1080, height: 1350, requiresText: true,
  },
  {
    caseId: 'ad-03', family: 'advertisement-social',
    challengeTags: ['text','information-density','material-realism'],
    prompt: '寿司店のInstagram広告。料理写真を主役にし、文字は「本まぐろ祭」「10/10–10/20」「一貫 ¥380」の3要素だけを正確に表示。高級感、食材の質感、情報の優先順位を明確に。',
    width: 1080, height: 1350, requiresText: true,
  },
  {
    caseId: 'poster-01', family: 'poster-key-visual',
    challengeTags: ['text','style-fidelity'],
    prompt: '京都の秋の夜間拝観ポスター。正確な文字「秋の京都 夜間特別拝観」「11月15日–12月1日」。紅葉と寺院を和モダンなグラフィックで、上品な縦長ポスター。',
    width: 768, height: 1024, requiresText: true,
  },
  {
    caseId: 'poster-02', family: 'poster-key-visual',
    challengeTags: ['style-fidelity','small-size-readability'],
    prompt: 'ジャズライブのキービジュアル。1950年代のスイス・モダニズム風、幾何学と大胆な余白。文字は「BLUE NOTE NIGHT」「FRI 20:00」のみ、正確に読みやすく。',
    width: 768, height: 1024, requiresText: true,
  },
  {
    caseId: 'poster-03', family: 'poster-key-visual',
    challengeTags: ['text','complex-lighting','style-fidelity'],
    prompt: 'SF映画の劇場ポスター。巨大なリング状宇宙ステーションと小さな宇宙船、強い逆光。タイトルは正確に「ORBITAL DAWN」。映画的だが既存作品のコピーにはしない。',
    width: 768, height: 1024, requiresText: true,
  },
  {
    caseId: 'thumb-01', family: 'thumbnail',
    challengeTags: ['text','small-size-readability','information-density'],
    prompt: 'YouTubeサムネイル。東京の夜景と驚いた表情の旅行者。大きな文字「東京 48時間」、小さくても即読める。要素を詰め込みすぎず、16:9。',
    width: 1024, height: 576, requiresText: true,
  },
  {
    caseId: 'thumb-02', family: 'thumbnail',
    challengeTags: ['text','small-size-readability','counting-layout'],
    prompt: '料理動画のYouTubeサムネイル。完成したオムライスを大きく、3つのポイントを「ふわふわ」「10分」「失敗しない」と正確に表示。16:9、スマホで読める。',
    width: 1024, height: 576, requiresText: true,
  },
  {
    caseId: 'thumb-03', family: 'thumbnail',
    challengeTags: ['small-size-readability','hands-anatomy'],
    prompt: 'DIY動画のサムネイル。両手で小さな木製棚を持つ人物、手指の形を自然に。文字は「賃貸OK」のみ。16:9、主役が一目で分かる。',
    width: 1024, height: 576, requiresText: true,
  },
  {
    caseId: 'illust-01', family: 'illustration-style',
    challengeTags: ['style-fidelity','hands-anatomy'],
    prompt: '児童書の水彩イラスト。雨の日に黄色い傘を持つ子どもと犬。手指は自然、淡い水彩のにじみと紙の質感を統一し、背景も同じ画風。',
    width: 1024, height: 1024, requiresText: false,
  },
  {
    caseId: 'illust-02', family: 'illustration-style',
    challengeTags: ['style-fidelity','counting-layout'],
    prompt: 'レトロフューチャーな旅行ポスター風イラスト。空に飛行船をちょうど2機、地上にモノレールを1本。限定色のシルクスクリーン風で統一。',
    width: 768, height: 1024, requiresText: false,
  },
  {
    caseId: 'illust-03', family: 'illustration-style',
    challengeTags: ['style-fidelity','information-density'],
    prompt: 'アイソメトリックな未来都市イラスト。住宅、病院、学校、公園、駅を識別できるよう配置し、同じアイソメトリック角度と色設計を保つ。',
    width: 1024, height: 1024, requiresText: false,
  },
  {
    caseId: 'ui-01', family: 'infographic-ui',
    challengeTags: ['information-density','text','counting-layout'],
    prompt: '日本語の売上ダッシュボードUI。カードを4枚：「売上 ¥12.8M」「注文 3,240」「CVR 4.8%」「客単価 ¥3,950」。折れ線グラフと棒グラフ、文字と数値を正確に。',
    width: 1024, height: 768, requiresText: true,
  },
  {
    caseId: 'ui-02', family: 'infographic-ui',
    challengeTags: ['information-density','small-size-readability','text'],
    prompt: '健康アプリのスマホ画面。上から「今日の歩数 8,432」「睡眠 7h 24m」「心拍 68 bpm」。3つのカードと小さな週間チャート、読みやすい日本語UI。',
    width: 768, height: 1024, requiresText: true,
  },
  {
    caseId: 'ui-03', family: 'infographic-ui',
    challengeTags: ['information-density','counting-layout','text'],
    prompt: '「新規顧客が予約するまで」の5ステップのインフォグラフィック。1 認知、2 検索、3 比較、4 予約、5 来店。5段階を順番通り、矢印と短い日本語で明快に。',
    width: 1024, height: 768, requiresText: true,
  },
];

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(\`BAKEOFF_REQUIRED_ENV_MISSING:\${name}\`);
  return value;
}
function sha256(value: Buffer | string): string {
  return createHash('sha256').update(value).digest('hex');
}
function ratio(width: number, height: number): string {
  const allowed = ['1:1','3:2','2:3','4:3','3:4','16:9','9:16'] as const;
  const target = width / height;
  return allowed.reduce((best, item) => {
    const [a,b] = item.split(':').map(Number);
    const [ba,bb] = best.split(':').map(Number);
    return Math.abs(target - a/b) < Math.abs(target - ba/bb) ? item : best;
  }, '1:1' as typeof allowed[number]);
}
function mime(bytes: Buffer): Generated['mime'] | null {
  if (bytes.length >= 8 && bytes.subarray(0,8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]))) return 'image/png';
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) return 'image/jpeg';
  if (bytes.length >= 12 && bytes.subarray(0,4).toString('ascii') === 'RIFF' && bytes.subarray(8,12).toString('ascii') === 'WEBP') return 'image/webp';
  return null;
}
function parseJsonObject(text: string): Record<string, unknown> {
  const clean = text.trim().replace(/^\\\`\\\`\\\`(?:json)?/i,'').replace(/\\\`\\\`\\\`$/,'').trim();
  const start = clean.indexOf('{');
  const end = clean.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('BAKEOFF_JUDGE_JSON_MISSING');
  return JSON.parse(clean.slice(start,end+1)) as Record<string, unknown>;
}
async function openRouter(apiKey: string, url: string, payload: unknown, timeoutMs: number): Promise<Record<string, unknown>> {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: \`Bearer \${apiKey}\`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'HTTP-Referer': 'https://origin-personal.vercel.app',
      'X-Title': 'ORIGIN image frontier bakeoff',
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const json = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!response.ok || !json) throw new Error(\`BAKEOFF_OPENROUTER_HTTP_\${response.status}\`);
  return json;
}
function usageCost(result: Record<string, unknown>): number {
  const usage = result.usage && typeof result.usage === 'object' && !Array.isArray(result.usage)
    ? result.usage as Record<string, unknown> : {};
  const cost = Number(usage.cost ?? usage.cost_usd ?? NaN);
  if (!Number.isFinite(cost) || cost < 0) throw new Error('BAKEOFF_COST_UNVERIFIED');
  return cost;
}
async function pixelCritic(browser: Browser, bytes: Buffer, mimeType: string): Promise<boolean> {
  const page = await browser.newPage();
  try {
    const dataUrl = \`data:\${mimeType};base64,\${bytes.toString('base64')}\`;
    const decoded = await page.evaluate(async ({ dataUrl }) => {
      const image = new Image();
      image.decoding = 'async';
      await new Promise<void>((resolve,reject) => {
        image.onload = () => resolve();
        image.onerror = () => reject(new Error('decode'));
        image.src = dataUrl;
      });
      const longest = Math.max(image.naturalWidth, image.naturalHeight);
      const scale = Math.min(1, 96 / longest);
      const width = Math.max(2, Math.round(image.naturalWidth * scale));
      const height = Math.max(2, Math.round(image.naturalHeight * scale));
      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) throw new Error('canvas');
      ctx.drawImage(image,0,0,width,height);
      return { width, height, pixels: Array.from(ctx.getImageData(0,0,width,height).data) };
    }, { dataUrl });
    return scoreRasterPixelsV15(Uint8ClampedArray.from(decoded.pixels),decoded.width,decoded.height).passed;
  } finally {
    await page.close();
  }
}
async function technicalEvidence(browser: Browser, bytes: Buffer, mimeType: Generated['mime'], width: number, height: number): Promise<ImageTechnicalEvidenceV15> {
  const dims = readRasterDimensionsV15(bytes,mimeType);
  const expected = ratio(width,height).split(':').map(Number);
  const expectedRatio = expected[0] / expected[1];
  const actualRatio = dims ? dims.width / dims.height : 0;
  const dimensionsValid = Boolean(dims && dims.width >= 512 && dims.height >= 512 && dims.width <= 4096 && dims.height <= 4096 && Math.abs(actualRatio-expectedRatio)/expectedRatio <= 0.04);
  const technicalCriticPassed = dims ? await pixelCritic(browser,bytes,mimeType).catch(()=>false) : false;
  return {
    signatureValid: Boolean(dims),
    dimensionsValid,
    structuralCriticPassed: Boolean(dims && bytes.length >= 1024 && bytes.length <= MAX_IMAGE_BYTES),
    technicalCriticPassed,
    safetyPassed: true,
    deliveryIntegrityPassed: true,
  };
}
function assertBudget(total: number, reserve: number) {
  if (total + reserve > TOTAL_COST_CAP) throw new Error('BAKEOFF_TOTAL_COST_CAP_WOULD_BE_EXCEEDED');
}
async function generateReference(apiKey: string, browser: Browser, task: Task, ref: typeof REFERENCES[number], totalCost: number): Promise<Generated> {
  assertBudget(totalCost, IMAGE_COST_CAP);
  const started = Date.now();
  const result = await openRouter(apiKey,IMAGE_URL,{
    model: ref.model,
    prompt: task.prompt,
    n: 1,
    resolution: '1K',
    aspect_ratio: ratio(task.width,task.height),
    quality: ref.quality,
    output_format: 'png',
  },EXECUTION_BUDGET_MS);
  const costUsd = usageCost(result);
  if (costUsd > IMAGE_COST_CAP) throw new Error(\`BAKEOFF_IMAGE_COST_CAP_EXCEEDED:\${ref.systemId}\`);
  const data = Array.isArray(result.data) ? result.data as Record<string,unknown>[] : [];
  const encoded = typeof data[0]?.b64_json === 'string' ? String(data[0].b64_json) : '';
  if (!encoded) throw new Error(\`BAKEOFF_IMAGE_PAYLOAD_INVALID:\${ref.systemId}\`);
  const bytes = Buffer.from(encoded,'base64');
  const imageMime = mime(bytes);
  if (!imageMime || bytes.length > MAX_IMAGE_BYTES) throw new Error(\`BAKEOFF_IMAGE_BINARY_INVALID:\${ref.systemId}\`);
  return {
    systemId: ref.systemId, role: 'reference', bytes, mime: imageMime,
    durationMs: Date.now()-started, imageSha256: sha256(bytes),
    technical: await technicalEvidence(browser,bytes,imageMime,task.width,task.height),
    costUsd, modelId: ref.model, providerId: 'openrouter-image-api',
  };
}
async function generateOrigin(baseUrl: string, browser: Browser, task: Task, totalCost: number, candidateSha: string): Promise<Generated> {
  assertBudget(totalCost, IMAGE_COST_CAP);
  const started = Date.now();
  const response = await fetch(\`\${baseUrl}/api/creative/v1.6/world-class/generate\`,{
    method:'POST',
    headers:{'content-type':'application/json',accept:'image/png,image/jpeg,image/webp,application/json'},
    body:JSON.stringify({prompt:task.prompt,width:task.width,height:task.height}),
    signal:AbortSignal.timeout(EXECUTION_BUDGET_MS),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(\`BAKEOFF_ORIGIN_HTTP_\${response.status}:\${body.slice(0,120)}\`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  const imageMime = mime(bytes);
  if (!imageMime) throw new Error('BAKEOFF_ORIGIN_BINARY_INVALID');
  const costUsd = Number(response.headers.get('x-origin-cost-usd') ?? NaN);
  if (!Number.isFinite(costUsd) || costUsd < 0 || costUsd > IMAGE_COST_CAP) throw new Error('BAKEOFF_ORIGIN_COST_INVALID');
  if (response.headers.get('x-origin-release-sha') !== candidateSha) throw new Error('BAKEOFF_ORIGIN_SHA_MISMATCH');
  if (response.headers.get('x-origin-world-class-evaluation') !== 'true') throw new Error('BAKEOFF_ORIGIN_EVAL_MARKER_MISSING');
  return {
    systemId: ORIGIN_SYSTEM, role:'origin', bytes, mime:imageMime,
    durationMs:Date.now()-started, imageSha256:sha256(bytes),
    technical:await technicalEvidence(browser,bytes,imageMime,task.width,task.height),
    costUsd, modelId:response.headers.get('x-origin-visual-model') ?? 'unknown',
    providerId:response.headers.get('x-origin-visual-provider') ?? 'unknown',
  };
}
function blindOrder(caseId: string, outputs: Generated[]): { key: string; output: Generated }[] {
  const ranked = outputs.map((output,index)=>({output,index,rank:sha256(\`\${caseId}:\${output.systemId}\`)})).sort((a,b)=>a.rank.localeCompare(b.rank));
  return ranked.map((item,index)=>({key:['A','B','C','D'][index],output:item.output}));
}
function validateScores(value: unknown, keys: string[]): Record<string,ImageRubricScoresV15> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('BAKEOFF_JUDGE_SCORES_INVALID');
  const row = value as Record<string,unknown>;
  const out: Record<string,ImageRubricScoresV15> = {};
  for (const key of keys) {
    const score = row[key];
    if (!score || typeof score !== 'object' || Array.isArray(score)) throw new Error('BAKEOFF_JUDGE_SCORE_MISSING');
    const s = score as Record<string,unknown>;
    const obj = {} as ImageRubricScoresV15;
    for (const axis of IMAGE_RUBRIC_AXES_V15) {
      const n = Number(s[axis]);
      if (!Number.isFinite(n) || n < 0 || n > 4) throw new Error('BAKEOFF_JUDGE_AXIS_INVALID');
      obj[axis] = Math.round(n*100)/100;
    }
    out[key]=obj;
  }
  return out;
}
async function judge(apiKey:string,task:Task,blind:{key:string;output:Generated}[],judgeId:string,totalCost:number):Promise<JudgeResult>{
  assertBudget(totalCost,JUDGE_COST_CAP);
  const keys=blind.map(x=>x.key);
  const rubric='Score each image 0-4 on promptAdherence, composition, subjectIntegrity, styleExecution, textHandling, artifactControl, professionalUsefulness.';
  const taxonomy='Allowed failure factors only: prompt-adherence, composition, anatomy-geometry, material-realism, lighting, style-fidelity, text-handling, artifacting, professional-usefulness, none.';
  const content:any[]=[{type:'text',text:
    \`You are an independent blind image-quality judge. Do not infer or discuss model identity. User request:\\n\${task.prompt}\\n\\n\${rubric}\\n\${taxonomy}\\nReturn JSON only with keys firstChoiceBlindKey, scores, criticalSafetyIssues, failureFactors. scores must contain exactly \${keys.join(',')} and all 7 numeric axes. criticalSafetyIssues maps each key to true/false. failureFactors maps each key to an array of allowed taxonomy strings. Judge professional usefulness at the requested size; for exact-text tasks penalize any wrong, missing, invented, duplicated, or illegible text.\`
  }];
  for(const item of blind){
    content.push({type:'text',text:\`Blind output \${item.key}:\`});
    content.push({type:'image_url',image_url:{url:\`data:\${item.output.mime};base64,\${item.output.bytes.toString('base64')}\`}});
  }
  const result=await openRouter(apiKey,CHAT_URL,{
    model:judgeId,
    messages:[
      {role:'system',content:'Be strict and discriminating. Use the full 0-4 scale. Output JSON only.'},
      {role:'user',content},
    ],
    temperature:0,
    max_tokens:2200,
  },120_000);
  const costUsd=usageCost(result);
  if(costUsd>JUDGE_COST_CAP) throw new Error(\`BAKEOFF_JUDGE_COST_CAP_EXCEEDED:\${judgeId}\`);
  const choices=Array.isArray(result.choices)?result.choices as Record<string,unknown>[]:[];
  const message=choices[0]?.message && typeof choices[0].message==='object' ? choices[0].message as Record<string,unknown> : {};
  const raw=typeof message.content==='string'?message.content:'';
  const parsed=parseJsonObject(raw);
  const first=String(parsed.firstChoiceBlindKey??'');
  if(!keys.includes(first)) throw new Error('BAKEOFF_JUDGE_FIRST_CHOICE_INVALID');
  const scores=validateScores(parsed.scores,keys);
  const safetyRaw=parsed.criticalSafetyIssues && typeof parsed.criticalSafetyIssues==='object'&&!Array.isArray(parsed.criticalSafetyIssues)?parsed.criticalSafetyIssues as Record<string,unknown>:{};
  const failureRaw=parsed.failureFactors && typeof parsed.failureFactors==='object'&&!Array.isArray(parsed.failureFactors)?parsed.failureFactors as Record<string,unknown>:{};
  const criticalSafetyIssues=Object.fromEntries(keys.map(key=>[key,safetyRaw[key]===true]));
  const allowed=new Set(['prompt-adherence','composition','anatomy-geometry','material-realism','lighting','style-fidelity','text-handling','artifacting','professional-usefulness','none']);
  const failureFactors=Object.fromEntries(keys.map(key=>{
    const items=Array.isArray(failureRaw[key])?failureRaw[key] as unknown[]:[];
    const values=items.map(String).filter(v=>allowed.has(v));
    return [key,values.length?values:['none']];
  }));
  return {judgeId,firstChoiceBlindKey:first,scores,criticalSafetyIssues,failureFactors,costUsd};
}
function averageScores(judges:JudgeResult[],key:string):ImageRubricScoresV15{
  const out={} as ImageRubricScoresV15;
  for(const axis of IMAGE_RUBRIC_AXES_V15){
    out[axis]=judges.reduce((sum,j)=>sum+j.scores[key][axis],0)/judges.length;
  }
  return out;
}
function meanScore(s:ImageRubricScoresV15):number{
  return IMAGE_RUBRIC_AXES_V15.reduce((sum,a)=>sum+s[a],0)/IMAGE_RUBRIC_AXES_V15.length;
}
function caseOutcome(blind:{key:string;output:Generated}[],judges:JudgeResult[]){
  const origin=blind.find(x=>x.output.role==='origin')!;
  const refs=blind.filter(x=>x.output.role==='reference');
  const originScores=averageScores(judges,origin.key);
  const refStats=refs.map(r=>({item:r,scores:averageScores(judges,r.key)}));
  refStats.sort((a,b)=>meanScore(b.scores)-meanScore(a.scores));
  const strongest=refStats[0];
  const votes=(key:string)=>judges.filter(j=>j.firstChoiceBlindKey===key).length;
  const diff=meanScore(originScores)-meanScore(strongest.scores);
  const outcome = diff>=0.1 && votes(origin.key)>=votes(strongest.item.key)
    ? 'win' : (diff<=-0.1 || votes(origin.key)<votes(strongest.item.key) ? 'loss':'tie');
  return {
    outcome,
    originMean:Math.round(meanScore(originScores)*1000)/1000,
    strongestReferenceSystem:strongest.item.output.systemId,
    strongestReferenceMean:Math.round(meanScore(strongest.scores)*1000)/1000,
    margin:Math.round(diff*1000)/1000,
    originFirstChoiceVotes:votes(origin.key),
    strongestReferenceVotes:votes(strongest.item.key),
  };
}

async function main(){
  const apiKey=required('OPENROUTER_API_KEY');
  const candidateSha=required('ORIGIN_BAKEOFF_CANDIDATE_SHA').toLowerCase();
  if(!/^[a-f0-9]{40}$/.test(candidateSha)) throw new Error('BAKEOFF_CANDIDATE_SHA_INVALID');
  if(!Number.isFinite(TOTAL_COST_CAP)||TOTAL_COST_CAP<=0||TOTAL_COST_CAP>20) throw new Error('BAKEOFF_TOTAL_COST_CAP_INVALID');
  const outputDir=path.resolve(process.env.ORIGIN_BAKEOFF_OUTPUT_DIR??'test-results/image-frontier-bakeoff-v1');
  const imageDir=path.join(outputDir,'images');
  await fs.mkdir(imageDir,{recursive:true});

  const runtimeEnv:NodeJS.ProcessEnv={
    ...process.env,
    OPENROUTER_API_KEY:apiKey,
    ORIGIN_IMAGE_WORLD_CLASS_ENABLED:'true',
    ORIGIN_IMAGE_WORLD_CLASS_EVAL:'true',
    ORIGIN_RELEASE_SHA:candidateSha,
    ORIGIN_IMAGE_WORLD_CLASS_MAX_COST_USD:String(IMAGE_COST_CAP),
    VERCEL_ENV:'preview',
    NODE_ENV:'test',
  };
  const app=express();
  app.disable('x-powered-by');
  app.use(express.json({limit:'128kb'}));
  app.use(createWorldClassImageV16Router(runtimeEnv));
  const server=http.createServer(app);
  await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',()=>resolve());});
  const address=server.address();
  if(!address||typeof address==='string') throw new Error('BAKEOFF_SERVER_BIND_FAILED');
  const baseUrl=\`http://127.0.0.1:\${address.port}\`;
  const browser=await chromium.launch({headless:true});
  let totalCostUsd=0;
  const evidenceCases:any[]=[];
  const diagnostics:any[]=[];
  try{
    for(const [index,task] of TASKS.entries()){
      const generated:Generated[]=[];
      const origin=await generateOrigin(baseUrl,browser,task,totalCostUsd,candidateSha);
      totalCostUsd+=origin.costUsd; generated.push(origin);
      for(const ref of REFERENCES){
        const item=await generateReference(apiKey,browser,task,ref,totalCostUsd);
        totalCostUsd+=item.costUsd; generated.push(item);
      }
      const blind=blindOrder(task.caseId,generated);
      for(const item of blind){
        const ext=item.output.mime==='image/png'?'png':item.output.mime==='image/webp'?'webp':'jpg';
        await fs.writeFile(path.join(imageDir,\`\${task.caseId}-\${item.key}.\${ext}\`),item.output.bytes,{mode:0o600});
      }
      const judges:JudgeResult[]=[];
      for(const judgeId of JUDGES){
        const j=await judge(apiKey,task,blind,judgeId,totalCostUsd);
        totalCostUsd+=j.costUsd; judges.push(j);
      }
      for(const item of blind){
        if(judges.some(j=>j.criticalSafetyIssues[item.key])){
          item.output.technical.safetyPassed=false;
        }
      }
      const outcome=caseOutcome(blind,judges);
      const originBlind=blind.find(x=>x.output.role==='origin')!;
      const factors=judges.flatMap(j=>j.failureFactors[originBlind.key]).filter(x=>x!=='none');
      diagnostics.push({
        caseId:task.caseId,family:task.family,outcome,...outcome,
        originModel:origin.modelId,
        costs:{
          origin:origin.costUsd,
          references:Object.fromEntries(generated.filter(x=>x.role==='reference').map(x=>[x.systemId,x.costUsd])),
          judges:Object.fromEntries(judges.map(j=>[j.judgeId,j.costUsd])),
          caseTotal:Math.round((generated.reduce((s,x)=>s+x.costUsd,0)+judges.reduce((s,x)=>s+x.costUsd,0))*1e6)/1e6,
        },
        originFailureFactors:[...new Set(factors)],
        technicalFailures:blind.filter(x=>!Object.values(x.output.technical).every(Boolean)).map(x=>({blindKey:x.key,systemId:x.output.systemId,technical:x.output.technical})),
      });
      evidenceCases.push({
        caseId:task.caseId,
        family:task.family,
        challengeTags:task.challengeTags,
        promptSha256:sha256(task.prompt),
        width:task.width,height:task.height,requiresText:task.requiresText,
        outputs:blind.map(({key,output})=>({
          blindKey:key,systemId:output.systemId,role:output.role,
          executionStatus:'completed',
          durationMs:output.durationMs,
          imageSha256:output.imageSha256,
          technical:output.technical,
        } satisfies ImageBenchmarkOutputV15)),
        judges:judges.map(j=>({
          judgeId:j.judgeId,
          firstChoiceBlindKey:j.firstChoiceBlindKey,
          scores:j.scores,
        })),
      });
      process.stdout.write(JSON.stringify({event:'case-complete',caseId:task.caseId,family:task.family,outcome:outcome.outcome,totalCostUsd:Math.round(totalCostUsd*1e6)/1e6})+'\\n');
    }

    const createdAt=new Date().toISOString();
    const input:OriginImageBlindBenchmarkInputV15={
      schema:ORIGIN_IMAGE_BLIND_BENCHMARK_SCHEMA,
      candidateSha,evaluatorSha:candidateSha,
      corpusSha256:sha256(JSON.stringify(TASKS)),
      originSystemId:ORIGIN_SYSTEM,
      referenceSystemIds:REFERENCES.map(x=>x.systemId),
      executionBudgetMs:EXECUTION_BUDGET_MS,
      roundId:\`frontier-bakeoff-v1-\${candidateSha.slice(0,12)}\`,
      createdAt,
      expiresAt:new Date(Date.now()+30*24*60*60_000).toISOString(),
      cases:evidenceCases,
    };
    const report=evaluateOriginImageBlindBenchmarkV15(input);
    const familySummary=Object.fromEntries(
      [...new Set(TASKS.map(t=>t.family))].map(family=>{
        const rows=diagnostics.filter(x=>x.family===family);
        const wins=rows.filter(x=>x.outcome==='win').length;
        const ties=rows.filter(x=>x.outcome==='tie').length;
        const losses=rows.filter(x=>x.outcome==='loss').length;
        const score=rows.reduce((s,x)=>s+x.originMean,0)/rows.length;
        const cost=rows.reduce((s,x)=>s+x.costs.caseTotal,0);
        const factors=rows.flatMap(x=>x.originFailureFactors);
        const counts=Object.entries(factors.reduce((acc:any,v:string)=>{acc[v]=(acc[v]||0)+1;return acc;},{})).sort((a:any,b:any)=>b[1]-a[1]);
        return [family,{wins,ties,losses,originMean:Math.round(score*1000)/1000,costUsd:Math.round(cost*1e6)/1e6,topFailureFactors:counts.slice(0,5)}];
      }),
    );
    const summary={
      schemaVersion:'origin.image-frontier-bakeoff-summary.v1',
      candidateSha,
      references:REFERENCES.map(x=>x.systemId),
      judges:[...JUDGES],
      cases:24,
      wins:report.wins,ties:report.ties,losses:report.losses,
      winRate:report.winRate,lossRate:report.lossRate,nonLossRate:report.nonLossRate,
      overallMean:report.overallMean,
      passedStrictWorldClassGate:report.passed,
      blockers:report.blockers,
      originAxisMeans:report.originAxisMeans,
      bestReferenceAxisMeans:report.bestReferenceAxisMeans,
      totalCostUsd:Math.round(totalCostUsd*1e6)/1e6,
      totalCostCapUsd:TOTAL_COST_CAP,
      familySummary,
      casesDetail:diagnostics,
    };
    await fs.writeFile(path.join(outputDir,'benchmark-input.json'),JSON.stringify(input,null,2)+'\\n',{mode:0o600});
    await fs.writeFile(path.join(outputDir,'benchmark-report.json'),JSON.stringify(report,null,2)+'\\n',{mode:0o600});
    await fs.writeFile(path.join(outputDir,'benchmark-summary.json'),JSON.stringify(summary,null,2)+'\\n',{mode:0o600});
    process.stdout.write(JSON.stringify({event:'bakeoff-complete',candidateSha,totalCostUsd:summary.totalCostUsd,wins:report.wins,ties:report.ties,losses:report.losses,passed:report.passed})+'\\n');
  } finally {
    await browser.close();
    await new Promise<void>(resolve=>server.close(()=>resolve()));
  }
}

main().catch((error:unknown)=>{
  const message=error instanceof Error?error.message:String(error);
  process.stderr.write(message.slice(0,500)+'\\n');
  process.exitCode=1;
});
