// XOVIA — server-side AI gateway (OpenAI-compatible).
// Reads the environmental schema: XOVIA_AI_API_KEY, XOVIA_AI_BASE_URL, XOVIA_AI_MODEL.
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

export const AI_MODEL_ID = process.env.XOVIA_AI_MODEL || "google/gemini-2.5-flash";

export function createXoviaAiProvider(apiKey: string) {
  return createOpenAICompatible({
    name: "xovia",
    baseURL: process.env.XOVIA_AI_BASE_URL || "https://api.xovia.ai/v1",
    headers: { "X-XOVIA-SDK": "vercel-ai-sdk" },
    apiKey,
  });
}
