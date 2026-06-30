import { Deliverable, Review, ReviewStatus, OrgRole } from "./OrganizationTypes";

export class ReviewEngine {
  /**
   * Determines how many reviewers are needed based on the task priority.
   * Higher priority tasks require more rigorous peer checks.
   * Min: 2, Max: 5.
   */
  public getRequiredReviewerCount(priority: number): number {
    if (priority <= 3) return 2;
    if (priority <= 6) return 3;
    if (priority <= 8) return 4;
    return 5;
  }

  /**
   * Selects review agents from the organization structure.
   * Ensures the author is not selected, and restricts selected agents to appropriate roles.
   */
  public selectReviewers(
    deliverable: Deliverable,
    allAgentIds: string[],
    roleMapping: Record<string, OrgRole>,
    requiredCount: number
  ): string[] {
    const candidateIds = allAgentIds.filter(id => id !== deliverable.authorAgentId);
    
    // Sort candidates so that higher role hierarchy gets prioritized first for reviews (Manager, Director, Chief, Board)
    const rolePriority: Record<OrgRole, number> = {
      [OrgRole.CEO]: 6,
      [OrgRole.BOARD]: 5,
      [OrgRole.CHIEF]: 4,
      [OrgRole.DIRECTOR]: 3,
      [OrgRole.MANAGER]: 2,
      [OrgRole.WORKER]: 1
    };

    candidateIds.sort((a, b) => {
      const roleA = roleMapping[a] || OrgRole.WORKER;
      const roleB = roleMapping[b] || OrgRole.WORKER;
      return rolePriority[roleB] - rolePriority[roleA];
    });

    return candidateIds.slice(0, Math.min(requiredCount, candidateIds.length));
  }

  /**
   * Conducts a single agent review on a deliverable.
   */
  public conductSingleReview(
    reviewerId: string,
    deliverable: Deliverable,
    role: OrgRole
  ): Review {
    // Generate realistic scores and constructive feedbacks based on role capabilities
    let baseScore = 60 + Math.floor(Math.random() * 35); // 60 to 95
    
    // Stiffer standards for high-level executives
    if (role === OrgRole.DIRECTOR) baseScore -= 2;
    if (role === OrgRole.CHIEF) baseScore -= 5;
    if (role === OrgRole.BOARD) baseScore -= 8;

    // Clamp score
    const score = Math.max(1, Math.min(100, baseScore));
    const status = score >= 70 ? ReviewStatus.APPROVED : ReviewStatus.REJECTED;

    let feedback = "";
    if (status === ReviewStatus.APPROVED) {
      feedback = `Excellent work on this deliverable. The code and architecture align perfectly with corporate objectives. Verified by ${role}.`;
    } else {
      feedback = `Underperforming content. Requires immediate revision. Score of ${score} is below threshold. Please improve modularity and error handling. Noted by ${role}.`;
    }

    return {
      id: `rev-${Math.random().toString(36).substring(2, 9)}`,
      deliverableId: deliverable.id,
      reviewerAgentId: reviewerId,
      score,
      feedback,
      status,
      createdAt: new Date()
    };
  }

  /**
   * Summarizes a list of reviews to check if they have general consensus or need a debate.
   */
  public evaluateOverallReview(reviews: Review[]): {
    decision: ReviewStatus | "SPLIT";
    averageScore: number;
    approvedCount: number;
    rejectedCount: number;
  } {
    if (reviews.length === 0) {
      return { decision: ReviewStatus.REJECTED, averageScore: 0, approvedCount: 0, rejectedCount: 0 };
    }

    let totalScore = 0;
    let approvedCount = 0;
    let rejectedCount = 0;

    for (const review of reviews) {
      totalScore += review.score;
      if (review.status === ReviewStatus.APPROVED) {
        approvedCount++;
      } else {
        rejectedCount++;
      }
    }

    const averageScore = Math.round(totalScore / reviews.length);
    let decision: ReviewStatus | "SPLIT" = "SPLIT";

    if (approvedCount === reviews.length) {
      decision = ReviewStatus.APPROVED;
    } else if (rejectedCount === reviews.length) {
      decision = ReviewStatus.REJECTED;
    } else {
      decision = "SPLIT"; // Triggers consensus engine
    }

    return {
      decision,
      averageScore,
      approvedCount,
      rejectedCount
    };
  }
}
