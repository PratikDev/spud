import { env } from "@/env";
import { google } from "@ai-sdk/google";

export const model = google(env.GEMINI_MODEL_NAME);
