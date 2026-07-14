import fs from "node:fs";

const files = [
  "src/legacy/analyzeRoute.ts",
  "src/legacy/legacyRoutes.ts"
];

const needle = "const orgState = await organizationExecutorInstance.executeMission(missionId, prompt);";
const replacement = `const orgState = await organizationExecutorInstance.executeMission(
          missionId,
          prompt,
          undefined,
          {
            onApprovalRequired: async (request, executor) => {
              executor.resolveHumanApproval(
                request.orgId,
                request.id,
                true,
                "System-approved non-interactive API analysis"
              );
            }
          }
        );`;

for (const file of files) {
  const source = fs.readFileSync(file, "utf8");
  if (!source.includes(needle)) {
    throw new Error(`Expected executeMission call was not found in ${file}`);
  }
  fs.writeFileSync(file, source.replace(needle, replacement));
}
