import nodemailer from "nodemailer";

function compact(value) {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => Boolean(entry)));
}

function maskEmail(value = "") {
  const [name, domain] = value.split("@");
  if (!name || !domain) return "Configured recipient";
  return `${name.slice(0, 1)}${"*".repeat(Math.min(Math.max(name.length - 1, 3), 8))}@${domain}`;
}

function maskIdentifier(value = "") {
  const text = String(value);
  return text ? `••••${text.slice(-4)}` : "Configured destination";
}

function webhookDestination(value = "") {
  try {
    return new URL(value).hostname;
  } catch {
    return value ? "Configured endpoint" : "";
  }
}

function formatMessage(alert, quote, reason) {
  const price = quote?.last_price ?? "unknown";
  const change = quote?.percent_change === null || quote?.percent_change === undefined ? "" : ` (${quote.percent_change}%)`;
  return [
    `Trade alert: ${alert.label}`,
    `Instrument: ${alert.instrument}`,
    `Condition: ${reason}`,
    `Metric: ${alert.metric || "last_price"}`,
    `Last price: ${price}${change}`,
    `Time: ${new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}`
  ].join("\n");
}

async function assertOk(response, fallbackMessage) {
  if (response.ok) return;
  const text = await response.text().catch(() => "");
  throw new Error(text || fallbackMessage);
}

export function createNotifier() {
  const lastTests = new Map();
  const smtpConfigured = Boolean(process.env.SMTP_HOST && process.env.ALERT_EMAIL_TO);
  const telegramConfigured = Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID);
  const twilioConfigured = Boolean(
    process.env.SMS_PROVIDER === "twilio" &&
      process.env.TWILIO_ACCOUNT_SID &&
      process.env.TWILIO_AUTH_TOKEN &&
      process.env.TWILIO_FROM &&
      process.env.TWILIO_TO
  );
  const msg91Configured = Boolean(
    process.env.SMS_PROVIDER === "msg91" &&
      process.env.MSG91_AUTH_KEY &&
      process.env.MSG91_TEMPLATE_ID &&
      process.env.MSG91_TO_MOBILE
  );
  const webhookConfigured = Boolean(process.env.NOTIFY_WEBHOOK_URL);

  const transporter = smtpConfigured
    ? nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT || 587),
        secure: String(process.env.SMTP_SECURE || "false") === "true",
        auth: compact({
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS
        })
      })
    : null;

  const channelConfiguration = {
    email: {
      configured: smtpConfigured,
      provider: "SMTP",
      destination: smtpConfigured ? maskEmail(process.env.ALERT_EMAIL_TO) : "Add SMTP settings",
      requirements: ["SMTP_HOST", "ALERT_EMAIL_TO"]
    },
    telegram: {
      configured: telegramConfigured,
      provider: "Telegram Bot API",
      destination: telegramConfigured ? maskIdentifier(process.env.TELEGRAM_CHAT_ID) : "Add bot token and chat ID",
      requirements: ["TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID"]
    },
    sms: {
      configured: twilioConfigured || msg91Configured,
      provider: twilioConfigured ? "Twilio" : msg91Configured ? "MSG91" : "Twilio or MSG91",
      destination: twilioConfigured
        ? maskIdentifier(process.env.TWILIO_TO)
        : msg91Configured
          ? maskIdentifier(process.env.MSG91_TO_MOBILE)
          : "Choose and configure an SMS provider",
      requirements: process.env.SMS_PROVIDER === "msg91"
        ? ["MSG91_AUTH_KEY", "MSG91_TEMPLATE_ID", "MSG91_TO_MOBILE"]
        : ["SMS_PROVIDER", "TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM", "TWILIO_TO"]
    },
    webhook: {
      configured: webhookConfigured,
      provider: "HTTP POST",
      destination: webhookConfigured ? webhookDestination(process.env.NOTIFY_WEBHOOK_URL) : "Add a webhook endpoint",
      requirements: ["NOTIFY_WEBHOOK_URL"]
    }
  };

  function channelStatus(channel) {
    const config = channelConfiguration[channel];
    const lastTest = lastTests.get(channel) || null;
    const state = lastTest
      ? lastTest.ok
        ? "verified"
        : lastTest.skipped
          ? "not_configured"
          : "failed"
      : config.configured
        ? "ready"
        : "not_configured";
    return { ...config, state, lastTest };
  }

  async function sendEmail(alert, quote, reason) {
    if (!transporter) return { channel: "email", skipped: true, reason: "not configured" };
    await transporter.sendMail({
      from: process.env.ALERT_EMAIL_FROM || process.env.SMTP_USER,
      to: process.env.ALERT_EMAIL_TO,
      subject: `Trade alert: ${alert.label}`,
      text: formatMessage(alert, quote, reason)
    });
    return { channel: "email", ok: true };
  }

  async function sendTelegram(alert, quote, reason) {
    if (!telegramConfigured) return { channel: "telegram", skipped: true, reason: "not configured" };
    const response = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: process.env.TELEGRAM_CHAT_ID,
        text: formatMessage(alert, quote, reason)
      })
    });
    await assertOk(response, "Telegram notification failed.");
    return { channel: "telegram", ok: true };
  }

  async function sendTwilioSms(alert, quote, reason) {
    if (!twilioConfigured) return { channel: "sms", skipped: true, reason: "twilio not configured" };
    const auth = Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString("base64");
    const response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${process.env.TWILIO_ACCOUNT_SID}/Messages.json`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${auth}`,
          "Content-Type": "application/x-www-form-urlencoded"
        },
        body: new URLSearchParams({
          From: process.env.TWILIO_FROM,
          To: process.env.TWILIO_TO,
          Body: formatMessage(alert, quote, reason)
        })
      }
    );
    await assertOk(response, "Twilio SMS failed.");
    return { channel: "sms", provider: "twilio", ok: true };
  }

  async function sendMsg91Sms(alert, quote, reason) {
    if (!msg91Configured) return { channel: "sms", skipped: true, reason: "msg91 not configured" };
    const message = formatMessage(alert, quote, reason);
    const response = await fetch("https://control.msg91.com/api/v5/flow/", {
      method: "POST",
      headers: {
        authkey: process.env.MSG91_AUTH_KEY,
        "Content-Type": "application/json",
        accept: "application/json"
      },
      body: JSON.stringify({
        template_id: process.env.MSG91_TEMPLATE_ID,
        short_url: "0",
        recipients: [
          {
            mobiles: process.env.MSG91_TO_MOBILE,
            message,
            var1: alert.label,
            var2: alert.instrument,
            var3: String(quote?.last_price ?? "")
          }
        ]
      })
    });
    await assertOk(response, "MSG91 SMS failed.");
    return { channel: "sms", provider: "msg91", ok: true };
  }

  async function sendSms(alert, quote, reason) {
    if (process.env.SMS_PROVIDER === "twilio") return sendTwilioSms(alert, quote, reason);
    if (process.env.SMS_PROVIDER === "msg91") return sendMsg91Sms(alert, quote, reason);
    return { channel: "sms", skipped: true, reason: "provider not configured" };
  }

  async function sendWebhook(alert, quote, reason) {
    if (!webhookConfigured) return { channel: "webhook", skipped: true, reason: "not configured" };
    const response = await fetch(process.env.NOTIFY_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        alert,
        quote,
        reason,
        message: formatMessage(alert, quote, reason)
      })
    });
    await assertOk(response, "Webhook notification failed.");
    return { channel: "webhook", ok: true };
  }

  const channelSenders = {
    email: sendEmail,
    telegram: sendTelegram,
    sms: sendSms,
    webhook: sendWebhook
  };

  async function testChannel(channel) {
    const sender = channelSenders[channel];
    if (!sender) throw new Error("Unsupported notification channel.");

    const alert = {
      label: "SignalDesk channel test",
      instrument: "SYSTEM:TEST",
      metric: "last_price"
    };
    const quote = { last_price: 300, percent_change: 0, source: "test" };
    let delivery;
    try {
      delivery = await sender(alert, quote, "test message - channel is working");
    } catch (error) {
      delivery = { channel, ok: false, error: error.message || "Notification test failed." };
    }

    const lastTest = {
      ok: delivery.ok === true,
      skipped: delivery.skipped === true,
      message: delivery.ok
        ? "Test accepted by the provider. Confirm it arrived."
        : delivery.skipped
          ? "Channel is not configured."
          : delivery.error || delivery.reason || "Test delivery failed.",
      testedAt: new Date().toISOString()
    };
    lastTests.set(channel, lastTest);
    return { channel, delivery, status: channelStatus(channel) };
  }

  return {
    status() {
      return {
        email: smtpConfigured,
        telegram: telegramConfigured,
        sms: twilioConfigured || msg91Configured,
        smsProvider: process.env.SMS_PROVIDER || null,
        webhook: webhookConfigured,
        channels: Object.fromEntries(Object.keys(channelConfiguration).map((channel) => [channel, channelStatus(channel)]))
      };
    },
    testChannel,
    async sendAlert(alert, quote, reason) {
      const tasks = [];
      if (alert.channels?.email) tasks.push(sendEmail(alert, quote, reason));
      if (alert.channels?.telegram) tasks.push(sendTelegram(alert, quote, reason));
      if (alert.channels?.sms) tasks.push(sendSms(alert, quote, reason));
      if (alert.channels?.webhook) tasks.push(sendWebhook(alert, quote, reason));

      if (tasks.length === 0) {
        return [{ channel: "none", skipped: true, reason: "no channels selected" }];
      }

      const results = await Promise.allSettled(tasks);
      return results.map((result) => {
        if (result.status === "fulfilled") return result.value;
        return { ok: false, error: result.reason?.message || "Notification failed." };
      });
    }
  };
}
