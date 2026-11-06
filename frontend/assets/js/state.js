"use strict";

const STORAGE_KEY = "yanfuGovernanceCompilerWorkflowV3";

function emptyState() {
  return {
    sourceText: "",
    proposal: null,
    analysis: null,
    analysisFingerprint: null,
    review: null,
    reviewSession: null,
    reviewHistory: [],
    reviewSetup: {
      count: 1,
      reviewers: []
    },
    iterationContext: null,
    validation: null,
    humanEditContext: null,
    humanConfirmation: null,
    submission: null,
    models: {
      generation: null,
      analysis: null,
      review: null
    },
    updatedAt: new Date().toISOString()
  };
}

function load() {
  try {
    const base = emptyState();
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    return {
      ...base,
      ...raw,
      models: {
        ...base.models,
        ...(raw.models || {})
      },
      reviewSetup: {
        ...base.reviewSetup,
        ...(raw.reviewSetup || {})
      },
      reviewHistory: Array.isArray(raw.reviewHistory) ? raw.reviewHistory : []
    };
  } catch (_) {
    return emptyState();
  }
}

function save(next) {
  const current = load();
  const value = {
    ...current,
    ...next,
    models: next.models
      ? { ...current.models, ...next.models }
      : current.models,
    reviewSetup: next.reviewSetup
      ? { ...current.reviewSetup, ...next.reviewSetup }
      : current.reviewSetup,
    updatedAt: new Date().toISOString()
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  return value;
}

function patch(path, value) {
  const state = load();
  state[path] = value;
  return save(state);
}

function clear() {
  localStorage.removeItem(STORAGE_KEY);
  return emptyState();
}

window.DAO_STATE = {
  load,
  save,
  patch,
  clear
};
