import { secureFetch } from '../services/mission-engine/src/application/agent/ToolExecutor.js';

function attr(attrs:string,name:string):string|null{
  return attrs.match(new RegExp('\\b'+name+'\\s*=\\s*["\\\']([^"\\\']+)["\\\']','i'))?.[1]??null;
}

async function main():Promise<void>{
  const query='Cloudflare Workers AI';
  const endpoints=[
    'https://html.duckduckgo.com/html/?q='+encodeURIComponent(query)+'&kl=us-en&num=6',
    'https://lite.duckduckgo.com/lite/?q='+encodeURIComponent(query)+'&kl=us-en',
  ];
  for(const endpoint of endpoints){
    const html=await secureFetch(endpoint);
    const anchors=[...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)];
    const samples=anchors.slice(0,40).map((match)=>{
      const attrs=match[1]??'';
      const href=attr(attrs,'href');
      const cls=attr(attrs,'class');
      return {className:cls,hrefPrefix:href?.slice(0,180)??null};
    });
    process.stdout.write(JSON.stringify({
      evaluation:'RESEARCH_SEARCH_SURFACE_DIAGNOSTIC',
      endpoint:new URL(endpoint).hostname+new URL(endpoint).pathname,
      htmlBytes:Buffer.byteLength(html,'utf8'),
      anchorCount:anchors.length,
      resultA:(html.match(/result__a/gi)||[]).length,
      resultLink:(html.match(/result-link/gi)||[]).length,
      resultSnippet:(html.match(/result__snippet/gi)||[]).length,
      resultSnippetLite:(html.match(/result-snippet/gi)||[]).length,
      samples,
    })+'\n');
  }
}

main().catch((error:unknown)=>{
  process.stderr.write((error instanceof Error?error.message:'RESEARCH_SEARCH_SURFACE_DIAGNOSTIC_FAILED')+'\n');
  process.exitCode=1;
});
