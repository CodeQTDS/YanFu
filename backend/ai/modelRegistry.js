const axios = require("axios");
const { loadModelsConfig } = require("../config/configLoader");

function getConfig() {
  return loadModelsConfig();
}

function getDefaultModel() {
  const config = getConfig();
  return process.env.AI_DEFAULT_MODEL || config.defaultModel;
}

function resolveModel(modelId) {
  const config = getConfig();
  const selected = modelId || getDefaultModel();
  const model = config.models.find(item => item.id === selected);
  if (!model) {
    throw new Error(`Unsupported AI model: ${selected}`);
  }

  const provider = config.providers[model.provider];
  if (!provider) {
    throw new Error(`Missing provider configuration: ${model.provider}`);
  }

  return {
    ...model,
    providerConfig: provider
  };
}

function providerBaseUrl(providerConfig) {
  return (
    process.env[providerConfig.baseUrlEnv] ||
    providerConfig.defaultBaseUrl ||
    ""
  ).replace(/\/+$/, "");
}

async function checkAvailability(model) {
  const provider = model.providerConfig;

  try {
    if (provider.type === "ollama") {
      const url =
        process.env[provider.discoveryUrlEnv] ||
        provider.defaultDiscoveryUrl;

      const response = await axios.get(url, { timeout: 5000 });
      const names = (response.data?.models || [])
        .map(item => item.name || item.model)
        .filter(Boolean);

      const available = names.some(name =>
        name === model.model || name.startsWith(`${model.model}:`)
      );

      return {
        available,
        status: available ? "AVAILABLE" : "NOT_INSTALLED",
        statusReason: available ? null : `Ollama model ${model.model} is not installed`
      };
    }

    const apiKey = provider.apiKeyEnv
      ? process.env[provider.apiKeyEnv]
      : null;

    if (provider.apiKeyEnv && !apiKey) {
      return {
        available: false,
        status: "MISSING_API_KEY",
        statusReason: `Missing ${provider.apiKeyEnv}`
      };
    }

    return {
      available: true,
      status: "CONFIGURED",
      statusReason: null
    };
  } catch (error) {
    return {
      available: false,
      status: "UNREACHABLE",
      statusReason: error.message
    };
  }
}

async function getPublicModelListWithStatus() {
  const config = getConfig();
  const results = [];

  for (const raw of config.models) {
    const model = resolveModel(raw.id);
    const availability = await checkAvailability(model);
    results.push({
      id: model.id,
      provider: model.provider,
      model: model.model,
      label: model.label,
      tier: model.tier,
      description: model.description || "",
      supportsJson: model.supportsJson !== false,
      ...availability
    });
  }

  return results;
}

module.exports = {
  getDefaultModel,
  resolveModel,
  providerBaseUrl,
  getPublicModelListWithStatus
};
