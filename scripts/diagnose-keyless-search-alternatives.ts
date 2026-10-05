const query='Cloudflare Workers AI';
const targets=[
  {id:'bing-rss',url:'https://www.bing.com/search?format=rss&count=8&q='+encodeURIComponent(query)},
  {id:'bing-html',url:'https://www.bing.com/search?count=8&q='+encodeURIComponent(query)},
  {id:'brave-html',url:'https://search.brave.com/search?q='+encodeURIComponent(query)+'&source=web'},
  {id:'mojeek-html',url:'https://www.mojeek.com/search?q='+encodeURIComponent(query)},
] as const;

function domainsFromLinks(body:string):string[]{
  const domains:string[]=[];
  for(const m of body.matchAll(/<link>(https?:\/\/[^<]+)<\/link>/gi)){
    try{
      const host=new URL(m[1]).hostname.toLowerCase().replace(/^www\./,'');
      if(host&&!domains.includes(host))domains.push(host);
    }catch{}
  }
  return domains.slice(0,8);
}

async function main():Promise<void>{
  for(const target of targets){
    try{
      const response=await fetch(target.url,{
        headers:{'user-agent':'Mozilla/5.0 ORIGIN-Research-Diagnostic/1.0','accept':'text/html,application/rss+xml,application/xml;q=0.9,*/*;q=0.5'},
        redirect:'manual',
        signal:AbortSignal.timeout(6000),
      });
      const body=(await response.text()).slice(0,500_000);
      process.stdout.write(JSON.stringify({
        evaluation:'KEYLESS_SEARCH_ALTERNATIVE_DIAGNOSTIC',
        id:target.id,
        status:response.status,
        location:response.headers.get('location')?new URL(response.headers.get('location')!,target.url).hostname:null,
        contentType:response.headers.get('content-type'),
        bytes:Buffer.byteLength(body,'utf8'),
        rssItems:(body.match(/<item\b/gi)||[]).length,
        bingResults:(body.match(/class=["'][^"']*b_algo/gi)||[]).length,
        braveResults:(body.match(/data-type=["']web/gi)||[]).length,
        mojeekResults:(body.match(/class=["'][^"']*result/gi)||[]).length,
        linkedDomains:domainsFromLinks(body),
      })+'\n');
    }catch(error){
      process.stdout.write(JSON.stringify({
        evaluation:'KEYLESS_SEARCH_ALTERNATIVE_DIAGNOSTIC',
        id:target.id,
        error:error instanceof Error?error.name:'UNKNOWN',
      })+'\n');
    }
  }
}

main().catch((error:unknown)=>{
  process.stderr.write((error instanceof Error?error.message:'KEYLESS_SEARCH_DIAGNOSTIC_FAILED')+'\n');
  process.exitCode=1;
});
