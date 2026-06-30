import { Review, ConsensusOpinion, ConsensusRound, ReviewStatus } from "./OrganizationTypes";

export class ConsensusEngine {
  /**
   * Triggers a discussion between reviewers who had a split vote.
   * Reviewers exchange arguments to align on a final consolidated decision.
   */
  public resolveConflict(
    reviews: Review[], 
    deliverableId: string, 
    roleMapping: Record<string, string>
  ): ConsensusRound {
    const opinions: ConsensusOpinion[] = [];
    
    // Step 1: Initialize initial stances of reviewers
    for (const r of reviews) {
      const role = roleMapping[r.reviewerAgentId] || "WORKER";
      let argument = "";
      
      if (r.status === ReviewStatus.APPROVED) {
        argument = `[Initial Approval from ${role}] This meets 100% of our core functional criteria and shouldn't be blocked by minor styling details. I stand by the score of ${r.score}.`;
      } else {
        argument = `[Initial Rejection from ${role}] Disagree. There are critical architectural loose-ends and security validations that we cannot pass over. Safety first! Score: ${r.score}.`;
      }

      opinions.push({
        agentId: r.reviewerAgentId,
        argument,
        score: r.score,
        approved: r.status === ReviewStatus.APPROVED
      });
    }

    // Step 2: Debate Round (Reviewers exchange reasoning and adjust stances)
    // We simulate two steps of dialogue where they reconcile differences
    const debateLog: string[] = ["--- DEBATE LOGS START ---"];
    
    // Rejection points are consolidated
    const rejections = opinions.filter(o => !o.approved);
    const approvals = opinions.filter(o => o.approved);

    // Let's create an exchange of arguments
    if (rejections.length > 0 && approvals.length > 0) {
      debateLog.push(`[System] Initiate consensus negotiation between Approvers [${approvals.map(a => a.agentId).join(", ")}] and Rejecters [${rejections.map(r => r.agentId).join(", ")}].`);
      
      const mainRejector = rejections[0];
      const mainApprover = approvals[0];

      debateLog.push(`[Agent ${mainRejector.agentId}] "We must address the structural integrity. Passing this with these errors is a risk to system governance."`);
      debateLog.push(`[Agent ${mainApprover.agentId}] "I understand the concern. Can we agree on a specific list of 3 items for immediate correction instead of an outright block?"`);
      debateLog.push(`[Agent ${mainRejector.agentId}] "Agreed, if they patch those 3 gaps, I am willing to compromise on approval. Otherwise, it must be sent back."`);
    }

    // Step 3: Determine final verdict based on compromise rules
    // If the rejection concerns are heavy (average initial score < 60), rejection wins for quality control.
    // Otherwise, we compromise with a conditioned REJECT (to prompt a quick revision) with clear bullet-pointed reasons,
    // or an overall conditionally APPROVED if the average score is high.
    const averageInitialScore = reviews.reduce((sum, r) => sum + r.score, 0) / reviews.length;
    let finalVerdict = ReviewStatus.REJECTED;
    let rational = "";

    if (averageInitialScore >= 75) {
      finalVerdict = ReviewStatus.APPROVED;
      rational = `[Consensus Achieved: APPROVED] After exchange of arguments, the committee compromised on an approval. Approving reviewers convinced the group that the codebase is ready, but notes were added to solve secondary issues in the next sprint. Adjusted consensus score is ${Math.round(averageInitialScore)}.`;
    } else {
      finalVerdict = ReviewStatus.REJECTED;
      rational = `[Consensus Achieved: REJECTED with conditions] The committee unanimously decided to reject and send back. Approvers conceded that security and architectural vulnerabilities pointed out by rejecters are blocking hazards that must be fixed immediately.`;
    }

    debateLog.push(`[System] Consensus reached. Final Verdict: ${finalVerdict}.`);

    return {
      id: `con-${Math.random().toString(36).substring(2, 9)}`,
      deliverableId,
      proposals: opinions,
      finalVerdict,
      rational: `${rational}\n\nDebate Summary:\n${debateLog.join("\n")}`,
      resolvedAt: new Date()
    };
  }
}
