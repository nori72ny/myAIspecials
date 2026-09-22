import React from 'react';

export type OriginRuntimeActivityKindV31 = 'research' | 'agent' | 'tool' | 'approval' | 'verification';
export type OriginRuntimeActivityStatusV31 = 'queued' | 'running' | 'awaiting_approval' | 'verifying' | 'completed' | 'blocked' | 'failed' | 'cancelled';

export type OriginRuntimeActivityV31 = {
  id: string;
  kind: OriginRuntimeActivityKindV31;
  status: OriginRuntimeActivityStatusV31;
  title: string;
  detail: string;
  evidence?: string;
};

type OriginRuntimeActivityTimelineV31Props = {
  activities: readonly OriginRuntimeActivityV31[];
  compact?: boolean;
};

const KIND_LABEL: Record<OriginRuntimeActivityKindV31, string> = {
  research: 'Research',
  agent: 'Agent',
  tool: 'Tool',
  approval: 'Approval',
  verification: 'Verification',
};

const STATUS_LABEL: Record<OriginRuntimeActivityStatusV31, string> = {
  queued: '待機',
  running: '実行中',
  awaiting_approval: '承認待ち',
  verifying: '検証中',
  completed: '完了',
  blocked: '停止',
  failed: '失敗',
  cancelled: '取消済み',
};

function statusClass(status: OriginRuntimeActivityStatusV31): string {
  if (status === 'completed') return 'border-emerald-300 text-emerald-800 dark:border-emerald-800 dark:text-emerald-200';
  if (status === 'blocked' || status === 'failed' || status === 'cancelled') return 'border-amber-300 text-amber-900 dark:border-amber-800 dark:text-amber-200';
  if (status === 'awaiting_approval') return 'border-violet-300 text-violet-800 dark:border-violet-800 dark:text-violet-200';
  return 'border-indigo-300 text-indigo-800 dark:border-indigo-800 dark:text-indigo-200';
}

export default function OriginRuntimeActivityTimelineV31({ activities, compact = false }: OriginRuntimeActivityTimelineV31Props) {
  if (!activities.length) return null;
  const visibleActivities = compact ? activities.slice(-1) : activities;
  return <section data-testid="origin-runtime-activity-timeline" aria-label="ORIGIN runtime activity" aria-live="polite" className={compact ? 'w-full' : 'grid gap-2'}>
    {visibleActivities.map(activity => {
      const active = activity.status === 'queued' || activity.status === 'running' || activity.status === 'awaiting_approval' || activity.status === 'verifying';
      return <details key={activity.id} open={compact ? false : active} className={compact ? 'rounded-xl px-1 py-0.5' : 'origin-surface-muted rounded-xl border border-origin-border px-3 py-2'}>
        <summary className={`flex min-h-11 cursor-pointer list-none items-center gap-2 ${compact ? 'text-[13px]' : 'text-sm'}`}>
          <span className="origin-muted shrink-0 text-[11px] font-black uppercase tracking-wide">{KIND_LABEL[activity.kind]}</span>
          <strong className="min-w-0 flex-1 truncate">{activity.title}</strong>
          <span data-testid={`runtime-activity-status-${activity.id}`} className={`shrink-0 rounded-full border px-2 py-1 text-[11px] font-bold ${statusClass(activity.status)}`}>{STATUS_LABEL[activity.status]}</span>
        </summary>
        <div className="pb-2 pl-0 text-[13px] leading-5">
          <p className="m-0">{activity.detail}</p>
          {activity.evidence && <p className="origin-muted mb-0 mt-1 break-words text-[11px]">{activity.evidence}</p>}
        </div>
      </details>;
    })}
  </section>;
}
