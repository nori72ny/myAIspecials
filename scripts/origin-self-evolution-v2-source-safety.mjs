const CANONICAL_SOURCES = Object.freeze([
  { name: "OpenAI", url: "https://openai.com/news/" },
  { name: "Anthropic", url: "https://www.anthropic.com/news" },
  { name: "Google AI", url: "https://blog.google/technology/ai/" },
  { name: "Microsoft AI", url: "https://blogs.microsoft.com/ai/" },
  { name: "arXiv AI", url: "https://arxiv.org/list/cs.AI/recent" },
  { name: "arXiv ML", url: "https://arxiv.org/list/cs.LG/recent" },
  { name: "GitHub Changelog", url: "https://github.blog/changelog/" },
  { name: "Vercel Changelog", url: "https://vercel.com/changelog" },
  { name: "arXiv SE", url: "https://arxiv.org/list/cs.SE/recent" },
  { name: "GitHub Trending", url: "https://github.com/trending" },
  { name: "arXiv CV", url: "https://arxiv.org/list/cs.CV/recent" },
  { name: "Cloudflare AI Changelog", url: "https://developers.cloudflare.com/changelog/product-group/ai/" },
  { name: "CISA KEV", url: "https://www.cisa.gov/known-exploited-vulnerabilities-catalog" },
  { name: "GitHub Security Advisories", url: "https://github.com/advisories" },
  { name: "NVD", url: "https://nvd.nist.gov/" },
  { name: "Node Security Releases", url: "https://nodejs.org/en/blog/release" },
  { name: "Node Releases", url: "https://nodejs.org/en/blog/release" },
  { name: "React Blog", url: "https://react.dev/blog" },
  { name: "Vite Blog", url: "https://vite.dev/blog" },
  { name: "Supabase Changelog", url: "https://supabase.com/changelog" },
  { name: "Cloudflare Developer Changelog", url: "https://developers.cloudflare.com/changelog/product-group/developer-platform/" },
  { name: "W3C WAI News", url: "https://www.w3.org/WAI/news/" },
  { name: "Material Design", url: "https://m3.material.io/blog" },
  { name: "Apple Developer Design", url: "https://developer.apple.com/design/" },
  { name: "WHATWG", url: "https://whatwg.org/" },
  { name: "W3C", url: "https://www.w3.org/blog/" }
]);

const RAW_TEXT_ELEMENTS = new Set(["script", "style", "template", "noscript"]);

function isWhitespace(character) {
  if (!character) return false;
  const code = character.charCodeAt(0);
  return code === 9 || code === 10 || code === 12 || code === 13 || code === 32;
}

function parseTagBody(body) {
  let index = 0;
  while (index < body.length && isWhitespace(body[index])) index += 1;
  let closing = false;
  if (body[index] === "/") {
    closing = true;
    index += 1;
    while (index < body.length && isWhitespace(body[index])) index += 1;
  }
  const start = index;
  while (index < body.length) {
    const code = body.charCodeAt(index);
    const alphaNumeric =
      (code >= 48 && code <= 57) ||
      (code >= 65 && code <= 90) ||
      (code >= 97 && code <= 122);
    if (!alphaNumeric && body[index] !== "-" && body[index] !== ":") break;
    index += 1;
  }
  if (index === start) return null;
  const name = body.slice(start, index).toLowerCase();
  return { name, closing, selfClosing: body.trimEnd().endsWith("/") };
}

function stripHtmlAndRawText(value) {
  const source = String(value || "");
  let output = "";
  let cursor = 0;

  while (cursor < source.length) {
    const open = source.indexOf("<", cursor);
    if (open < 0) {
      output += source.slice(cursor);
      break;
    }
    output += source.slice(cursor, open);
    const close = source.indexOf(">", open + 1);
    if (close < 0) {
      output += " ";
      break;
    }

    const tag = parseTagBody(source.slice(open + 1, close));
    if (!tag || tag.closing || tag.selfClosing || !RAW_TEXT_ELEMENTS.has(tag.name)) {
      output += " ";
      cursor = close + 1;
      continue;
    }

    let search = close + 1;
    let closingTagEnd = -1;
    while (search < source.length) {
      const candidate = source.indexOf("</", search);
      if (candidate < 0) break;
      const candidateEnd = source.indexOf(">", candidate + 2);
      if (candidateEnd < 0) break;
      const candidateTag = parseTagBody(source.slice(candidate + 1, candidateEnd));
      if (candidateTag?.closing && candidateTag.name === tag.name) {
        closingTagEnd = candidateEnd;
        break;
      }
      search = candidate + 2;
    }

    output += " ";
    cursor = closingTagEnd >= 0 ? closingTagEnd + 1 : source.length;
  }

  return output;
}

function normalizeVisibleText(value, maxExcerpt) {
  let output = "";
  let pendingSpace = false;
  for (const character of value) {
    const code = character.codePointAt(0) || 0;
    const control = (code >= 0 && code <= 31) || code === 127;
    if (control || isWhitespace(character)) {
      pendingSpace = output.length > 0;
      continue;
    }
    if (pendingSpace) {
      output += " ";
      pendingSpace = false;
    }
    output += character;
    if (output.length >= maxExcerpt) break;
  }
  return output.trim().slice(0, maxExcerpt);
}

export function resolveCanonicalSource(source) {
  if (!source || typeof source !== "object") return null;
  for (const canonical of CANONICAL_SOURCES) {
    if (source.name === canonical.name && source.url === canonical.url) return canonical;
  }
  return null;
}

export function sanitizeExternalEvidence(value, maxExcerpt = 1800) {
  const limit = Number(maxExcerpt);
  const safeLimit = Number.isFinite(limit) && limit > 0 ? Math.min(Math.floor(limit), 10000) : 1800;
  return normalizeVisibleText(stripHtmlAndRawText(value), safeLimit);
}


export async function readBoundedResponseText(response, maxBytes) {
  const limit = Number(maxBytes);
  if (!Number.isFinite(limit) || limit <= 0) throw new Error("SOURCE_BODY_LIMIT_INVALID");
  if (!response?.body || typeof response.body.getReader !== "function") {
    const fallback = new Uint8Array(await response.arrayBuffer());
    if (fallback.byteLength > limit) throw new Error("SOURCE_BODY_TOO_LARGE");
    return new TextDecoder().decode(fallback);
  }

  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!(value instanceof Uint8Array)) throw new Error("SOURCE_BODY_CHUNK_INVALID");
      total += value.byteLength;
      if (total > limit) {
        await reader.cancel("SOURCE_BODY_TOO_LARGE");
        throw new Error("SOURCE_BODY_TOO_LARGE");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(merged);
}
