export function metricLabel(metric) {
  const labels = {
    last_price: "price",
    percent_change: "percent change",
    change: "change",
    volume: "volume",
    oi: "open interest"
  };
  return labels[metric] || metric;
}

function metricValue(alert, quote) {
  const metric = alert.metric || "last_price";
  return Number(quote?.[metric]);
}

export function evaluateAlert(alert, quote) {
  const value = metricValue(alert, quote);
  const target = Number(alert.target);
  const previous = alert.lastValue === null || alert.lastValue === undefined ? null : Number(alert.lastValue);

  if (!Number.isFinite(value) || !Number.isFinite(target)) {
    return { matches: false, label: "invalid" };
  }

  switch (alert.operator) {
    case "above":
      return { matches: value > target, label: `${metricLabel(alert.metric)} above ${target}`, value };
    case "below":
      return { matches: value < target, label: `${metricLabel(alert.metric)} below ${target}`, value };
    case "at_or_above":
      return { matches: value >= target, label: `${metricLabel(alert.metric)} at or above ${target}`, value };
    case "at_or_below":
      return { matches: value <= target, label: `${metricLabel(alert.metric)} at or below ${target}`, value };
    case "crosses_above":
      return {
        matches: previous !== null && previous <= target && value > target,
        label: `${metricLabel(alert.metric)} crossed above ${target}`,
        value
      };
    case "crosses_below":
      return {
        matches: previous !== null && previous >= target && value < target,
        label: `${metricLabel(alert.metric)} crossed below ${target}`,
        value
      };
    default:
      return { matches: false, label: "unsupported", value };
  }
}

export function canTrigger(alert, now = Date.now()) {
  if (!alert.lastTriggeredAt) return true;
  const lastTriggered = new Date(alert.lastTriggeredAt).getTime();
  const cooldownMs = Number(alert.cooldownMinutes || 15) * 60 * 1000;
  return !Number.isFinite(lastTriggered) || now - lastTriggered >= cooldownMs;
}
