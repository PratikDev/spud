import { createGoogleGenerativeAI } from "@ai-sdk/google";

import { env } from "@/env";

export function getModel() {
  return createGoogleGenerativeAI({ apiKey: env.GEMINI_API_KEY })(env.GEMINI_MODEL_NAME);
}
