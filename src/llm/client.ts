import { createGoogleGenerativeAI } from "@ai-sdk/google";

import { env } from "@/env";

// Each project supplies its own Gemini API key (see project/set-gemini-key.ts) —
// there's no shared key for Spud to manage, so this builds a model per call
// rather than once at module load.
export function getModel(apiKey: string) {
  return createGoogleGenerativeAI({ apiKey })(env.GEMINI_MODEL_NAME);
}
