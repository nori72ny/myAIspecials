import fs from 'node:fs';

const file = 'src/components/personal/UnifiedChat.tsx';
const source = fs.readFileSync(file, 'utf8');

if (source.includes('function postProcessUnverifiedNumbers(')) {
  console.log('Numeric postprocessor already present; no changes needed.');
  process.exit(0);
}

const anchor = 'function mobileFriendlyMarkdown(source: string): string {';
if (!source.includes(anchor)) throw new Error('SafeMarkdown anchor not found');

const helper = String.raw`type NumericPostProcessResult = { source: string; hadNumericEstimates: boolean };

function postProcessUnverifiedNumbers(source: string): NumericPostProcessResult {
  const protectedRanges: Array<[number, number]> = [];
  const addRanges = (re: RegExp) => {
    let match: RegExpExecArray | null;
    while ((match = re.exec(source)) !== null) {
      protectedRanges.push([match.index, match.index + match[0].length]);
    }
  };

  // Explicitly verified source, code, URLs, and Markdown link destinations are never rewritten.
  addRanges(/<verified_source>[\\s\\S]*?<\\/verified_source>/gi);
  addRanges(/\`\`\`[\\s\\S]*?\`\`\`|\`[^\`\\n]*\`/g);
  addRanges(/https?:\\/\\/[^\\s)<>]+|www\\.[^\\s)<>]+/gi);
  addRanges(/!?(?:\\[[^\\]]*\\])\\([^)]*\\)/g);

  const isProtected = (index: number) =>
    protectedRanges.some(([start, end]) => index >= start && index < end);

  const isDateLike = (value: string, index: number) => {
    const after = source.slice(index + value.length, index + value.length + 8);
    if (/^(?:19|20)\\d{2}$/.test(value) && /^(?:年|[-/.])/.test(after)) return true;
    if (/^(?:0?[1-9]|1[0-2])$/.test(value) && /^(?:月|日)/.test(after)) return true;
    if (/^(?:0?[1-9]|[12]\\d|3[01])$/.test(value) && /^日/.test(after)) return true;
    return false;
  };

  const numericRe = /(?<![\\w])(?:[$€£¥￥]\\s?)?(?:\\d{1,3}(?:,\\d{3})+|\\d+)(?:\\.\\d+)?(?:\\s?(?:%|万円|億円|円|USD|EUR|GBP|JPY|ドル))?(?![\\w])/g;
  const output: string[] = [];
  let cursor = 0;
  let changed = false;
  let match: RegExpExecArray | null;

  while ((match = numericRe.exec(source)) !== null) {
    const index = match.index;
    const value = match[0];
    if (isProtected(index) || isDateLike(value, index)) continue;

    // Avoid converting ordinary ordered-list prefixes such as "1. item".
    const following = source.slice(index + value.length);
    if (/^\\s*\\./.test(following) && !/[$€£¥￥%円万億]/.test(value)) continue;

    output.push(source.slice(cursor, index));
    output.push(\`[⚠️ AI推定値: \${value}](#estimate-unverified)\`);
    cursor = index + value.length;
    changed = true;
  }

  if (!changed) return { source, hadNumericEstimates: false };
  output.push(source.slice(cursor));
  return { source: output.join(''), hadNumericEstimates: true };
}

`;

let patched = source.replace(anchor, helper + anchor, 1);

const oldLink = `        a: ({ children: label, href }) => (
          <a
            href={href}
            target="_blank"
            rel="noreferrer noopener"
            className="font-medium text-origin-brand underline decoration-origin-brand/40 underline-offset-2"
          >
            {label}
          </a>
        ),`;

const newLink = `        a: ({ children: label, href }) => {
          if (href === '#estimate-unverified') {
            return (
              <span
                role="note"
                title={isEn ? 'AI estimate — verify before relying on this number.' : 'AI推定値 — 利用前に根拠を確認してください。'}
                aria-label={isEn ? 'AI-estimated value' : 'AI推定値'}
                className="mx-0.5 inline-flex items-center rounded-md bg-yellow-100 px-1.5 py-0.5 font-medium text-yellow-900 ring-1 ring-yellow-300/80 dark:bg-yellow-400/15 dark:text-yellow-100 dark:ring-yellow-300/30"
              >
                {label}
              </span>
            );
          }
          return (
            <a href={href} target="_blank" rel="noreferrer noopener" className="font-medium text-origin-brand underline decoration-origin-brand/40 underline-offset-2">
              {label}
            </a>
          );
        },`;

if (!patched.includes(oldLink)) throw new Error('Markdown link renderer anchor not found');
patched = patched.replace(oldLink, newLink, 1);

const oldRender = `    >
      {mobileFriendlyMarkdown(children)}
    </ReactMarkdown>`;
const newRender = `    >
      {postProcessUnverifiedNumbers(mobileFriendlyMarkdown(children)).source}
    </ReactMarkdown>`;

if (!patched.includes(oldRender)) throw new Error('SafeMarkdown render anchor not found');
patched = patched.replace(oldRender, newRender, 1);

fs.writeFileSync(file, patched, 'utf8');
console.log('Applied context-aware numeric postprocessor to SafeMarkdown.');
