// AnthropicMessagesProvider over a stubbed fetch — no network, no API key.
import { describe, expect, it } from "vitest";
import { AnthropicMessagesProvider } from "../provider";

const JSON_RESPONSE = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

describe("AnthropicMessagesProvider", () => {
  it("sends a Messages API request and returns the first text block", async () => {
    const captured: { url?: string; init?: RequestInit } = {};
    const provider = new AnthropicMessagesProvider({
      apiKey: "test-key",
      model: "claude-test",
      fetchImpl: async (url, init) => {
        captured.url = String(url);
        captured.init = init ?? {};
        return JSON_RESPONSE({
          content: [
            { type: "text", text: "hello " },
            { type: "text", text: "world" },
          ],
        });
      },
    });

    const result = await provider.complete({ system: "sys", user: "usr", maxTokens: 100 });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe("hello \nworld");

    expect(captured.url).toBe("https://api.anthropic.com/v1/messages");
    const init = captured.init ?? {};
    const headers = new Headers(init.headers);
    expect(headers.get("x-api-key")).toBe("test-key");
    expect(headers.get("anthropic-version")).toBe("2023-06-01");
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body).toMatchObject({ model: "claude-test", max_tokens: 100, system: "sys" });
    expect(body.messages).toEqual([{ role: "user", content: "usr" }]);
  });

  it("falls back to the AI_MODEL env var when no model is given", async () => {
    const previous = process.env.AI_MODEL;
    process.env.AI_MODEL = "claude-from-env";
    try {
      let capturedBody: Record<string, unknown> | null = null;
      const provider = new AnthropicMessagesProvider({
        apiKey: "k",
        fetchImpl: async (_url, init) => {
          capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
          return JSON_RESPONSE({ content: [{ type: "text", text: "ok" }] });
        },
      });
      await provider.complete({ system: "s", user: "u", maxTokens: 10 });
      expect(capturedBody).toMatchObject({ model: "claude-from-env" });
    } finally {
      if (previous === undefined) delete process.env.AI_MODEL;
      else process.env.AI_MODEL = previous;
    }
  });

  it("maps HTTP errors to AI_PROVIDER_ERROR", async () => {
    const provider = new AnthropicMessagesProvider({
      apiKey: "k",
      fetchImpl: async () => JSON_RESPONSE({ error: { message: "overloaded" } }, 529),
    });
    const result = await provider.complete({ system: "s", user: "u", maxTokens: 10 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("AI_PROVIDER_ERROR");
      expect(result.error.details).toEqual([{ path: "status", message: "529" }]);
    }
  });

  it("maps network failures to AI_PROVIDER_ERROR", async () => {
    const provider = new AnthropicMessagesProvider({
      apiKey: "k",
      fetchImpl: async () => {
        throw new Error("ECONNREFUSED");
      },
    });
    const result = await provider.complete({ system: "s", user: "u", maxTokens: 10 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("AI_PROVIDER_ERROR");
  });

  it("flags replies without any text content", async () => {
    const provider = new AnthropicMessagesProvider({
      apiKey: "k",
      fetchImpl: async () => JSON_RESPONSE({ content: [{ type: "tool_use" }] }),
    });
    const result = await provider.complete({ system: "s", user: "u", maxTokens: 10 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("AI_PROVIDER_ERROR");
  });
});
