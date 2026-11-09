import React from 'react';

/**
 * Minimal formatted renderer for the constrained markdown that ORIGIN's
 * own generators produce (headings, bullets, numbered steps, bold).
 * Used where a result was previously shown as raw monospaced text
 * (agent workspace output). It intentionally supports only that subset:
 * anything else renders as a plain paragraph, and no HTML is ever
 * injected, so untrusted model output stays inert text.
 */

function renderInline(text: string) {
  const parts = text.split(/(\*\*[^*\n]+\*\*)/g);
  return parts.map((part, index) => {
    const bold = part.match(/^\*\*([^*\n]+)\*\*$/);
    if (bold) return <strong key={`b-${index}`}>{bold[1]}</strong>;
    return <React.Fragment key={`t-${index}`}>{part}</React.Fragment>;
  });
}

export default function FormattedMarkdown({ text }: { text: string }) {
  return <div className="break-words text-sm leading-7">
    {text.split('\n').map((line, index) => {
      if (!line.trim()) return <div key={`space-${index}`} className="h-2" aria-hidden="true" />;
      if (line.startsWith('### ')) return <h4 key={`h4-${index}`} className="mt-4 text-sm font-black">{renderInline(line.slice(4))}</h4>;
      if (line.startsWith('## ')) return <h3 key={`h3-${index}`} className="mt-4 text-base font-black">{renderInline(line.slice(3))}</h3>;
      if (line.startsWith('# ')) return <h3 key={`h2-${index}`} className="mt-1 text-lg font-black">{renderInline(line.slice(2))}</h3>;
      if (line.startsWith('- ')) {
        return <p key={`bullet-${index}`} className="ml-1 flex gap-2">
          <span aria-hidden="true" className="mt-[0.65rem] h-1.5 w-1.5 shrink-0 rounded-full bg-origin-brand" />
          <span>{renderInline(line.slice(2))}</span>
        </p>;
      }
      const numbered = line.match(/^(\d+)\.\s+(.*)$/);
      if (numbered) {
        return <p key={`num-${index}`} className="ml-1 flex gap-2">
          <span aria-hidden="true" className="mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-origin-brand-soft text-[11px] font-black text-origin-brand">{numbered[1]}</span>
          <span>{renderInline(numbered[2])}</span>
        </p>;
      }
      return <p key={`line-${index}`}>{renderInline(line)}</p>;
    })}
  </div>;
}
