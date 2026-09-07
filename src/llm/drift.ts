import { generateText, Output } from "ai";
import { z } from "zod";

import type { ChangedFile } from "@/github/compare";
import { model } from "@/llm/client";
import { DRIFT_SYSTEM_PROMPT } from "@/llm/prompts/drift";
import { createLogger } from "@/logger";

const log = createLogger("llm/drift");

const outputSchema = z.object({
  isDrifted: z.boolean().describe("Whether the changed files look inconsistent with the task description"),
  reason: z.string().nullable().describe("Short reason when isDrifted is true, otherwise null"),
});

export interface DriftAnalysis {
  isDrifted: boolean;
  reason: string | null;
}

export async function analyzeDrift(taskDescription: string, changedFiles: ChangedFile[]): Promise<DriftAnalysis> {
  const fileList = changedFiles.map((file) => `- ${file.filename} (${file.status})`).join("\n");

  try {
    const { output } = await generateText({
      model,
      output: Output.object({ schema: outputSchema }),
      system: DRIFT_SYSTEM_PROMPT,
      prompt: `Task description: "${taskDescription}"\n\nChanged files:\n${fileList}`,
      timeout: { totalMs: 15_000 },
    });

    log.info("Analyzed drift", { taskDescription, isDrifted: output.isDrifted, reason: output.reason });
    return output;
  } catch (error) {
    log.error("Failed to analyze drift", { taskDescription, error: String(error) });
    throw error;
  }
}
