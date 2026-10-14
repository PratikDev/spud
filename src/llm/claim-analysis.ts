import { generateText, Output } from "ai";
import { z } from "zod";

import { getModel } from "@/llm/client";
import { CLAIM_ANALYSIS_SYSTEM_PROMPT } from "@/llm/prompts/claim-analysis";
import { createLogger } from "@/logger";

const log = createLogger("llm/claim-analysis");

const outputSchema = z.object({
  overlappingTask: z
    .string()
    .nullable()
    .describe("The exact matching claimed task description if this looks like a duplicate, otherwise null"),
});

export interface ClaimAnalysis {
  overlappingTask: string | null;
}

export async function analyzeClaim(description: string, claimedDescriptions: string[]): Promise<ClaimAnalysis> {
  const claimedList =
    claimedDescriptions.length > 0
      ? `Already-claimed task descriptions on this project:\n${claimedDescriptions.map((d) => `- ${d}`).join("\n")}`
      : "There are no currently claimed tasks on this project.";

  try {
    const { output } = await generateText({
      model: getModel(),
      output: Output.object({
        schema: outputSchema,
      }),
      system: CLAIM_ANALYSIS_SYSTEM_PROMPT,
      prompt: `New task description: "${description}"\n\n${claimedList}`,
      timeout: { totalMs: 15_000 },
    });

    log.info("Analyzed claim", { description, overlappingTask: output.overlappingTask });
    return output;
  } catch (error) {
    log.error("Failed to analyze claim", { description, error: String(error) });
    throw error;
  }
}
