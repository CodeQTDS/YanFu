"use strict";

let catalogPromise = null;

async function getCatalog(force = false) {
  if (!catalogPromise || force) {
    catalogPromise = DAO_API.get("/api/models")
      .catch(error => {
        // Do not permanently cache a rejected promise. A temporary provider/API
        // problem should be recoverable by reloading the page.
        catalogPromise = null;
        throw error;
      });
  }
  return catalogPromise;
}

function populateOptions(select, response, preferred = null) {
  if (!select) return "";

  select.innerHTML = "";
  for (const model of response?.models || []) {
    const option = document.createElement("option");
    option.value = model.id;
    option.textContent = `${model.label || model.id}${model.available ? "" : ` — ${model.status || "unavailable"}`}`;
    option.disabled = !model.available;
    option.dataset.provider = model.provider || "";
    option.dataset.label = model.label || model.id;
    select.appendChild(option);
  }

  const preferredOption = [...select.options]
    .find(option => option.value === preferred && !option.disabled);
  const firstAvailable = [...select.options].find(option => !option.disabled);
  select.value = preferredOption?.value || firstAvailable?.value || "";
  return select.value;
}

async function populateModelSelect(selectId, workflowKey) {
  const select = document.getElementById(selectId);
  if (!select) return null;

  const response = await getCatalog();
  const state = DAO_STATE.load();
  const preferred = state.models?.[workflowKey] || response.defaultModel;
  populateOptions(select, response, preferred);

  select.addEventListener("change", () => {
    const current = DAO_STATE.load();
    DAO_STATE.save({
      models: {
        ...current.models,
        [workflowKey]: select.value
      }
    });
  });

  return response;
}

function availableModels(response) {
  return (response?.models || []).filter(model => model.available);
}

window.DAO_MODELS = {
  getCatalog,
  populateOptions,
  populateModelSelect,
  availableModels
};
