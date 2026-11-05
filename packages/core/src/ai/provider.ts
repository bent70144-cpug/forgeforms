// AiProvider — the only seam between FormForge and an LLM (spec §15 M8).
// Tests always inject a FakeProvider with fixture responses; the Anthropic
// Messages implementation below uses plain fetch (no SDK, spec-pinned).
import { AppError, err, ok, type Result } from "../bridge";

export type AiCompletionRequest = {
  system: string;
  user: string;
  /** Upper bound for the model reply; JSON documents stay well under this. */
  maxTokens: number;
  temperature?: number;
};

export type AiProvider = {
  /** Returns the raw text of the model reply (first text block). */
  complete(request: AiCompletionRequest): Promise<Result<string>>;
};

export const ANTHROPIC_DEFAULT_MODEL = "claude-sonnet-4-6";
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";

type AnthropicMessagesResponse = {
  content?: Array<{ type: string; text?: string }>;
  error?: { type?: string; message?: string };
};

export type AnthropicProviderOptions = {
  apiKey: string;
  /** Defaults to AI_MODEL env, then ANTHROPIC_DEFAULT_MODEL (spec §5). */
  model?: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
};

export class AnthropicMessagesProvider implements AiProvider {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: AnthropicProviderOptions) {
    this.apiKey = options.apiKey;
    this.model = options.model ?? process.env.AI_MODEL ?? ANTHROPIC_DEFAULT_MODEL;
    this.baseUrl = options.baseUrl ?? ANTHROPIC_URL;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async complete(request: AiCompletionRequest): Promise<Result<string>> {
    let response: Response;
    try {
      response = await this.fetchImpl(this.baseUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": this.apiKey,
          "anthropic-version": ANTHROPIC_VERSION,
        },
        body: JSON.stringify({
          model: this.model,
          max_tokens: request.maxTokens,
          temperature: request.temperature ?? 0.2,
          system: request.system,
          messages: [{ role: "user", content: request.user }],
        }),
      });
    } catch (cause) {
      return err(
        new AppError("AI_PROVIDER_ERROR", "AI provider is unreachable", [
          { path: "cause", message: String(cause) },
        ]),
      );
    }

    if (!response.ok) {
      return err(
        new AppError("AI_PROVIDER_ERROR", "AI provider returned an error response", [
          { path: "status", message: String(response.status) },
        ]),
      );
    }

    let data: AnthropicMessagesResponse;
    try {
      data = (await response.json()) as AnthropicMessagesResponse;
    } catch {
      return err(
        new AppError("AI_PROVIDER_ERROR", "AI provider returned a non-JSON response"),
      );
    }

    const text = (data.content ?? [])
      .filter((part) => part.type === "text" && typeof part.text === "string")
      .map((part) => part.text as string)
      .join("\n");

    if (text.length === 0) {
      return err(
        new AppError("AI_PROVIDER_ERROR", "AI provider returned no text content", [
          { path: "contentTypeCount", message: String((data.content ?? []).length) },
        ]),
      );
    }

    return ok(text);
  }
}
