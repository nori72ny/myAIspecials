import React from 'react';
import CodingJobWorkspaceV14, { type CodingProjectEvidence } from '../CodingJobWorkspaceV14';

type CodingWorkspaceV31Props = { initialGoal?: string; onProjectEvidenceChange?: (evidence: CodingProjectEvidence) => void };

export default function CodingWorkspaceV31({ initialGoal, onProjectEvidenceChange }: CodingWorkspaceV31Props) {
  return <section aria-label="ORIGIN Coding Workspace" className="min-h-0">
    <CodingJobWorkspaceV14 initialGoal={initialGoal} onProjectEvidenceChange={onProjectEvidenceChange} />
  </section>;
}
