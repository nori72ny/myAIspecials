import React from 'react';
import type { ArtifactBlock } from '../../App';

type OriginArtifactContextV31Props = {
  artifacts: readonly ArtifactBlock[];
};

export default function OriginArtifactContextV31({ artifacts }: OriginArtifactContextV31Props) {
  if (artifacts.length === 0) return null;

  const latest = artifacts.at(-1)!;
  const completed = latest.isComplete;

  return <section aria-label="Artifact layer" className="origin-surface-muted border-b px-3 py-2 sm:px-5">
    <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center gap-2 text-sm">
      <span className="origin-badge inline-flex min-h-8 items-center border px-3 text-xs font-bold">Artifact</span>
      <span className="font-semibold">{artifacts.length}件</span>
      <span className="origin-muted">最新:</span>
      <span className="max-w-full truncate font-semibold">{latest.title}</span>
      <span className="origin-badge inline-flex min-h-8 items-center border px-3 text-xs font-bold">{completed ? 'Ready' : 'Generating'}</span>
      <span className="origin-muted ml-auto text-xs">成果物がある時だけ表示 · 会話とは独立した成果物レイヤー</span>
    </div>
  </section>;
}
