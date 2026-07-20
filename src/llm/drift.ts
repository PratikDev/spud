import { generateText, Output } from "ai";
import { z } from "zod";

import type { ChangedFile } from "@/github/compare";
import { model } from "@/llm/client";
import { DRIFT_SYSTEM_PROMPT } from "@/llm/prompts/drift";

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

  const { output } = await generateText({
    model,
    output: Output.object({ schema: outputSchema }),
    system: DRIFT_SYSTEM_PROMPT,
    prompt: `Task description: "${taskDescription}"\n\nChanged files:\n${fileList}`,
  });

  return output;
}
