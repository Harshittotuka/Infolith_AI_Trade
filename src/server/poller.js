import { evaluateAlert, canTrigger } from "./evaluator.js";

function quoteMap(quotes) {
  return new Map(quotes.map((quote) => [quote.instrument, quote]));
}

export function createPoller({ store, market, notifier, onEvent }) {
  const intervalMs = Number(process.env.POLL_INTERVAL_MS || 15000);
  let timer = null;
  let running = false;

  async function processAlert(alert, quote) {
    const result = evaluateAlert(alert, quote);
    store.patchAlert(alert.id, {
      lastValue: result.value,
      lastQuote: quote,
      lastCheckedAt: new Date().toISOString()
    });

    if (!result.matches || !canTrigger(alert)) return;

    const delivery = await notifier.sendAlert(alert, quote, result.label);
    store.patchAlert(alert.id, {
      lastTriggeredAt: new Date().toISOString(),
      triggerCount: Number(alert.triggerCount || 0) + 1
    });

    const event = store.addEvent({
      type: "trigger",
      alertId: alert.id,
      instrument: alert.instrument,
      message: `${alert.label}: ${result.label}. Price ${quote.last_price}.`,
      quote,
      delivery
    });
    onEvent?.(event);
  }

  async function processQuotes(quotes) {
    const quotesByInstrument = quoteMap(quotes);
    const alerts = store.listAlerts().filter((alert) => alert.enabled);
    for (const alert of alerts) {
      const quote = quotesByInstrument.get(alert.instrument);
      if (!quote) continue;
      try {
        await processAlert(alert, quote);
      } catch (error) {
        const event = store.addEvent({
          type: "error",
          alertId: alert.id,
          instrument: alert.instrument,
          message: error.message || "Alert evaluation failed."
        });
        onEvent?.(event);
      }
    }
  }

  async function tick() {
    if (running) return;
    running = true;

    try {
      const alerts = store.listAlerts().filter((alert) => alert.enabled);
      const instruments = [...new Set(alerts.map((alert) => alert.instrument))];
      if (instruments.length === 0) return;

      const quotes = await market.getQuotes(instruments);
      await processQuotes(quotes);
    } catch (error) {
      const event = store.addEvent({
        type: "error",
        message: error.message || "Polling failed."
      });
      onEvent?.(event);
    } finally {
      running = false;
    }
  }

  return {
    start() {
      if (timer) return;
      tick();
      timer = setInterval(tick, intervalMs);
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    },
    tick,
    processQuotes
  };
}
