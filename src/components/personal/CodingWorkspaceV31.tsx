import React from 'react';
import CodingJobWorkspaceV14 from '../CodingJobWorkspaceV14';

type CodingWorkspaceV31Props = { initialGoal?: string; onOpenSettings?: (section?: 'coding') => void };

export default function CodingWorkspaceV31({ initialGoal, onOpenSettings }: CodingWorkspaceV31Props) {
  return <section aria-label="ORIGIN Coding Workspace" className="h-full min-h-0">
    <CodingJobWorkspaceV14 initialGoal={initialGoal} onOpenSettings={onOpenSettings} />
  </section>;
}
