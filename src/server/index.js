import "dotenv/config";
import crypto from "node:crypto";
import fs from "node:fs";
import https from "node:https";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { createStore } from "./store.js";
import { searchInstruments } from "./instruments.js";
import { createMarketProvider } from "./market/index.js";
import { createNotifier } from "./notifications/index.js";
import { createPoller } from "./poller.js";
import { createUpstoxFeed } from "./market/upstox-feed.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "../..");
const publicDir = path.join(rootDir, "public");

const app = express();
const store = createStore({ rootDir });
const market = createMarketProvider({ store });
const notifier = createNotifier();
const sseClients = new Set();
const oauthStates = new Map();

app.use(express.json({ limit: "1mb" }));
app.use(express.static(publicDir));

function broadcast(event, payload) {
  const data = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const response of sseClients) {
    response.write(data);
  }
}

function normalizeAlertInput(body, existing = {}) {
  const target = Number(body.target);
  const cooldownMinutes = Number(body.cooldownMinutes ?? existing.cooldownMinutes ?? 15);
  const rawInstrument = String(body.instrument ?? existing.instrument ?? "").trim();
  const instrument = rawInstrument.includes("|") ? rawInstrument : rawInstrument.toUpperCase();
  const metric = String(body.metric ?? existing.metric ?? "last_price");
  const operator = String(body.operator ?? existing.operator ?? "above");
  const channels = {
    email: Boolean(body.channels?.email ?? existing.channels?.email ?? true),
    telegram: Boolean(body.channels?.telegram ?? existing.channels?.telegram ?? true),
    sms: Boolean(body.channels?.sms ?? existing.channels?.sms ?? false),
    webhook: Boolean(body.channels?.webhook ?? existing.channels?.webhook ?? false)
  };

  if (!instrument.includes("|") && !instrument.includes(":")) {
    throw new Error("Select an instrument from the Upstox search results.");
  }

  if (!Number.isFinite(target)) {
    throw new Error("Target must be a valid number.");
  }

  if (!["above", "below", "at_or_above", "at_or_below", "crosses_above", "crosses_below"].includes(operator)) {
    throw new Error("Unsupported condition operator.");
  }

  if (!["last_price", "percent_change", "change", "volume", "oi"].includes(metric)) {
    throw new Error("Unsupported alert metric.");
  }

  return {
    ...existing,
    instrument,
    label: String(body.label ?? existing.label ?? instrument).trim() || instrument,
    metric,
    operator,
    target,
    cooldownMinutes: Number.isFinite(cooldownMinutes) && cooldownMinutes > 0 ? cooldownMinutes : 15,
    channels,
    enabled: Boolean(body.enabled ?? existing.enabled ?? true)
  };
}

function asyncRoute(handler) {
  return (request, response, next) => {
    Promise.resolve(handler(request, response, next)).catch(next);
  };
}

app.get("/api/status", asyncRoute(async (_request, response) => {
  response.json({
    market: await market.status(),
    notifications: notifier.status(),
    pollIntervalMs: Number(process.env.POLL_INTERVAL_MS || 15000),
    feed: feed ? feed.status() : null,
    alerts: store.listAlerts().length
  });
}));

app.get("/api/instruments", asyncRoute(async (request, response) => {
  response.json(await searchInstruments(String(request.query.q || "")));
}));

app.get("/api/quotes", asyncRoute(async (request, response) => {
  const instruments = String(request.query.instruments || "")
    .split(",")
    .map((item) => {
      const instrument = item.trim();
      return instrument.includes("|") ? instrument : instrument.toUpperCase();
    })
    .filter(Boolean);

  if (instruments.length === 0) {
    response.json([]);
    return;
  }

  response.json(await market.getQuotes(instruments));
}));

app.get("/api/alerts", (_request, response) => {
  response.json(store.listAlerts());
});

app.post("/api/alerts", (request, response) => {
  const alert = store.createAlert(normalizeAlertInput(request.body));
  syncFeed();
  response.status(201).json(alert);
});

app.patch("/api/alerts/:id", (request, response) => {
  const existing = store.getAlert(request.params.id);
  if (!existing) {
    response.status(404).json({ error: "Alert not found." });
    return;
  }

  const alert = store.updateAlert(request.params.id, normalizeAlertInput(request.body, existing));
  syncFeed();
  response.json(alert);
});

app.delete("/api/alerts/:id", (request, response) => {
  store.deleteAlert(request.params.id);
  syncFeed();
  response.status(204).end();
});

app.post("/api/alerts/:id/test-notify", asyncRoute(async (request, response) => {
  const alert = store.getAlert(request.params.id);
  if (!alert) {
    response.status(404).json({ error: "Alert not found." });
    return;
  }

  const [quote] = await market.getQuotes([alert.instrument]);
  const delivery = await notifier.sendAlert(alert, quote, "test");
  const event = store.addEvent({
    type: "test",
    alertId: alert.id,
    instrument: alert.instrument,
    message: `Test notification for ${alert.label}`,
    quote,
    delivery
  });
  broadcast("event", event);
  response.json({ event, delivery });
}));

app.post("/api/notifications/test", asyncRoute(async (request, response) => {
  const channel = String(request.body.channel || "").toLowerCase();
  const result = await notifier.testChannel(channel);
  const event = store.addEvent({
    type: result.status.state === "verified" ? "channel_test" : "channel_test_failed",
    channel,
    message: result.status.lastTest.message,
    delivery: [result.delivery]
  });
  broadcast("event", event);

  if (result.status.state !== "verified") {
    response.status(result.status.state === "not_configured" ? 409 : 502).json({
      error: result.status.lastTest.message,
      ...result
    });
    return;
  }
  response.json({ ...result, event });
}));

app.get("/api/events", (_request, response) => {
  response.json(store.listEvents());
});

app.get("/api/stream", (request, response) => {
  response.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive"
  });
  response.write(`event: ready\ndata: ${JSON.stringify({ ok: true })}\n\n`);
  sseClients.add(response);
  request.on("close", () => sseClients.delete(response));
});

app.get("/auth/upstox/login", (request, response) => {
  if (!process.env.UPSTOX_API_KEY) {
    response.status(400).send("UPSTOX_API_KEY is not configured. Add it to .env first.");
    return;
  }

  const state = crypto.randomBytes(24).toString("hex");
  oauthStates.set(state, Date.now() + 10 * 60 * 1000);

  const loginUrl = new URL("https://api.upstox.com/v2/login/authorization/dialog");
  loginUrl.searchParams.set("response_type", "code");
  loginUrl.searchParams.set("client_id", process.env.UPSTOX_API_KEY);
  loginUrl.searchParams.set("redirect_uri", process.env.UPSTOX_REDIRECT_URL || "http://localhost:5175/auth/upstox/callback");
  loginUrl.searchParams.set("state", state);
  response.redirect(loginUrl.toString());
});

app.get("/auth/upstox/callback", asyncRoute(async (request, response) => {
  const code = String(request.query.code || "");
  const state = String(request.query.state || "");
  const stateExpiry = oauthStates.get(state);
  oauthStates.delete(state);

  if (!state || !stateExpiry || stateExpiry < Date.now()) {
    response.status(400).send("Invalid or expired Upstox login state. Start the connection again.");
    return;
  }

  if (!code) {
    response.status(400).send("Missing Upstox authorization code.");
    return;
  }

  if (!process.env.UPSTOX_API_KEY || !process.env.UPSTOX_API_SECRET) {
    response.status(400).send("UPSTOX_API_KEY and UPSTOX_API_SECRET are required.");
    return;
  }

  const upstoxResponse = await fetch("https://api.upstox.com/v2/login/authorization/token", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      code,
      client_id: process.env.UPSTOX_API_KEY,
      client_secret: process.env.UPSTOX_API_SECRET,
      redirect_uri: process.env.UPSTOX_REDIRECT_URL || "http://localhost:5175/auth/upstox/callback",
      grant_type: "authorization_code"
    })
  });

  const payload = await upstoxResponse.json().catch(() => ({}));
  if (!upstoxResponse.ok || !payload.access_token) {
    response.status(502).send(payload.errors?.[0]?.message || payload.message || "Upstox token exchange failed.");
    return;
  }

  store.saveUpstoxSession({
    ...payload,
    connectedAt: new Date().toISOString()
  });
  startLiveFeed().catch((error) => console.error(error));
  response.redirect("/?upstox=connected");
}));

app.post("/api/upstox/logout", (_request, response) => {
  store.clearUpstoxSession();
  feed?.stop();
  response.status(204).end();
});

app.get("*", (_request, response) => {
  response.sendFile(path.join(publicDir, "index.html"));
});

app.use((error, _request, response, _next) => {
  console.error(error);
  response.status(400).json({ error: error.message || "Request failed." });
});

const poller = createPoller({
  store,
  market,
  notifier,
  onEvent(event) {
    broadcast("event", event);
  }
});

let feedStatus = null;
const feed = market.isLive
  ? createUpstoxFeed({
      getAccessToken: market.upstox.getAccessToken,
      resolveInstrument: market.upstox.resolveInstrument,
      onQuote(quote) {
        broadcast("quote", quote);
        poller.processQuotes([quote]).catch((error) => console.error(error));
      },
      onStatus(status) {
        feedStatus = status;
      },
      onError(error) {
        feedStatus = { ...(feedStatus || {}), lastError: error.message };
        console.error(`[feed] ${error.message}`);
      }
    })
  : null;

function enabledInstruments() {
  return [...new Set(store.listAlerts().filter((alert) => alert.enabled).map((alert) => alert.instrument))];
}

function syncFeed() {
  if (!feed) return;
  feed.setInstruments(enabledInstruments()).catch((error) => console.error(error));
}

async function startLiveFeed() {
  if (!feed || !market.upstox.getAccessToken()) return;
  await feed.start();
  syncFeed();
}

const port = Number(process.env.PORT || 5175);
const sslCertFile = process.env.SSL_CERT_FILE;
const sslKeyFile = process.env.SSL_KEY_FILE;

function onListening(scheme) {
  if (feed) {
    startLiveFeed().catch((error) => console.error(error));
  } else {
    poller.start();
  }
  console.log(`AI Trade Alerts running at ${scheme}://localhost:${port}`);
}

function startServer() {
  if (sslCertFile && sslKeyFile) {
    const server = https.createServer(
      {
        cert: fs.readFileSync(sslCertFile),
        key: fs.readFileSync(sslKeyFile)
      },
      app
    );
    server.listen(port, () => onListening("https"));
    return;
  }

  app.listen(port, () => onListening("http"));
}

startServer();
