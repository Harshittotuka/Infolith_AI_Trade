const state = {
  alerts: [],
  events: [],
  status: null,
  instruments: [],
  selectedInstrument: null,
  activeTab: localStorage.getItem("signaldesk-tab") || "alerts"
};

const channelMeta = {
  email: { name: "Email", mark: "@", description: "Detailed alerts delivered to your inbox." },
  telegram: { name: "Telegram", mark: "TG", description: "Fast push messages through your Telegram bot." },
  sms: { name: "SMS", mark: "SMS", description: "Mobile alerts through Twilio or MSG91." },
  webhook: { name: "Webhook", mark: "WH", description: "Send structured events to any automation endpoint." },
  browser: { name: "Browser", mark: "WEB", description: "Desktop notifications while SignalDesk is open." }
};

const pageMeta = {
  alerts: { eyebrow: "Market monitoring", title: "Alert studio", description: "Create precise rules and monitor every signal in one place." },
  channels: { eyebrow: "Delivery setup", title: "Notification channels", description: "Configure, test and verify every way SignalDesk can reach you." },
  activity: { eyebrow: "System history", title: "Activity", description: "Review triggers, channel tests and delivery failures." }
};

const elements = {
  alertForm: document.querySelector("#alertForm"),
  alertsList: document.querySelector("#alertsList"),
  eventsList: document.querySelector("#eventsList"),
  eventCount: document.querySelector("#eventCount"),
  activeAlertCount: document.querySelector("#activeAlertCount"),
  providerBadge: document.querySelector("#providerBadge"),
  brokerCardText: document.querySelector("#brokerCardText"),
  connectButton: document.querySelector("#connectButton"),
  marketStat: document.querySelector("#marketStat"),
  pollStat: document.querySelector("#pollStat"),
  alertStat: document.querySelector("#alertStat"),
  channelStat: document.querySelector("#channelStat"),
  channelBadge: document.querySelector("#channelBadge"),
  notificationStat: document.querySelector("#notificationStat"),
  navAlertCount: document.querySelector("#navAlertCount"),
  navChannelCount: document.querySelector("#navChannelCount"),
  navEventCount: document.querySelector("#navEventCount"),
  channelGrid: document.querySelector("#channelGrid"),
  instrumentInput: document.querySelector("#instrumentInput"),
  instrumentKey: document.querySelector("#instrumentKey"),
  instrumentResults: document.querySelector("#instrumentResults"),
  selectedInstrument: document.querySelector("#selectedInstrument"),
  selectedChannelSummary: document.querySelector("#selectedChannelSummary"),
  refreshButton: document.querySelector("#refreshButton"),
  alertTemplate: document.querySelector("#alertTemplate"),
  targetUnit: document.querySelector("#targetUnit"),
  themeToggle: document.querySelector("#themeToggle"),
  themeLabel: document.querySelector("#themeLabel"),
  pageEyebrow: document.querySelector("#pageEyebrow"),
  pageTitle: document.querySelector("#pageTitle"),
  pageDescription: document.querySelector("#pageDescription"),
  headerDay: document.querySelector("#headerDay"),
  headerDate: document.querySelector("#headerDate"),
  toast: document.querySelector("#toast"),
  toastIcon: document.querySelector("#toastIcon"),
  toastTitle: document.querySelector("#toastTitle"),
  toastMessage: document.querySelector("#toastMessage")
};

let searchTimer = null;
let toastTimer = null;

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) }
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    const error = new Error(payload.error || "Request failed.");
    error.payload = payload;
    throw error;
  }
  if (response.status === 204) return null;
  return response.json();
}

function showToast(title, message = "", type = "success") {
  clearTimeout(toastTimer);
  elements.toast.className = `toast ${type}`;
  elements.toastIcon.textContent = type === "error" ? "!" : type === "warning" ? "i" : "OK";
  elements.toastTitle.textContent = title;
  elements.toastMessage.textContent = message;
  elements.toast.hidden = false;
  toastTimer = setTimeout(() => { elements.toast.hidden = true; }, 4200);
}

function formatPrice(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "--";
  return `INR ${Number(value).toLocaleString("en-IN", { maximumFractionDigits: 2, minimumFractionDigits: 2 })}`;
}

function formatTarget(alert) {
  const value = Number(alert.target).toLocaleString("en-IN", { maximumFractionDigits: 2 });
  return ["last_price", "change"].includes(alert.metric) ? `INR ${value}` : value;
}

function conditionLabel(alert) {
  const operators = { above: "above", below: "below", at_or_above: "at or above", at_or_below: "at or below", crosses_above: "crosses above", crosses_below: "crosses below" };
  const metrics = { last_price: "Price", percent_change: "% change", change: "Change", volume: "Volume", oi: "Open interest" };
  return `${metrics[alert.metric || "last_price"]} ${operators[alert.operator] || alert.operator} ${formatTarget(alert)}`;
}

function stateLabel(value) {
  return {
    not_configured: "Not configured",
    ready: "Ready to test",
    verified: "Verified",
    failed: "Test failed"
  }[value] || value;
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem("signaldesk-theme", theme);
  elements.themeLabel.textContent = theme === "dark" ? "Dark theme" : "Light theme";
  elements.themeToggle.setAttribute("aria-label", `Switch to ${theme === "dark" ? "light" : "dark"} theme`);
}

function activateTab(tab) {
  if (!pageMeta[tab]) tab = "alerts";
  state.activeTab = tab;
  localStorage.setItem("signaldesk-tab", tab);
  document.querySelectorAll("[data-tab]").forEach((button) => button.classList.toggle("active", button.dataset.tab === tab));
  document.querySelectorAll("[data-tab-panel]").forEach((panel) => {
    const active = panel.dataset.tabPanel === tab;
    panel.hidden = !active;
    panel.classList.toggle("active", active);
  });
  const meta = pageMeta[tab];
  elements.pageEyebrow.textContent = meta.eyebrow;
  elements.pageTitle.textContent = meta.title;
  elements.pageDescription.textContent = meta.description;
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function renderStatus() {
  const market = state.status?.market;
  const notifications = state.status?.notifications;
  if (!market || !notifications) return;

  const isLive = market.provider === "upstox" && market.connected;
  const wantsUpstox = market.requestedProvider === "upstox";
  const providerText = isLive ? "Live market data" : wantsUpstox ? "Connection pending" : "Demo market data";
  const badgeText = isLive ? "Upstox live" : wantsUpstox ? "Upstox offline" : "Demo feed";
  elements.providerBadge.innerHTML = `<i></i>${badgeText}`;
  elements.providerBadge.className = `status-badge ${isLive ? "verified" : wantsUpstox ? "failed" : "ready"}`;
  elements.brokerCardText.textContent = providerText;
  elements.connectButton.textContent = isLive ? "Reconnect Upstox" : "Connect Upstox";
  elements.marketStat.textContent = isLive ? "Live" : wantsUpstox ? "Offline" : "Demo";
  const streaming = state.status.feed?.connected;
  elements.pollStat.textContent = streaming
    ? `Live streaming (${state.status.feed.subscribed} instruments)`
    : `Checks every ${Math.round(state.status.pollIntervalMs / 1000)} seconds`;

  const channels = notifications.channels || {};
  const channelValues = Object.values(channels);
  const verified = channelValues.filter((channel) => channel.state === "verified").length;
  const configured = channelValues.filter((channel) => channel.configured).length;
  elements.channelStat.textContent = String(verified);
  elements.channelBadge.textContent = verified ? `${verified} of 4 delivery channels confirmed` : configured ? `${configured} ready for testing` : "Set up a channel to begin";
  elements.navChannelCount.textContent = verified ? String(verified) : configured ? String(configured) : "";

  for (const [channel, details] of Object.entries(channels)) {
    const choice = document.querySelector(`[data-choice-channel="${channel}"]`);
    if (!choice) continue;
    const input = choice.querySelector("input");
    input.disabled = !details.configured;
    if (!details.configured) input.checked = false;
    choice.className = `channel-choice ${details.configured ? "available" : "unavailable"} ${details.state}`;
    choice.querySelector("[data-choice-status]").textContent = stateLabel(details.state);
  }
  updateSelectedChannels();
}

function renderAlerts() {
  elements.alertsList.replaceChildren();
  const enabledCount = state.alerts.filter((alert) => alert.enabled).length;
  elements.activeAlertCount.textContent = String(enabledCount);
  elements.alertStat.textContent = String(enabledCount);
  elements.navAlertCount.textContent = String(enabledCount);

  if (!state.alerts.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.innerHTML = '<span>+</span><strong>No alert rules yet</strong><p>Use the builder to create your first market signal.</p>';
    elements.alertsList.append(empty);
    return;
  }

  for (const alert of state.alerts) {
    const card = elements.alertTemplate.content.firstElementChild.cloneNode(true);
    card.dataset.alertId = alert.id;
    card.dataset.instrument = alert.instrument;
    card.classList.toggle("paused", !alert.enabled);
    card.querySelector('[data-field="label"]').textContent = alert.label;
    card.querySelector('[data-field="instrument"]').textContent = alert.instrument;
    card.querySelector('[data-field="avatar"]').textContent = (alert.label || alert.instrument).trim().slice(0, 2).toUpperCase();
    card.querySelector('[data-field="price"]').textContent = formatPrice(alert.lastQuote?.last_price ?? alert.lastValue);
    const percent = alert.lastQuote?.percent_change;
    const change = card.querySelector('[data-field="change"]');
    change.textContent = percent === null || percent === undefined ? "Waiting for market data" : `${Number(percent) > 0 ? "+" : ""}${percent}% today`;
    change.classList.toggle("up", Number(percent) > 0);
    change.classList.toggle("down", Number(percent) < 0);
    card.querySelector('[data-field="condition"]').textContent = conditionLabel(alert);
    card.querySelector('[data-field="triggerCount"]').textContent = `${alert.triggerCount || 0} trigger${Number(alert.triggerCount) === 1 ? "" : "s"}`;
    const ruleState = card.querySelector('[data-field="state"]');
    ruleState.textContent = alert.enabled ? "Monitoring" : "Paused";
    ruleState.className = `rule-state ${alert.enabled ? "verified" : "paused"}`;

    const channels = card.querySelector('[data-field="channels"]');
    const selectedChannels = Object.entries(alert.channels || {}).filter(([, selected]) => selected).map(([name]) => name);
    if (!selectedChannels.length) {
      const badge = document.createElement("span");
      badge.textContent = "Browser only";
      channels.append(badge);
    } else {
      selectedChannels.forEach((name) => {
        const badge = document.createElement("span");
        badge.textContent = channelMeta[name]?.name || name;
        channels.append(badge);
      });
    }

    const toggleButton = card.querySelector('[data-action="toggle"]');
    toggleButton.textContent = alert.enabled ? "Pause" : "Resume";
    toggleButton.addEventListener("click", () => updateAlert(alert.id, { ...alert, enabled: !alert.enabled }));
    card.querySelector('[data-action="test"]').addEventListener("click", () => testAlert(alert.id));
    card.querySelector('[data-action="delete"]').addEventListener("click", () => deleteAlert(alert));
    elements.alertsList.append(card);
  }
}

function applyLiveQuote(quote) {
  if (!quote?.instrument) return;
  let touched = false;
  for (const alert of state.alerts) {
    if (alert.instrument !== quote.instrument) continue;
    alert.lastQuote = quote;
    alert.lastValue = quote[alert.metric] ?? quote.last_price;
    touched = true;
  }
  if (!touched) return;

  const percent = quote.percent_change;
  document.querySelectorAll(`[data-instrument=${JSON.stringify(quote.instrument)}]`).forEach((card) => {
    const priceEl = card.querySelector('[data-field="price"]');
    if (priceEl) priceEl.textContent = formatPrice(quote.last_price);
    const change = card.querySelector('[data-field="change"]');
    if (change) {
      change.textContent = percent === null || percent === undefined ? "Waiting for market data" : `${Number(percent) > 0 ? "+" : ""}${percent}% today`;
      change.classList.toggle("up", Number(percent) > 0);
      change.classList.toggle("down", Number(percent) < 0);
    }
    card.classList.remove("live-tick");
    void card.offsetWidth;
    card.classList.add("live-tick");
  });
}

function renderEvents() {
  elements.eventsList.replaceChildren();
  elements.eventCount.textContent = String(state.events.length);
  elements.navEventCount.textContent = state.events.length ? String(Math.min(state.events.length, 99)) : "";
  elements.notificationStat.textContent = String(state.events.length);

  if (!state.events.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state small";
    empty.innerHTML = '<span>0</span><strong>No activity recorded</strong><p>Triggers and test deliveries will appear here.</p>';
    elements.eventsList.append(empty);
    return;
  }

  for (const event of state.events.slice(0, 100)) {
    const failed = event.type === "error" || event.type === "channel_test_failed";
    const item = document.createElement("article");
    item.className = `event-item ${failed ? "failed" : "success"}`;
    const marker = document.createElement("span");
    marker.className = "event-marker";
    marker.textContent = failed ? "!" : "OK";
    const copy = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = event.message || event.type;
    const meta = document.createElement("span");
    meta.textContent = `${event.channel || event.instrument || "System"} | ${new Date(event.createdAt).toLocaleString("en-IN")}`;
    copy.append(title, meta);
    const type = document.createElement("em");
    type.textContent = (event.type || "event").replaceAll("_", " ");
    item.append(marker, copy, type);
    elements.eventsList.append(item);
  }
}

function createChannelCard(channel, details) {
  const meta = channelMeta[channel];
  const card = document.createElement("article");
  card.className = `channel-card ${details.state}`;
  card.dataset.channelCard = channel;

  const head = document.createElement("div");
  head.className = "channel-card-head";
  const mark = document.createElement("span");
  mark.className = "channel-mark";
  mark.textContent = meta.mark;
  const identity = document.createElement("div");
  const name = document.createElement("h3");
  name.textContent = meta.name;
  const provider = document.createElement("p");
  provider.textContent = details.provider;
  identity.append(name, provider);
  const status = document.createElement("span");
  status.className = `channel-status ${details.state}`;
  status.textContent = stateLabel(details.state);
  head.append(mark, identity, status);

  const description = document.createElement("p");
  description.className = "channel-description";
  description.textContent = meta.description;
  const destination = document.createElement("div");
  destination.className = "channel-destination";
  destination.innerHTML = '<span>Destination</span>';
  const destinationValue = document.createElement("strong");
  destinationValue.textContent = details.destination;
  destination.append(destinationValue);

  const requirements = document.createElement("div");
  requirements.className = "requirement-list";
  for (const requirement of details.requirements || []) {
    const tag = document.createElement("code");
    tag.textContent = requirement;
    requirements.append(tag);
  }

  const lastTest = document.createElement("div");
  lastTest.className = `last-test ${details.lastTest ? details.state : "untested"}`;
  const testLabel = document.createElement("span");
  testLabel.textContent = details.lastTest ? details.lastTest.message : details.configured ? "Configured, but not tested yet." : "Add the variables above, then restart the app.";
  const testTime = document.createElement("small");
  testTime.textContent = details.lastTest?.testedAt ? `Last tested ${new Date(details.lastTest.testedAt).toLocaleString("en-IN")}` : "No delivery test recorded";
  lastTest.append(testLabel, testTime);

  const button = document.createElement("button");
  button.type = "button";
  button.className = "button button-secondary full channel-test-button";
  button.disabled = !details.configured;
  button.dataset.testChannel = channel;
  button.textContent = !details.configured ? "Configure first" : details.state === "verified" ? "Send another test" : details.state === "failed" ? "Retry test" : "Send real test";
  button.addEventListener("click", () => testNotificationChannel(channel, button));
  const note = document.createElement("small");
  note.className = "real-test-note";
  note.textContent = details.configured ? "This sends a real message to the masked destination." : "Credentials are read from .env on startup.";
  card.append(head, description, destination, requirements, lastTest, button, note);
  return card;
}

function createBrowserChannelCard() {
  const supported = "Notification" in window;
  const permission = supported ? Notification.permission : "unsupported";
  const details = {
    state: permission === "granted" ? "verified" : permission === "denied" || !supported ? "failed" : "ready",
    configured: supported,
    provider: "Web Notifications",
    destination: permission === "granted" ? "This browser" : permission === "denied" ? "Permission blocked" : "Permission not requested",
    requirements: ["Browser permission"],
    lastTest: null
  };
  const card = createChannelCard("browser", details);
  card.querySelector(".channel-mark").textContent = "WEB";
  card.querySelector("h3").textContent = "Browser";
  card.querySelector(".channel-description").textContent = "Desktop notifications while SignalDesk is open in this browser.";
  const button = card.querySelector("button");
  button.disabled = !supported || permission === "denied";
  button.removeAttribute("data-test-channel");
  button.textContent = permission === "granted" ? "Show test notification" : permission === "denied" ? "Permission blocked" : "Enable and test";
  button.replaceWith(button.cloneNode(true));
  card.querySelector("button").addEventListener("click", testBrowserNotification);
  card.querySelector(".real-test-note").textContent = "Browser permission is stored by your browser, not in .env.";
  return card;
}

function renderChannels() {
  elements.channelGrid.replaceChildren();
  const channels = state.status?.notifications?.channels || {};
  for (const channel of ["email", "telegram", "sms", "webhook"]) {
    if (channels[channel]) elements.channelGrid.append(createChannelCard(channel, channels[channel]));
  }
  elements.channelGrid.append(createBrowserChannelCard());
}

async function loadAll() {
  const [status, alerts, events] = await Promise.all([api("/api/status"), api("/api/alerts"), api("/api/events")]);
  state.status = status;
  state.alerts = alerts;
  state.events = events;
  renderStatus();
  renderAlerts();
  renderEvents();
  renderChannels();
}

function selectInstrument(instrument) {
  state.selectedInstrument = instrument;
  elements.instrumentKey.value = instrument.key;
  elements.instrumentInput.value = `${instrument.symbol} | ${instrument.exchange}`;
  elements.selectedInstrument.textContent = `${instrument.name} | ${instrument.type} | ${instrument.key}`;
  elements.selectedInstrument.classList.add("selected");
  elements.instrumentResults.hidden = true;
  const labelInput = elements.alertForm.elements.label;
  if (!labelInput.value) labelInput.value = `${instrument.symbol} alert`;
}

function renderInstrumentResults() {
  elements.instrumentResults.replaceChildren();
  if (!state.instruments.length) {
    const empty = document.createElement("div");
    empty.className = "instrument-empty";
    empty.textContent = "No matching instruments found.";
    elements.instrumentResults.append(empty);
  } else {
    for (const instrument of state.instruments) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "instrument-option";
      button.setAttribute("role", "option");
      const identity = document.createElement("span");
      const symbol = document.createElement("strong");
      symbol.textContent = instrument.symbol;
      const name = document.createElement("small");
      name.textContent = instrument.name;
      identity.append(symbol, name);
      const meta = document.createElement("em");
      meta.textContent = `${instrument.exchange} | ${instrument.type}`;
      button.append(identity, meta);
      button.addEventListener("click", () => selectInstrument(instrument));
      elements.instrumentResults.append(button);
    }
  }
  elements.instrumentResults.hidden = false;
}

async function updateInstruments(query = "") {
  elements.instrumentResults.innerHTML = '<div class="instrument-empty">Searching the Upstox catalogue...</div>';
  elements.instrumentResults.hidden = false;
  state.instruments = await api(`/api/instruments?q=${encodeURIComponent(query)}`);
  renderInstrumentResults();
}

function updateSelectedChannels() {
  const selected = [...document.querySelectorAll(".channel-choice input:checked")].map((input) => channelMeta[input.name]?.name || input.name);
  elements.selectedChannelSummary.textContent = selected.length
    ? `${selected.length} channel${selected.length === 1 ? "" : "s"} selected: ${selected.join(", ")}.`
    : "No server delivery channel selected. Configure one in the Channels tab.";
  elements.selectedChannelSummary.closest(".selection-summary").classList.toggle("has-selection", selected.length > 0);
}

async function createAlert(formData) {
  const instrument = formData.get("instrument");
  if (!instrument) throw new Error("Select an instrument from the search results first.");
  await api("/api/alerts", {
    method: "POST",
    body: JSON.stringify({
      instrument,
      label: formData.get("label") || state.selectedInstrument?.symbol || instrument,
      metric: formData.get("metric"),
      operator: formData.get("operator"),
      target: Number(formData.get("target")),
      cooldownMinutes: Number(formData.get("cooldownMinutes")),
      enabled: true,
      channels: {
        email: formData.get("email") === "on",
        telegram: formData.get("telegram") === "on",
        sms: formData.get("sms") === "on",
        webhook: formData.get("webhook") === "on"
      }
    })
  });
}

async function updateAlert(id, payload) {
  try {
    await api(`/api/alerts/${id}`, { method: "PATCH", body: JSON.stringify(payload) });
    await loadAll();
    showToast(payload.enabled ? "Alert resumed" : "Alert paused", "The monitoring state was updated.");
  } catch (error) {
    showToast("Could not update alert", error.message, "error");
  }
}

async function deleteAlert(alert) {
  if (!window.confirm(`Delete "${alert.label}"?`)) return;
  try {
    await api(`/api/alerts/${alert.id}`, { method: "DELETE" });
    await loadAll();
    showToast("Alert deleted", "The rule is no longer being monitored.");
  } catch (error) {
    showToast("Could not delete alert", error.message, "error");
  }
}

async function testAlert(id) {
  try {
    await api(`/api/alerts/${id}/test-notify`, { method: "POST" });
    await loadAll();
    showToast("Alert test processed", "Review the Activity tab for delivery results.");
  } catch (error) {
    showToast("Alert test failed", error.message, "error");
  }
}

async function testNotificationChannel(channel, button) {
  const name = channelMeta[channel].name;
  button.disabled = true;
  button.textContent = "Sending test...";
  try {
    await api("/api/notifications/test", { method: "POST", body: JSON.stringify({ channel }) });
    await loadAll();
    showToast(`${name} verified`, "The provider accepted the test. Confirm it arrived at the destination.");
  } catch (error) {
    await loadAll().catch(() => {});
    showToast(`${name} test failed`, error.message, "error");
  }
}

async function testBrowserNotification() {
  if (!("Notification" in window)) {
    showToast("Browser notifications unavailable", "This browser does not support desktop notifications.", "error");
    return;
  }
  const permission = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
  if (permission !== "granted") {
    renderChannels();
    showToast("Permission not granted", "Allow notifications in your browser settings, then retry.", "warning");
    return;
  }
  new Notification("SignalDesk channel test", { body: "Browser notifications are working." });
  renderChannels();
  showToast("Browser verified", "A desktop test notification was created.");
}

function maybeNotify(event) {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  if (!["trigger", "test"].includes(event.type)) return;
  new Notification("SignalDesk alert", { body: event.message || event.instrument || "Condition matched" });
}

elements.alertForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = elements.alertForm.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    await createAlert(new FormData(elements.alertForm));
    elements.alertForm.reset();
    elements.alertForm.elements.cooldownMinutes.value = 15;
    state.selectedInstrument = null;
    elements.instrumentKey.value = "";
    elements.instrumentInput.value = "";
    elements.selectedInstrument.textContent = "Choose one result from the catalogue.";
    elements.selectedInstrument.classList.remove("selected");
    await loadAll();
    showToast("Alert created", "Monitoring has started for this rule.");
  } catch (error) {
    showToast("Could not create alert", error.message, "error");
  } finally {
    button.disabled = false;
  }
});

elements.instrumentInput.addEventListener("input", () => {
  state.selectedInstrument = null;
  elements.instrumentKey.value = "";
  elements.selectedInstrument.textContent = "Choose one result from the catalogue.";
  elements.selectedInstrument.classList.remove("selected");
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => updateInstruments(elements.instrumentInput.value).catch((error) => showToast("Search failed", error.message, "error")), 260);
});
elements.instrumentInput.addEventListener("focus", () => updateInstruments(elements.instrumentInput.value).catch((error) => showToast("Search failed", error.message, "error")));
elements.alertForm.elements.metric.addEventListener("change", (event) => {
  elements.targetUnit.textContent = { last_price: "INR", change: "INR", percent_change: "%", volume: "#", oi: "#" }[event.target.value] || "#";
});
document.querySelectorAll(".channel-choice input").forEach((input) => input.addEventListener("change", updateSelectedChannels));
document.addEventListener("click", (event) => { if (!event.target.closest(".instrument-field")) elements.instrumentResults.hidden = true; });
document.querySelectorAll("[data-tab]").forEach((button) => button.addEventListener("click", () => activateTab(button.dataset.tab)));
document.querySelectorAll("[data-go-tab]").forEach((button) => button.addEventListener("click", () => activateTab(button.dataset.goTab)));
elements.themeToggle.addEventListener("click", () => applyTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark"));
elements.refreshButton.addEventListener("click", () => loadAll().then(() => showToast("Dashboard refreshed", "Latest status and activity loaded.")).catch((error) => showToast("Refresh failed", error.message, "error")));

const now = new Date();
elements.headerDay.textContent = now.toLocaleDateString("en-IN", { weekday: "long" });
elements.headerDate.textContent = now.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
applyTheme(document.documentElement.dataset.theme || "light");
activateTab(state.activeTab);

const stream = new EventSource("/api/stream");
stream.addEventListener("event", (message) => {
  const event = JSON.parse(message.data);
  maybeNotify(event);
  loadAll().catch(console.error);
});
stream.addEventListener("quote", (message) => {
  try {
    applyLiveQuote(JSON.parse(message.data));
  } catch (error) {
    console.error(error);
  }
});

if (new URLSearchParams(window.location.search).get("upstox") === "connected") {
  showToast("Upstox connected", "Live market data is now available.");
  window.history.replaceState({}, "", "/");
}

loadAll().catch((error) => {
  elements.providerBadge.textContent = "Server unavailable";
  elements.providerBadge.className = "status-badge failed";
  showToast("Could not load dashboard", error.message, "error");
});
setInterval(() => loadAll().catch(console.error), 10000);
