const ACTIVE_PROVIDER = "llm_provider";
const SYSTEM_PROMPT = "llm_system_prompt";
const PHONE_DRAFT = "phone_draft";
const LEGACY_GEMINI_API_KEY = "gemini_api_key";

const DEFAULT_SYSTEM_PROMPT =
  "You are replying inside a smartwatch chat app. Keep answers concise and easy to read on a small screen. Prefer short paragraphs and simple bullets. Avoid markdown tables, long preambles, and unnecessary repetition.";

const PROVIDERS = [
  {
    id: "gemini",
    label: "Google Gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    model: "gemini-2.5-flash",
    requiresKey: true,
  },
  {
    id: "openai",
    label: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    model: "",
    requiresKey: true,
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    model: "",
    requiresKey: true,
  },
  {
    id: "groq",
    label: "Groq",
    baseUrl: "https://api.groq.com/openai/v1",
    model: "openai/gpt-oss-20b",
    requiresKey: true,
  },
  {
    id: "mistral",
    label: "Mistral AI",
    baseUrl: "https://api.mistral.ai/v1",
    model: "mistral-small-latest",
    requiresKey: true,
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    baseUrl: "https://api.deepseek.com",
    model: "deepseek-flash",
    requiresKey: true,
  },
  {
    id: "anthropic",
    label: "Anthropic Claude",
    baseUrl: "https://api.anthropic.com/v1",
    model: "",
    requiresKey: true,
  },
  {
    id: "custom",
    label: "Custom / local (OpenAI-compatible)",
    baseUrl: "",
    model: "",
    requiresKey: false,
  },
];

function keyFor(providerId, field) {
  return `llm_${field}_${providerId}`;
}

function findProvider(providerId) {
  return PROVIDERS.find((provider) => provider.id === providerId) || PROVIDERS[0];
}

AppSettingsPage({
  state: {
    props: {},
    providerId: "gemini",
    apiKey: "",
    model: "",
    baseUrl: "",
    systemPrompt: DEFAULT_SYSTEM_PROMPT,
    draft: "",
  },

  read(key) {
    return this.state.props.settingsStorage.getItem(key) || "";
  },

  persist(key, value) {
    this.state.props.settingsStorage.setItem(key, String(value || ""));
  },

  loadProviderFields(providerId) {
    const provider = findProvider(providerId);
    this.state.providerId = provider.id;
    this.state.apiKey = this.read(keyFor(provider.id, "api_key"));
    this.state.model = this.read(keyFor(provider.id, "model")) || provider.model;
    this.state.baseUrl = this.read(keyFor(provider.id, "base_url")) || provider.baseUrl;
  },

  migrateLegacyGeminiKey() {
    const modernKey = this.read(keyFor("gemini", "api_key"));
    const legacyKey = this.read(LEGACY_GEMINI_API_KEY);

    if (!modernKey && legacyKey) {
      this.persist(keyFor("gemini", "api_key"), legacyKey);
    }
  },

  setState(props) {
    this.state.props = props;
    this.migrateLegacyGeminiKey();

    const providerId = this.read(ACTIVE_PROVIDER) || "gemini";
    this.loadProviderFields(providerId);
    this.state.systemPrompt = this.read(SYSTEM_PROMPT) || DEFAULT_SYSTEM_PROMPT;
    this.state.draft = this.read(PHONE_DRAFT);
  },

  selectProvider(providerId) {
    this.persist(ACTIVE_PROVIDER, providerId);
    this.loadProviderFields(providerId);
  },

  providerButton(provider) {
    const isActive = provider.id === this.state.providerId;

    return Button({
      label: `${isActive ? "✓ " : ""}${provider.label}`,
      style: {
        marginTop: "6px",
        fontSize: "13px",
        borderRadius: "18px",
        background: isActive ? "#2d6cdf" : "#3b3b3b",
        color: "#fff",
      },
      onClick: () => this.selectProvider(provider.id),
    });
  },

  build(props) {
    this.setState(props);
    const provider = findProvider(this.state.providerId);

    return View(
      {
        style: {
          padding: "12px 18px",
        },
      },
      [
        Text(
          {
            style: {
              marginBottom: "8px",
              fontSize: "20px",
              fontWeight: "600",
            },
          },
          "WristLLM"
        ),
        Text(
          {
            style: {
              marginBottom: "8px",
              color: "#666",
              fontSize: "12px",
              lineHeight: "18px",
            },
          },
          "Choose an AI provider. Keys stay in Zepp phone settings and are never copied into watch chat history."
        ),
        ...PROVIDERS.map((item) => this.providerButton(item)),
        Text(
          {
            style: {
              marginTop: "18px",
              marginBottom: "8px",
              fontSize: "17px",
              fontWeight: "600",
            },
          },
          `Active: ${provider.label}`
        ),
        TextInput({
          label: provider.requiresKey ? "API Key" : "API Key (optional)",
          placeholder: provider.requiresKey ? "Provider API key" : "Leave blank for local APIs without auth",
          value: this.state.apiKey,
          rows: 3,
          subStyle: {
            "word-break": "break-all",
          },
          onChange: (value) => {
            this.state.apiKey = value;
            this.persist(keyFor(provider.id, "api_key"), value.trim());
          },
        }),
        TextInput({
          label: "Model ID",
          placeholder: "Exact model name used by the provider",
          value: this.state.model,
          rows: 2,
          subStyle: {
            "word-break": "break-all",
          },
          onChange: (value) => {
            this.state.model = value;
            this.persist(keyFor(provider.id, "model"), value.trim());
          },
        }),
        TextInput({
          label: "API Base URL",
          placeholder: "https://.../v1",
          value: this.state.baseUrl,
          rows: 3,
          subStyle: {
            "word-break": "break-all",
          },
          onChange: (value) => {
            this.state.baseUrl = value;
            this.persist(keyFor(provider.id, "base_url"), value.trim());
          },
        }),
        Button({
          label: "Reset provider defaults",
          style: {
            marginTop: "8px",
            fontSize: "12px",
            borderRadius: "20px",
            background: "#555",
            color: "#fff",
          },
          onClick: () => {
            this.state.model = provider.model;
            this.state.baseUrl = provider.baseUrl;
            this.persist(keyFor(provider.id, "model"), provider.model);
            this.persist(keyFor(provider.id, "base_url"), provider.baseUrl);
          },
        }),
        Text(
          {
            style: {
              marginTop: "20px",
              marginBottom: "8px",
              fontSize: "17px",
              fontWeight: "600",
            },
          },
          "Watch system prompt"
        ),
        TextInput({
          label: "System prompt",
          multiline: true,
          rows: 7,
          value: this.state.systemPrompt,
          onChange: (value) => {
            this.state.systemPrompt = value;
            this.persist(SYSTEM_PROMPT, value.trim());
          },
        }),
        Button({
          label: "Reset system prompt",
          style: {
            marginTop: "8px",
            fontSize: "12px",
            borderRadius: "20px",
            background: "#555",
            color: "#fff",
          },
          onClick: () => {
            this.state.systemPrompt = DEFAULT_SYSTEM_PROMPT;
            this.persist(SYSTEM_PROMPT, DEFAULT_SYSTEM_PROMPT);
          },
        }),
        Text(
          {
            style: {
              marginTop: "20px",
              marginBottom: "8px",
              fontSize: "17px",
              fontWeight: "600",
            },
          },
          "Phone Draft / Voice"
        ),
        Text(
          {
            style: {
              marginBottom: "10px",
              color: "#666",
              fontSize: "12px",
              lineHeight: "18px",
            },
          },
          "On watches without native dictation, use the phone keyboard microphone here and import the text with Voice on the watch."
        ),
        TextInput({
          label: "Draft text",
          multiline: true,
          rows: 8,
          value: this.state.draft,
          subStyle: {
            "white-space": "pre-wrap",
            "overflow-wrap": "break-word",
          },
          onChange: (value) => {
            this.state.draft = value;
            this.persist(PHONE_DRAFT, value);
          },
        }),
        Button({
          label: "Clear Draft",
          style: {
            marginTop: "10px",
            fontSize: "12px",
            borderRadius: "24px",
            background: "#D85E33",
            color: "#fff",
          },
          onClick: () => {
            this.state.draft = "";
            this.persist(PHONE_DRAFT, "");
          },
        }),
      ]
    );
  },
});
