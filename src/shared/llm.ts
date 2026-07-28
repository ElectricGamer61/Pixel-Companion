import type { ModelSettings } from './types';

export interface ChatMessage {
  role: string;
  content: string;
}

/**
 * Optional bridge to a local, OpenAI-compatible chat-completions server.
 *
 * This is entirely opt-in and off by default. It exists so a user who already
 * runs Ollama, llama.cpp's server, or LM Studio can point the companion at it
 * without any code changes, and so a bring-your-own-key endpoint is possible
 * later. Nothing here is required for the app to work: every failure path
 * returns null and the caller falls back to the offline rule-based responder.
 */
export async function askLocalModel(
  settings: ModelSettings,
  system: string,
  history: ChatMessage[],
  fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
  if (!settings.enabled || !settings.endpoint.trim()) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), settings.timeoutMs);
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (settings.apiKey.trim()) headers.Authorization = `Bearer ${settings.apiKey.trim()}`;

    const response = await fetchImpl(settings.endpoint, {
      method: 'POST',
      headers,
      signal: controller.signal,
      body: JSON.stringify({
        model: settings.model,
        stream: false,
        temperature: 0.7,
        max_tokens: 220,
        messages: [{ role: 'system', content: system }, ...history],
      }),
    });
    if (!response.ok) return null;
    const payload: unknown = await response.json();
    return extractReply(payload);
  } catch {
    // Timeout, refused connection, bad JSON: fall back to the offline rules.
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Accept both the OpenAI chat shape and Ollama's native `/api/chat` shape. */
export function extractReply(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const body = payload as Record<string, unknown>;

  const choices = body.choices;
  if (Array.isArray(choices) && choices.length > 0) {
    const message = (choices[0] as Record<string, unknown>)?.message as
      | Record<string, unknown>
      | undefined;
    const content = message?.content;
    if (typeof content === 'string' && content.trim()) return content.trim();
  }

  const message = body.message as Record<string, unknown> | undefined;
  if (typeof message?.content === 'string' && message.content.trim()) {
    return message.content.trim();
  }

  if (typeof body.response === 'string' && body.response.trim()) {
    return body.response.trim();
  }

  return null;
}
