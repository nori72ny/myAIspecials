import { useMemo, useState } from 'react';

export type KnowledgeNode = {
  id: string;
  title: string;
  content: string;
  kind?: 'conversation' | 'note' | 'artifact';
};

type Edge = { source: number; target: number; weight: number };

function tokens(value: string): Set<string> {
  return new Set(value.toLocaleLowerCase().split(/[^\p{L}\p{N}_-]+/u).filter((token) => token.length >= 2).slice(0, 500));
}

function similarity(a: string, b: string): number {
  const left = tokens(a); const right = tokens(b);
  if (!left.size || !right.size) return 0;
  let intersection = 0;
  left.forEach((token) => { if (right.has(token)) intersection += 1; });
  return intersection / Math.sqrt(left.size * right.size);
}

function buildEdges(nodes: KnowledgeNode[]): Edge[] {
  const edges: Edge[] = [];
  for (let source = 0; source < nodes.length; source += 1) {
    for (let target = source + 1; target < nodes.length; target += 1) {
      const weight = similarity(`${nodes[source].title} ${nodes[source].content}`, `${nodes[target].title} ${nodes[target].content}`);
      if (weight >= 0.12) edges.push({ source, target, weight });
    }
  }
  return edges.slice(0, 160);
}

export function VisualKnowledgeGraph({ nodes, onNodeSelect, className = '' }: { nodes: KnowledgeNode[]; onNodeSelect?: (node: KnowledgeNode) => void; className?: string }) {
  const [selected, setSelected] = useState<string | null>(null);
  const edges = useMemo(() => buildEdges(nodes), [nodes]);
  const positions = useMemo(() => nodes.map((_, index) => {
    const angle = (index / Math.max(nodes.length, 1)) * Math.PI * 2;
    const radius = Math.min(145, 58 + nodes.length * 4);
    return { x: 210 + Math.cos(angle) * radius, y: 145 + Math.sin(angle) * radius * 0.72 };
  }), [nodes]);

  if (!nodes.length) return <div className={`rounded-2xl border border-slate-700 bg-slate-950 p-6 text-sm text-slate-400 ${className}`}>ナレッジノードがまだありません。ローカルノートを同期すると、関連性グラフを生成します。</div>;

  return (
    <section className={`rounded-2xl border border-slate-700 bg-slate-950 p-4 shadow-lg ${className}`} aria-label="Visual knowledge graph">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div><h3 className="text-sm font-semibold text-slate-100">Knowledge Graph</h3><p className="text-xs text-slate-400">端末内だけで関連度を計算</p></div>
        <span className="text-xs tabular-nums text-cyan-300">{nodes.length} nodes · {edges.length} links</span>
      </div>
      <svg viewBox="0 0 420 290" className="h-auto w-full overflow-visible" role="img" aria-label="関連ノードグラフ">
        <rect x="0" y="0" width="420" height="290" rx="18" className="fill-slate-950" />
        {edges.map((edge) => {
          const a = positions[edge.source]; const b = positions[edge.target];
          return <line key={`${edge.source}-${edge.target}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} className="stroke-cyan-400/30" strokeWidth={Math.max(0.7, edge.weight * 4)} />;
        })}
        {nodes.map((node, index) => {
          const position = positions[index]; const active = selected === node.id;
          return (
            <g key={node.id} role="button" tabIndex={0} aria-label={node.title} onClick={() => { setSelected(node.id); onNodeSelect?.(node); }} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setSelected(node.id); onNodeSelect?.(node); } }} className="cursor-pointer">
              <circle cx={position.x} cy={position.y} r={active ? 10 : 7} className={active ? 'fill-emerald-300 stroke-emerald-100' : 'fill-cyan-300 stroke-cyan-100'} strokeWidth="2" />
              <text x={position.x} y={position.y - 13} textAnchor="middle" className="fill-slate-200 text-[9px]">{node.title.slice(0, 22)}</text>
            </g>
          );
        })}
      </svg>
      {selected && <p className="mt-2 text-xs text-slate-400">選択したノードの文脈をチャット入力へ渡せます。</p>}
    </section>
  );
}
