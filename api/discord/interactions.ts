import { handleInteractionsRequest } from "../../src/discord/interactions";

export async function POST(request: Request): Promise<Response> {
  return handleInteractionsRequest(request);
}
