import React from 'react';
import CodingJobWorkspaceV14 from '../CodingJobWorkspaceV14';

type CodingWorkspaceV31Props = { initialGoal?: string };

export default function CodingWorkspaceV31({ initialGoal }: CodingWorkspaceV31Props) {
  return <section aria-label="ORIGIN Coding Workspace" className="min-h-0">
    <CodingJobWorkspaceV14 initialGoal={initialGoal} />
  </section>;
}
