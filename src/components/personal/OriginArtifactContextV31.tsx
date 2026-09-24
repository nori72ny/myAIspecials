import React from 'react';
import type { ArtifactBlock } from '../../App';

type OriginArtifactContextV31Props = {
  artifacts: readonly ArtifactBlock[];
};

export default function OriginArtifactContextV31({ artifacts }: OriginArtifactContextV31Props) {
  if (artifacts.length === 0) return null;

  const latest = artifacts.at(-1)!;

  return <section aria-label="Artifact layer" className="origin-surface-muted shrink-0 border-b px-3 py-2 sm:px-5">
    <div className="mx-auto flex w-full max-w-7xl items-center gap-2 text-sm">
      <span className="shrink-0 font-bold">成果物</span>
      <span className="origin-muted min-w-0 flex-1 truncate">{latest.title}</span>
      <span className="origin-muted shrink-0 text-xs">{latest.isComplete ? '完成' : '生成中'}</span>
    </div>
  </section>;
}
