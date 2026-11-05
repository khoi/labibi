import type { Api, Model, SimpleStreamOptions } from "@earendil-works/pi-ai";

// https://platform.claude.com/docs/en/build-with-claude/fast-mode
const FAST_MODELS = new Set(["claude-opus-5-5"]);
const FAST_PRICE_MULTIPLIER = 2;

export function isAnthropicFastModel(model: Pick<Model<Api>, "provider" | "api" | "id">): boolean {
  return (
    model.provider === "anthropic" &&
    model.api === "anthropic-messages" &&
    FAST_MODELS.has(model.id)
  );
}

/** Fast mode bills every token class at a multiple of the standard rate. */
export function withAnthropicFastPricing<M extends Model<Api>>(model: M): M {
  if (!isAnthropicFastModel(model) || !model.cost) return model;
  const { input, output, cacheRead, cacheWrite } = model.cost;
  return {
    ...model,
    cost: {
      ...model.cost,
      input: input * FAST_PRICE_MULTIPLIER,
      output: output * FAST_PRICE_MULTIPLIER,
      cacheRead: cacheRead * FAST_PRICE_MULTIPLIER,
      cacheWrite: cacheWrite * FAST_PRICE_MULTIPLIER,
    },
  };
}

export function withAnthropicFastMode<O extends SimpleStreamOptions>(
  model: Pick<Model<Api>, "provider" | "api" | "id">,
  options: O,
): O {
  if (!isAnthropicFastModel(model)) return options;
  const previous = options.onPayload;
  return {
    ...options,
    async onPayload(payload, requestModel) {
      const replaced = (await previous?.(payload, requestModel)) ?? payload;
      return isRecord(replaced) ? { ...replaced, speed: "fast" } : replaced;
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}
