"use strict";

const API_BASE = "http://127.0.0.1:3000";

async function requestJson(endpoint, options = {}) {
  const method = String(options.method || "GET").toUpperCase();
  const response = await fetch(API_BASE + endpoint, {
    ...options,
    method,
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });

  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch (_) {
    data = {
      success: false,
      error: `Server returned non-JSON data (${response.status})`
    };
  }

  if (!response.ok) {
    const error = new Error(data.error || `API request failed (${response.status})`);
    error.data = data;
    error.status = response.status;
    throw error;
  }

  return data;
}

window.DAO_API = {
  get: endpoint => requestJson(endpoint, { method: "GET" }),
  post: (endpoint, body) => requestJson(endpoint, {
    method: "POST",
    body: JSON.stringify(body)
  })
};
