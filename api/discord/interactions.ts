import { handleInteractionsRequest } from "../../src/discord/interactions.ts";

export async function POST(request: Request): Promise<Response> {
  return handleInteractionsRequest(request);
}
