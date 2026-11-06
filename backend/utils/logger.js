"use strict";

const crypto = require("crypto");
const { loadAppConfig } = require("../config/configLoader");

const LEVELS = {
  off: 0,
  error: 1,
  info: 2,
  verbose: 3,
  debug: 4
};

const DEFAULTS = {
  enabled: true,
  level: "info",
  pretty: true,
  slowRequestMs: 5000,
  noisyRoutes: [
    "/api/config/public",
    "/api/config/chain-context",
    "/api/models"
  ],
  showRequestPreview: true,
  maxPreviewLength: 160,
  showErrorStackInDebug: true
};

function getConfig() {
  let configured = {};
  try {
    configured = loadAppConfig().logging || {};
  } catch (_) {
    configured = {};
  }

  const envLevel = String(process.env.YANFU_LOG_LEVEL || "").trim().toLowerCase();
  const level = LEVELS[envLevel] !== undefined
    ? envLevel
    : (LEVELS[String(configured.level || "").toLowerCase()] !== undefined
      ? String(configured.level).toLowerCase()
      : DEFAULTS.level);

  return {
    ...DEFAULTS,
    ...configured,
    level,
    enabled: configured.enabled !== false
  };
}

function shouldLog(levelName, config = getConfig()) {
  if (!config.enabled) return false;
  const active = LEVELS[config.level] ?? LEVELS.info;
  const requested = LEVELS[levelName] ?? LEVELS.info;
  return active >= requested && active > LEVELS.off;
}

function timestamp() {
  return new Date().toISOString().slice(11, 23);
}

function durationText(ms) {
  if (ms >= 1000) return `${(ms / 1000).toFixed(3)}s`;
  return `${ms}ms`;
}

function truncate(value, maxLength) {
  const text = String(value ?? "");
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 1))}…`;
}

function shortFingerprint(value) {
  const text = String(value || "");
  if (!text) return "—";
  if (text.length <= 18) return text;
  return `${text.slice(0, 10)}…${text.slice(-6)}`;
}

function printMeta(meta, prefix = "  ") {
  if (!meta || typeof meta !== "object") return;
  for (const [key, value] of Object.entries(meta)) {
    if (value === undefined || value === null || value === "") continue;
    let rendered;
    if (Array.isArray(value)) {
      rendered = value.join(", ");
    } else if (typeof value === "object") {
      rendered = JSON.stringify(value);
    } else {
      rendered = String(value);
    }
    console.log(`${prefix}${key.padEnd(14)}: ${rendered}`);
  }
}

function requestSummary(req, config = getConfig()) {
  const body = req.body || {};
  const proposal = body.proposal || null;
  const route = req.path || req.originalUrl || "";

  if (route.endsWith("/generate")) {
    return {
      operation: "AI proposal generation",
      model: body.model || "default",
      iteration: body.iteration || body.iterationContext?.round || 1,
      inputChars: typeof body.text === "string" ? body.text.length : 0,
      inputPreview: config.showRequestPreview && typeof body.text === "string"
        ? truncate(body.text.replace(/\s+/g, " ").trim(), config.maxPreviewLength)
        : undefined
    };
  }

  if (route.endsWith("/analyze")) {
    return {
      operation: "AI proposal analysis",
      model: body.model || "default",
      fingerprint: shortFingerprint(proposal?.fingerprint),
      actions: Array.isArray(proposal?.actions) ? proposal.actions.length : 0
    };
  }

  if (route.endsWith("/review/session") || route.endsWith("/review")) {
    const models = Array.isArray(body.models)
      ? body.models
      : Array.isArray(body.reviewers)
        ? body.reviewers.map(item => item?.model).filter(Boolean)
        : body.model
          ? [body.model]
          : [];
    return {
      operation: "AI review panel",
      reviewers: models.length || 1,
      models,
      fingerprint: shortFingerprint(proposal?.fingerprint),
      iteration: body.iteration || body.roundContext?.round || 1
    };
  }

  if (route.endsWith("/proposal/rebuild")) {
    return {
      operation: "Human edit → deterministic rebuild",
      oldFingerprint: shortFingerprint(proposal?.fingerprint),
      actions: Array.isArray(body.actions) ? body.actions.length : 0,
      descriptionChars: typeof body.description === "string" ? body.description.length : 0
    };
  }

  if (route.endsWith("/proposal/validate")) {
    return {
      operation: "Submission validation",
      fingerprint: shortFingerprint(proposal?.fingerprint),
      actions: Array.isArray(proposal?.actions) ? proposal.actions.length : 0
    };
  }

  return null;
}

function isNoisyRoute(req, config) {
  const path = String(req.originalUrl || req.path || "").split("?")[0];
  return (config.noisyRoutes || []).some(item => path === item);
}

function createRequestLogger(req, startedAt, config) {
  function prefix(symbol, label) {
    return `${symbol} [${timestamp()}] [${req.traceId}] ${label}`;
  }

  return {
    level: config.level,
    enabled: config.enabled,

    step(label, meta) {
      if (!shouldLog("verbose", config)) return;
      console.log(prefix("│", label));
      printMeta(meta, "│   ");
    },

    info(label, meta) {
      if (!shouldLog("info", config)) return;
      console.log(prefix("•", label));
      printMeta(meta);
    },

    debug(label, meta) {
      if (!shouldLog("debug", config)) return;
      console.log(prefix("·", label));
      printMeta(meta);
    },

    warn(label, meta) {
      if (!shouldLog("info", config)) return;
      console.warn(prefix("!", label));
      printMeta(meta);
    },

    error(label, error, meta) {
      if (!shouldLog("error", config)) return;
      console.error(prefix("✖", label));
      printMeta({
        ...(meta || {}),
        message: error?.message || String(error || "Unknown error")
      });
      if (shouldLog("debug", config) && config.showErrorStackInDebug && error?.stack) {
        console.error(error.stack);
      }
    },

    elapsedMs() {
      return Date.now() - startedAt;
    }
  };
}

function requestLoggingMiddleware() {
  return (req, res, next) => {
    const config = getConfig();
    req.traceId = crypto.randomBytes(4).toString("hex");
    const startedAt = Date.now();
    const noisy = isNoisyRoute(req, config);
    req.log = createRequestLogger(req, startedAt, config);

    if (shouldLog("verbose", config) && (!noisy || shouldLog("debug", config))) {
      console.log("");
      console.log(`┌─ [${timestamp()}] [${req.traceId}] ${req.method} ${req.originalUrl}`);
      const summary = requestSummary(req, config);
      if (summary) printMeta(summary, "│  ");
      if (shouldLog("debug", config)) {
        printMeta({
          contentType: req.get("content-type") || "—",
          contentLength: req.get("content-length") || "—"
        }, "│  ");
      }
    }

    res.on("finish", () => {
      if (!config.enabled) return;
      const elapsed = Date.now() - startedAt;
      const failed = res.statusCode >= 400;
      const slow = elapsed >= Number(config.slowRequestMs || DEFAULTS.slowRequestMs);

      if (noisy && !failed && !shouldLog("debug", config)) return;
      if (!failed && !shouldLog("info", config)) return;
      if (failed && !shouldLog("error", config)) return;

      const symbol = failed ? "✖" : "✓";
      const statusText = failed ? "FAILED" : "OK";
      const slowText = slow ? "  ⚠ SLOW" : "";
      console.log(
        `${symbol} [${timestamp()}] [${req.traceId}] ${res.statusCode} ${statusText} | ${durationText(elapsed)}${slowText} | ${req.method} ${req.originalUrl}`
      );

      if (slow && shouldLog("verbose", config)) {
        console.log(`  threshold     : ${durationText(Number(config.slowRequestMs || DEFAULTS.slowRequestMs))}`);
        console.log("  note          : AI inference/reviewer calls can legitimately take much longer than local config routes.");
      }

      if (shouldLog("verbose", config)) {
        console.log("└────────────────────────────────────────────────────────────────────────");
      }
    });

    next();
  };
}

function logStartup({ projectName, port }) {
  const config = getConfig();
  console.log("");
  console.log("════════════════════════════════════════════════════════════════════════");
  console.log(`  ${projectName}`);
  console.log(`  Backend       : http://localhost:${port}`);
  console.log(`  Log level     : ${config.enabled ? config.level : "off"}`);
  console.log(`  Slow request  : ${durationText(Number(config.slowRequestMs || DEFAULTS.slowRequestMs))}`);
  console.log("════════════════════════════════════════════════════════════════════════");
}

module.exports = {
  LEVELS,
  getConfig,
  shouldLog,
  shortFingerprint,
  requestLoggingMiddleware,
  logStartup
};
