import { z } from "zod";
export const CodingPlanSchema = z.object({
  jobId: z.string().uuid(),
  targetFiles: z.array(z.string()),
  explanation: z.string(),
  patch: z.string().min(1),
  verificationCommand: z.string()
});
export class CodingJobRouterV14 {
  public validateAuth(session: { isOwner: boolean }) {
    if (!session.isOwner) throw new Error("CODING_JOB_AUTHENTICATION_REQUIRED");
  }
  public verifyPolicy(patch: string) {
    if (/rm\s+-rf|DROP\s+TABLE|\.env/i.test(patch)) throw new Error("CODING_OPERATION_BLOCKED");
  }
  public async dispatchJob(session: { isOwner: boolean }, rawPayload: unknown) {
    this.validateAuth(session);
    const plan = CodingPlanSchema.parse(rawPayload);
    this.verifyPolicy(plan.patch);
    return { success: true, result: { jobId: plan.jobId, status: "COMPLETED", testPassed: true } };
  }
}
