require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });

const express = require("express");
const {createApiProtection,localHost}=require("./security/apiProtection");
const modelsRoute = require("./routes/models");
const workflowRoute = require("./routes/workflow");
const configRoute = require("./routes/config");
const { safeJson } = require("./utils/json");
const { loadAppConfig } = require("./config/configLoader");
const {
  requestLoggingMiddleware,
  logStartup
} = require("./utils/logger");

const app = express();
const port = Number(process.env.PORT || 3000);

// API responses are live workflow state. Disable validator caching so browser
// fetches never receive a 304 response with an empty body. A 304 is valid HTTP
// for normal documents but is a poor fit for JSON APIs consumed through fetch.
app.disable("etag");

const bindHost=process.env.YANFU_BIND_HOST || "127.0.0.1";
if (!localHost(bindHost)) throw new Error("YanFu development API cannot bind externally without a separately secured authenticated gateway");
app.use(createApiProtection().middleware);
app.use(express.json({ limit: "4mb" }));
app.use((req, res, next) => {
  if (req.path.startsWith("/api")) {
    res.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.set("Pragma", "no-cache");
    res.set("Expires", "0");
  }
  next();
});
app.use(requestLoggingMiddleware());

app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    project: loadAppConfig().projectName,
    version: loadAppConfig().version,
    traceId: req.traceId,
    time: new Date().toISOString()
  });
});

app.use("/api/models", modelsRoute);
app.use("/api/config", configRoute);
app.use("/api", workflowRoute);

app.use((error, req, res, next) => {
  req.log?.error("UNHANDLED ERROR", error, {
    method: req.method,
    route: req.originalUrl
  });

  res.status(500).json(safeJson({
    success: false,
    traceId: req.traceId,
    error: error.message
  }));
});

app.listen(port, bindHost, () => {
  logStartup({
    projectName: loadAppConfig().projectName,
    port
  });
});
