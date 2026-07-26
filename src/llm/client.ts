import { google } from "@ai-sdk/google";

import { env } from "@/env";
import { createLogger } from "@/logger";

const log = createLogger("llm/client");

export const model = google(env.GEMINI_MODEL_NAME);
log.info("Initialized Gemini model", { model: env.GEMINI_MODEL_NAME });
