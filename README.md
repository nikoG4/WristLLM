# WristLLM

WristLLM is a multi-provider LLM chat client for Zepp OS wearables. It keeps the watch UI lightweight and moves network access and API credentials to the Zepp phone-side service.

The project started as a Gemini-only experiment for Amazfit Active and was generalized so the same watch interface can talk to several AI providers without baking one vendor into the app.

## Architecture

```text
Zepp OS watch UI
      |
      | ZML request / response
      v
Phone app-side service
      |
      +--> Google Gemini adapter
      +--> Anthropic Messages adapter
      +--> OpenAI-compatible adapter
              |
              +--> OpenAI
              +--> OpenRouter
              +--> Groq
              +--> Mistral AI
              +--> DeepSeek
              +--> custom / local endpoints
```

API keys remain in Zepp phone settings. The watch receives only non-sensitive provider state such as provider name, model ID, and whether configuration is complete.

## Provider support

WristLLM includes presets for:

- Google Gemini
- OpenAI
- OpenRouter
- Groq
- Mistral AI
- DeepSeek
- Anthropic Claude
- Custom or local OpenAI-compatible endpoints

The OpenAI-compatible adapter uses the standard `POST /chat/completions` message format. This makes it useful with other services that expose a compatible endpoint even when they do not have a dedicated WristLLM preset.

Provider model IDs change over time, so model names are editable from the phone settings page. Presets provide defaults only where a stable default is known; otherwise the user chooses the exact model ID.

## Watch features

- Multi-turn chat history stored locally on the watch
- Provider-aware status and message labels
- Native Zepp system keyboard when supported
- Built-in T9-style keyboard fallback
- Native voice input when supported
- Phone-assisted voice/draft fallback for older runtimes
- Watch audio recorder capability detection
- Progressive reply reveal for long responses
- Response length protection for small-screen usability
- Round and square Zepp OS layouts

## Phone-side features

- Provider selection
- Per-provider API key storage
- Per-provider model and base URL configuration
- Custom system prompt
- Gemini-to-WristLLM key migration for users of the original prototype
- Network timeout and friendly provider error handling
- Draft transfer from phone to watch

## Custom / local providers

Choose **Custom / local (OpenAI-compatible)** in the Zepp phone settings when the service implements an OpenAI-style chat-completions endpoint.

Configure:

- **API Base URL** — for example `http://192.168.1.10:11434/v1` for a compatible service reachable from the phone
- **Model ID** — the exact model name expected by that service
- **API Key** — optional for local endpoints that do not require authentication

WristLLM appends `/chat/completions` to the configured base URL.

## API key handling

WristLLM does not hardcode provider keys in the repository.

Keys are stored per provider in the Zepp phone settings storage. The side service reads the active key when sending a request. The watch receives only a boolean indicating whether a key is configured.

This is convenient for a personal wearable client, but phone-side settings storage should not be treated as a hardware-backed secret vault. Use limited-scope keys and rotate them if a device or account is compromised.

## Project layout

```text
app.js                    Zepp OS app entry point
app.json                  Zepp app metadata and targets
app-side/index.js          phone-side orchestration and settings sync
app-side/providers.js      provider adapters and response normalization
settings/index.js          phone configuration UI
page/gt/home/              watch chat UI
utils/                     file persistence and device helpers
assets/                    watch app assets
```

## Build

1. Install dependencies:

```bash
npm install
```

2. Run the lightweight TypeScript declaration check:

```bash
npm test
```

3. Open/package the project using your normal Zepp OS development workflow.

The project intentionally keeps the runtime baseline close to the original Amazfit Active-compatible implementation instead of requiring newer watch APIs.

## Migration from the Gemini-only prototype

If the older `gemini_api_key` setting exists and no new Gemini key has been saved yet, the phone-side service copies it automatically to the new per-provider Gemini setting.

Chat history on the watch remains compatible because the local history format is still a simple list of `user` and `assistant` messages.

## Current limitations

- Provider responses are non-streaming at the network layer; the watch progressively reveals the completed response for a streaming-like UI.
- Model discovery is not automatic. Enter the exact provider model ID in phone settings.
- Recorded OPUS audio is not automatically sent to a transcription API yet.
- The custom adapter expects an OpenAI-compatible `chat/completions` response shape.
- API keys are stored in Zepp settings storage, not a hardware-backed secret store.

## License

MIT
