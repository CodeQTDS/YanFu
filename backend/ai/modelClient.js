const axios = require("axios");
const {
  resolveModel,
  providerBaseUrl
} = require("./modelRegistry");
const { extractJson } = require("../utils/json");

const DEFAULT_TIMEOUT_MS = Number(
  process.env.AI_REQUEST_TIMEOUT_MS || 1_200_000
);
const DEFAULT_MAX_OUTPUT_TOKENS = Number(
  process.env.AI_MAX_OUTPUT_TOKENS || 4096
);

function buildProviderError(provider, error) {
  const status = error.response?.status;
  const detail =
    error.response?.data?.error?.message ||
    error.response?.data?.error ||
    error.response?.data?.message ||
    error.message;
  return new Error(
    `${provider} AI request failed${status ? ` (HTTP ${status})` : ""}: ${detail}`
  );
}

async function callOllama({ modelConfig, prompt, responseType, temperature, maxOutputTokens, timeoutMs }) {
  const provider = modelConfig.providerConfig;
  const url = process.env[provider.generateUrlEnv] || provider.defaultGenerateUrl;
  try {
    const body = {
      model: modelConfig.model,
      stream: false,
      prompt,
      options: {
        temperature,
        num_predict: maxOutputTokens
      }
    };
    if (responseType === "json") body.format = "json";

    const response = await axios.post(url, body, { timeout: timeoutMs });
    return {
      text: String(response.data?.response || ""),
      usage: {
        promptTokens: response.data?.prompt_eval_count ?? null,
        outputTokens: response.data?.eval_count ?? null
      },
      raw: response.data
    };
  } catch (error) {
    throw buildProviderError("ollama", error);
  }
}

async function callOpenAICompatible({ modelConfig, prompt, responseType, temperature, maxOutputTokens, timeoutMs }) {
  const provider = modelConfig.providerConfig;
  const baseUrl = providerBaseUrl(provider);
  const apiKey = provider.apiKeyEnv ? process.env[provider.apiKeyEnv] : null;
  if (provider.apiKeyEnv && !apiKey) {
    throw new Error(`Missing ${provider.apiKeyEnv}`);
  }

  const body = {
    model: modelConfig.model,
    messages: [{ role: "user", content: prompt }],
    max_tokens: maxOutputTokens
  };

  if (modelConfig.supportsTemperature !== false) {
    body.temperature = temperature;
  }

  if (responseType === "json") {
    body.response_format = { type: "json_object" };
  }

  try {
    const response = await axios.post(
      `${baseUrl}/chat/completions`,
      body,
      {
        timeout: timeoutMs,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        }
      }
    );

    const message = response.data?.choices?.[0]?.message;
    return {
      text: String(message?.content || ""),
      usage: response.data?.usage || null,
      raw: response.data
    };
  } catch (error) {
    throw buildProviderError(modelConfig.provider, error);
  }
}

// GPT-6-family models use the OpenAI Responses API. These reasoning models
// do not accept temperature and their response text is nested in output[].content[].
async function callOpenAIResponses({ modelConfig, prompt, responseType, maxOutputTokens, timeoutMs }) {
  const provider = modelConfig.providerConfig;
  const baseUrl = providerBaseUrl(provider);
  const apiKey = process.env[provider.apiKeyEnv];
  if (!apiKey) throw new Error(`Missing ${provider.apiKeyEnv}`);

  const body = {
    model: modelConfig.model,
    input: [{ role: "user", content: [{ type: "input_text", text: prompt }] }],
    max_output_tokens: Math.max(4096, maxOutputTokens),
    reasoning: { effort: "medium" }
  };
  if (responseType === "json") body.text = { format: { type: "json_object" } };

  try {
    const response = await axios.post(`${baseUrl}/responses`, body, {
      timeout: timeoutMs,
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" }
    });
    const data = response.data || {};
    const segments = (data.output || []).flatMap(item => item.content || [])
      .filter(item => item.type === "output_text" && typeof item.text === "string")
      .map(item => item.text);
    return {
      text: segments.join("\n") || String(data.output_text || ""),
      usage: data.usage || null,
      raw: data
    };
  } catch (error) {
    throw buildProviderError("openai", error);
  }
}

// Anthropic Messages API differs from OpenAI chat completions, so it has
// a dedicated request adapter rather than being mislabeled OpenAI-compatible.
async function callAnthropic({ modelConfig, prompt, responseType, temperature, maxOutputTokens, timeoutMs }) {
  const provider = modelConfig.providerConfig;
  const apiKey = process.env[provider.apiKeyEnv];
  if (!apiKey) throw new Error(`Missing ${provider.apiKeyEnv}`);
  const body = {
    model: modelConfig.model,
    max_tokens: maxOutputTokens,
    messages: [{ role: "user", content: responseType === "json"
      ? `${prompt}\n\nRespond with exactly one valid JSON object and no other text.`
      : prompt }]
  };
  if (modelConfig.supportsTemperature !== false) body.temperature = temperature;
  try {
    const response = await axios.post(`${providerBaseUrl(provider)}/messages`, body, {
      timeout: timeoutMs,
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "Content-Type": "application/json" }
    });
    const data = response.data || {};
    return {
      text: (data.content || []).filter(item => item.type === "text").map(item => item.text || "").join("\n"),
      usage: data.usage || null,
      raw: data
    };
  } catch (error) {
    throw buildProviderError("anthropic", error);
  }
}

async function callGemini({ modelConfig, prompt, responseType, temperature, maxOutputTokens, timeoutMs }) {
  const provider = modelConfig.providerConfig;
  const baseUrl = providerBaseUrl(provider);
  const apiKey = process.env[provider.apiKeyEnv];
  if (!apiKey) throw new Error(`Missing ${provider.apiKeyEnv}`);

  const url = `${baseUrl}/models/${encodeURIComponent(modelConfig.model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      temperature,
      maxOutputTokens
    }
  };
  if (responseType === "json") {
    body.generationConfig.responseMimeType = "application/json";
  }

  try {
    const response = await axios.post(url, body, { timeout: timeoutMs });
    const parts = response.data?.candidates?.[0]?.content?.parts || [];
    return {
      text: parts.map(item => item.text || "").join("\n"),
      usage: response.data?.usageMetadata || null,
      raw: response.data
    };
  } catch (error) {
    throw buildProviderError("gemini", error);
  }
}

async function generate({
  modelId,
  prompt,
  responseType = "text",
  temperature = 0.1,
  maxOutputTokens = DEFAULT_MAX_OUTPUT_TOKENS,
  timeoutMs = DEFAULT_TIMEOUT_MS
}) {
  if (!String(prompt || "").trim()) {
    throw new Error("AI prompt is empty");
  }

  const modelConfig = resolveModel(modelId);
  let result;

  switch (modelConfig.providerConfig.type) {
    case "ollama":
      result = await callOllama({ modelConfig, prompt, responseType, temperature, maxOutputTokens, timeoutMs });
      break;
    case "openai-compatible":
      result = modelConfig.apiStyle === "responses"
        ? await callOpenAIResponses({ modelConfig, prompt, responseType, maxOutputTokens, timeoutMs })
        : await callOpenAICompatible({ modelConfig, prompt, responseType, temperature, maxOutputTokens, timeoutMs });
      break;
    case "anthropic":
      result = await callAnthropic({ modelConfig, prompt, responseType, temperature, maxOutputTokens, timeoutMs });
      break;
    case "gemini":
      result = await callGemini({ modelConfig, prompt, responseType, temperature, maxOutputTokens, timeoutMs });
      break;
    default:
      throw new Error(`Unsupported provider type: ${modelConfig.providerConfig.type}`);
  }

  if (!result.text.trim()) {
    throw new Error(`${modelConfig.provider} returned empty output`);
  }

  return {
    ...result,
    text: result.text.trim(),
    modelId: modelConfig.id,
    provider: modelConfig.provider,
    model: modelConfig.model
  };
}

async function generateJson(options) {
  const result = await generate({ ...options, responseType: "json" });
  const json = extractJson(result.text);
  if (!json) {
    throw new Error(`AI model ${result.modelId} did not return valid JSON`);
  }
  return {
    ...result,
    json
  };
}

module.exports = {
  generate,
  generateJson
};
