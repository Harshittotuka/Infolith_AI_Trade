import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(filePath, value) {
  const tempPath = `${filePath}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(value, null, 2));
  fs.renameSync(tempPath, filePath);
}

export function createStore({ rootDir }) {
  const dataDir = path.join(rootDir, "data");
  ensureDir(dataDir);

  const alertsFile = path.join(dataDir, "alerts.json");
  const eventsFile = path.join(dataDir, "events.json");
  const upstoxSessionFile = path.join(dataDir, "upstox-session.json");

  function listAlerts() {
    return readJson(alertsFile, []);
  }

  function saveAlerts(alerts) {
    writeJson(alertsFile, alerts);
  }

  function listEvents() {
    return readJson(eventsFile, []);
  }

  function saveEvents(events) {
    writeJson(eventsFile, events.slice(0, 250));
  }

  return {
    listAlerts,
    getAlert(id) {
      return listAlerts().find((alert) => alert.id === id) || null;
    },
    createAlert(input) {
      const now = new Date().toISOString();
      const alert = {
        id: crypto.randomUUID(),
        createdAt: now,
        updatedAt: now,
        lastValue: null,
        lastCheckedAt: null,
        lastTriggeredAt: null,
        triggerCount: 0,
        ...input
      };
      saveAlerts([alert, ...listAlerts()]);
      return alert;
    },
    updateAlert(id, input) {
      const alerts = listAlerts();
      const index = alerts.findIndex((alert) => alert.id === id);
      if (index === -1) return null;

      alerts[index] = {
        ...alerts[index],
        ...input,
        updatedAt: new Date().toISOString()
      };
      saveAlerts(alerts);
      return alerts[index];
    },
    patchAlert(id, patch) {
      const alerts = listAlerts();
      const index = alerts.findIndex((alert) => alert.id === id);
      if (index === -1) return null;

      alerts[index] = {
        ...alerts[index],
        ...patch,
        updatedAt: new Date().toISOString()
      };
      saveAlerts(alerts);
      return alerts[index];
    },
    deleteAlert(id) {
      saveAlerts(listAlerts().filter((alert) => alert.id !== id));
    },
    listEvents,
    addEvent(input) {
      const event = {
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        ...input
      };
      saveEvents([event, ...listEvents()]);
      return event;
    },
    getUpstoxSession() {
      return readJson(upstoxSessionFile, null);
    },
    saveUpstoxSession(session) {
      writeJson(upstoxSessionFile, session);
    },
    clearUpstoxSession() {
      if (fs.existsSync(upstoxSessionFile)) {
        fs.unlinkSync(upstoxSessionFile);
      }
    }
  };
}
