import { generateText, Output } from "ai";
import { z } from "zod";

import { model } from "@/llm/client";
import { CLAIM_ANALYSIS_SYSTEM_PROMPT } from "@/llm/prompts/claim-analysis";

const outputSchema = z.object({
  overlappingTask: z
    .string()
    .nullable()
    .describe("The exact matching claimed task description if this looks like a duplicate, otherwise null"),
  branchName: z.string().describe('Git branch name in "<type>/<kebab-slug>" format, per the naming rules'),
});

export interface ClaimAnalysis {
  overlappingTask: string | null;
  branchName: string;
}

export async function analyzeClaim(description: string, claimedDescriptions: string[]): Promise<ClaimAnalysis> {
  const claimedList =
    claimedDescriptions.length > 0
      ? `Already-claimed task descriptions on this project:\n${claimedDescriptions.map((d) => `- ${d}`).join("\n")}`
      : "There are no currently claimed tasks on this project.";

  const { output } = await generateText({
    model,
    output: Output.object({
      schema: outputSchema,
    }),
    system: CLAIM_ANALYSIS_SYSTEM_PROMPT,
    prompt: `New task description: "${description}"\n\n${claimedList}`,
  });

  return output;
}
