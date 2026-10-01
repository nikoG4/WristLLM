import { BaseSideService, settingsLib } from "@zeppos/zml/base-side";
import {
  DEFAULT_SYSTEM_PROMPT,
  getPreset,
  callProvider,
  validateProviderConfig,
} from "./providers";

const ACTIVE_PROVIDER = "llm_provider";
const SYSTEM_PROMPT = "llm_system_prompt";
const PHONE_DRAFT = "phone_draft";
const PENDING_DRAFT = "pending_draft";
const LEGACY_GEMINI_API_KEY = "gemini_api_key";

function keyFor(providerId, field) {
  return `llm_${field}_${providerId}`;
}

function getStringSetting(key) {
  const value = settingsLib.getItem(key);
  return typeof value === "string" ? value.trim() : "";
}

function setStringSetting(key, value) {
  settingsLib.setItem(key, String(value || ""));
}

function getProviderId() {
  const providerId = getStringSetting(ACTIVE_PROVIDER);
  return providerId || "gemini";
}

function migrateLegacyGeminiKey() {
  const modernKey = getStringSetting(keyFor("gemini", "api_key"));
  if (modernKey) {
    return;
  }

  const legacyKey = getStringSetting(LEGACY_GEMINI_API_KEY);
  if (legacyKey) {
    setStringSetting(keyFor("gemini", "api_key"), legacyKey);
  }
}

function getProviderConfig() {
  migrateLegacyGeminiKey();

  const providerId = getProviderId();
  const preset = getPreset(providerId);
  const configuredBaseUrl = getStringSetting(keyFor(providerId, "base_url"));
  const configuredModel = getStringSetting(keyFor(providerId, "model"));

  return {
    providerId,
    providerLabel: preset.label,
    transport: preset.transport,
    requiresKey: preset.requiresKey,
    apiKey: getStringSetting(keyFor(providerId, "api_key")),
    baseUrl: configuredBaseUrl || preset.baseUrl,
    model: configuredModel || preset.model,
    systemPrompt: getStringSetting(SYSTEM_PROMPT) || DEFAULT_SYSTEM_PROMPT,
  };
}

function isProviderConfigured(config) {
  try {
    validateProviderConfig(config);
    return true;
  } catch (error) {
    return false;
  }
}

function getPublicState() {
  const config = getProviderConfig();

  return {
    providerId: config.providerId,
    providerLabel: config.providerLabel,
    providerConfigured: isProviderConfigured(config),
    apiKeyConfigured: Boolean(config.apiKey),
    apiKeyRequired: Boolean(config.requiresKey),
    modelName: config.model,
    pendingDraft: getStringSetting(PENDING_DRAFT),
  };
}

function toFriendlyError(error, config) {
  const message = String(error?.message || error || "");
  const normalized = message.toLowerCase();
  const providerLabel = config?.providerLabel || "AI provider";

  if (message.includes("MISSING_API_KEY")) {
    return `Add the ${providerLabel} API key in phone settings first.`;
  }

  if (message.includes("MISSING_MODEL")) {
    return `Choose a model for ${providerLabel} in phone settings first.`;
  }

  if (message.includes("MISSING_BASE_URL")) {
    return `Add the API base URL for ${providerLabel} in phone settings first.`;
  }

  if (
    normalized.includes("api_key_invalid") ||
    normalized.includes("invalid api key") ||
    normalized.includes("invalid x-api-key") ||
    normalized.includes("authentication") ||
    normalized.includes("unauthorized") ||
    normalized.includes("401")
  ) {
    return `${providerLabel} rejected the API key. Check it in phone settings.`;
  }

  if (
    normalized.includes("quota") ||
    normalized.includes("rate limit") ||
    normalized.includes("429")
  ) {
    return `${providerLabel} quota or rate limit reached. Please try again later.`;
  }

  if (normalized.includes("model") && (normalized.includes("not found") || normalized.includes("invalid"))) {
    return `The configured model was rejected by ${providerLabel}. Check the model ID.`;
  }

  if (normalized.includes("timeout")) {
    return `${providerLabel} took too long to respond. Please try again.`;
  }

  if (normalized.includes("network") || normalized.includes("fetch")) {
    return `Network error while contacting ${providerLabel}. Check your phone connection.`;
  }

  return message || `Unexpected ${providerLabel} error.`;
}

async function handleSendMessage(req, res) {
  const config = getProviderConfig();

  try {
    const reply = await callProvider(config, req?.params?.history);
    res(null, {
      ok: true,
      reply,
      state: getPublicState(),
    });
  } catch (error) {
    res(null, {
      ok: false,
      error: toFriendlyError(error, config),
      state: getPublicState(),
    });
  }
}

function notifyDevice(service) {
  service.call({
    type: "SETTINGS_UPDATED",
    state: getPublicState(),
  });
}

function isProviderSetting(key) {
  return (
    key === ACTIVE_PROVIDER ||
    key === SYSTEM_PROMPT ||
    key === LEGACY_GEMINI_API_KEY ||
    String(key || "").startsWith("llm_api_key_") ||
    String(key || "").startsWith("llm_model_") ||
    String(key || "").startsWith("llm_base_url_")
  );
}

AppSideService(
  BaseSideService({
    onInit() {
      migrateLegacyGeminiKey();
    },

    onRequest(req, res) {
      if (req.method === "GET_STATE") {
        res(null, {
          ok: true,
          state: getPublicState(),
        });
      } else if (req.method === "SEND_MESSAGE") {
        handleSendMessage(req, res);
      } else if (req.method === "CONSUME_PENDING_DRAFT") {
        const draft = getStringSetting(PENDING_DRAFT);
        setStringSetting(PENDING_DRAFT, "");

        res(null, {
          ok: true,
          draft,
          state: getPublicState(),
        });
      } else if (req.method === "PING") {
        res(null, {
          ok: true,
          result: "pong",
        });
      }
    },

    onSettingsChange({ key, newValue }) {
      if (key === PHONE_DRAFT) {
        const draft = typeof newValue === "string" ? newValue.trim() : "";
        setStringSetting(PENDING_DRAFT, draft);
      }

      if (key === PHONE_DRAFT || key === PENDING_DRAFT || isProviderSetting(key)) {
        notifyDevice(this);
      }
    },

    onRun() {},

    onDestroy() {},
  })
);
