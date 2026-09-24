import React from 'react';
import CodingJobWorkspaceV14, { type CodingProjectEvidence } from '../CodingJobWorkspaceV14';

type CodingWorkspaceV31Props = { onProjectEvidenceChange?: (evidence: CodingProjectEvidence) => void };

export default function CodingWorkspaceV31({ onProjectEvidenceChange }: CodingWorkspaceV31Props) {
  return <section aria-label="ORIGIN Coding Workspace" className="min-h-0">
    <CodingJobWorkspaceV14 onProjectEvidenceChange={onProjectEvidenceChange} />
  </section>;
}
