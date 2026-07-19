function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

export const env = {
  DISCORD_TOKEN: requireEnv("DISCORD_TOKEN"),
  DISCORD_CLIENT_ID: requireEnv("DISCORD_CLIENT_ID"),
  GOOGLE_GENERATIVE_AI_API_KEY: requireEnv("GOOGLE_GENERATIVE_AI_API_KEY"),
  GEMINI_MODEL_NAME: requireEnv("GEMINI_MODEL_NAME"),
};
