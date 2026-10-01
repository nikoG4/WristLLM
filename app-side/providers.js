const REQUEST_TIMEOUT_MS = 30000;
const MAX_REPLY_CHARS = 6000;

export const DEFAULT_SYSTEM_PROMPT =
  "You are replying inside a smartwatch chat app. Keep answers concise and easy to read on a small screen. Prefer short paragraphs and simple bullets. Avoid markdown tables, long preambles, and unnecessary repetition.";

export const PROVIDER_PRESETS = {
  gemini: {
    id: "gemini",
    label: "Google Gemini",
    transport: "gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    model: "gemini-2.5-flash",
    requiresKey: true,
  },
  openai: {
    id: "openai",
    label: "OpenAI",
    transport: "openai-compatible",
    baseUrl: "https://api.openai.com/v1",
    model: "",
    requiresKey: true,
  },
  openrouter: {
    id: "openrouter",
    label: "OpenRouter",
    transport: "openai-compatible",
    baseUrl: "https://openrouter.ai/api/v1",
    model: "",
    requiresKey: true,
  },
  groq: {
    id: "groq",
    label: "Groq",
    transport: "openai-compatible",
    baseUrl: "https://api.groq.com/openai/v1",
    model: "openai/gpt-oss-20b",
    requiresKey: true,
  },
  mistral: {
    id: "mistral",
    label: "Mistral AI",
    transport: "openai-compatible",
    baseUrl: "https://api.mistral.ai/v1",
    model: "mistral-small-latest",
    requiresKey: true,
  },
  deepseek: {
    id: "deepseek",
    label: "DeepSeek",
    transport: "openai-compatible",
    baseUrl: "https://api.deepseek.com",
    model: "deepseek-flash",
    requiresKey: true,
  },
  anthropic: {
    id: "anthropic",
    label: "Anthropic Claude",
    transport: "anthropic",
    baseUrl: "https://api.anthropic.com/v1",
    model: "",
    requiresKey: true,
  },
  custom: {
    id: "custom",
    label: "Custom / local",
    transport: "openai-compatible",
    baseUrl: "",
    model: "",
    requiresKey: false,
  },
};

export function getPreset(providerId) {
  return PROVIDER_PRESETS[providerId] || PROVIDER_PRESETS.custom;
}

export function normalizeHistory(history) {
  if (!Array.isArray(history)) {
    return [];
  }

  return history
    .filter((item) => item && typeof item.text === "string" && item.text.trim())
    .map((item) => ({
      role: item.role === "assistant" ? "assistant" : "user",
      text: item.text.trim(),
    }))
    .slice(-12);
}

function timeoutPromise(ms) {
  return new Promise((_, reject) => {
    setTimeout(() => reject(new Error(`timeout:${ms}`)), ms);
  });
}

function parseResponseBody(response) {
  if (!response) {
    return {};
  }

  if (typeof response.body === "string") {
    try {
      return JSON.parse(response.body);
    } catch (error) {
      return {
        error: {
          message: "The provider returned an invalid JSON payload.",
        },
      };
    }
  }

  return response.body || {};
}

function getResponseStatus(response) {
  return response?.status ?? response?.statusCode ?? response?.code ?? 0;
}

function normalizeBaseUrl(url) {
  return String(url || "").trim().replace(/\/+$/, "");
}

function joinEndpoint(baseUrl, path) {
  const base = normalizeBaseUrl(baseUrl);
  const suffix = String(path || "").replace(/^\/+/, "");
  return `${base}/${suffix}`;
}

function ensureSuccess(response, body, providerLabel) {
  const status = getResponseStatus(response);
  const errorMessage =
    body?.error?.message || body?.message || body?.error_description || "";

  if (status >= 400 || errorMessage) {
    const detail = errorMessage || `${providerLabel} request failed (${status || "unknown"})`;
    throw new Error(detail);
  }
}

function truncateForWatch(text) {
  const normalized = String(text || "")
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (normalized.length <= MAX_REPLY_CHARS) {
    return normalized;
  }

  return `${normalized.slice(0, MAX_REPLY_CHARS).trim()}\n\n[Response truncated for watch]`;
}

function extractOpenAIText(body) {
  const message = body?.choices?.[0]?.message;
  const content = message?.content;

  if (typeof content === "string") {
    return truncateForWatch(content);
  }

  if (Array.isArray(content)) {
    const text = content
      .map((part) => {
        if (typeof part === "string") {
          return part;
        }
        if (typeof part?.text === "string") {
          return part.text;
        }
        if (typeof part?.content === "string") {
          return part.content;
        }
        return "";
      })
      .filter(Boolean)
      .join("\n");

    return truncateForWatch(text);
  }

  throw new Error("The provider returned an empty response.");
}

function extractGeminiText(body) {
  const candidates = Array.isArray(body?.candidates) ? body.candidates : [];
  const parts = Array.isArray(candidates?.[0]?.content?.parts)
    ? candidates[0].content.parts
    : [];
  const text = parts
    .map((part) => (typeof part?.text === "string" ? part.text : ""))
    .filter(Boolean)
    .join("\n");

  const normalized = truncateForWatch(text);
  if (normalized) {
    return normalized;
  }

  throw new Error("Gemini returned an empty response.");
}

function extractAnthropicText(body) {
  const content = Array.isArray(body?.content) ? body.content : [];
  const text = content
    .map((part) => (part?.type === "text" && typeof part?.text === "string" ? part.text : ""))
    .filter(Boolean)
    .join("\n");

  const normalized = truncateForWatch(text);
  if (normalized) {
    return normalized;
  }

  throw new Error("Claude returned an empty response.");
}

async function postJson(url, headers, body) {
  return Promise.race([
    fetch({
      url,
      method: "POST",
      headers,
      body: JSON.stringify(body),
    }),
    timeoutPromise(REQUEST_TIMEOUT_MS),
  ]);
}

async function callOpenAICompatible(config, history) {
  const messages = [
    {
      role: "system",
      content: config.systemPrompt || DEFAULT_SYSTEM_PROMPT,
    },
    ...normalizeHistory(history).map((item) => ({
      role: item.role,
      content: item.text,
    })),
  ];

  const headers = {
    "Content-Type": "application/json",
  };

  if (config.apiKey) {
    headers.Authorization = `Bearer ${config.apiKey}`;
  }

  if (config.providerId === "openrouter") {
    headers["X-OpenRouter-Title"] = "WristLLM";
  }

  const response = await postJson(
    joinEndpoint(config.baseUrl, "chat/completions"),
    headers,
    {
      model: config.model,
      messages,
      stream: false,
    }
  );

  const body = parseResponseBody(response);
  ensureSuccess(response, body, config.providerLabel);
  return extractOpenAIText(body);
}

async function callGemini(config, history) {
  const contents = normalizeHistory(history).map((item) => ({
    role: item.role === "assistant" ? "model" : "user",
    parts: [{ text: item.text }],
  }));

  const endpoint =
    joinEndpoint(config.baseUrl, `models/${encodeURIComponent(config.model)}:generateContent`) +
    `?key=${encodeURIComponent(config.apiKey)}`;

  const response = await postJson(
    endpoint,
    {
      "Content-Type": "application/json",
    },
    {
      systemInstruction: {
        parts: [{ text: config.systemPrompt || DEFAULT_SYSTEM_PROMPT }],
      },
      contents,
      generationConfig: {
        maxOutputTokens: 768,
      },
    }
  );

  const body = parseResponseBody(response);
  ensureSuccess(response, body, config.providerLabel);
  return extractGeminiText(body);
}

async function callAnthropic(config, history) {
  const response = await postJson(
    joinEndpoint(config.baseUrl, "messages"),
    {
      "Content-Type": "application/json",
      "anthropic-version": "2023-06-01",
      Authorization: `Bearer ${config.apiKey}`,
    },
    {
      model: config.model,
      max_tokens: 768,
      system: config.systemPrompt || DEFAULT_SYSTEM_PROMPT,
      messages: normalizeHistory(history).map((item) => ({
        role: item.role,
        content: item.text,
      })),
    }
  );

  const body = parseResponseBody(response);
  ensureSuccess(response, body, config.providerLabel);
  return extractAnthropicText(body);
}

export function validateProviderConfig(config) {
  if (!config || !config.baseUrl) {
    throw new Error("MISSING_BASE_URL");
  }

  if (!config.model) {
    throw new Error("MISSING_MODEL");
  }

  if (config.requiresKey && !config.apiKey) {
    throw new Error("MISSING_API_KEY");
  }
}

export async function callProvider(config, history) {
  validateProviderConfig(config);

  if (config.transport === "gemini") {
    return callGemini(config, history);
  }

  if (config.transport === "anthropic") {
    return callAnthropic(config, history);
  }

  return callOpenAICompatible(config, history);
}
