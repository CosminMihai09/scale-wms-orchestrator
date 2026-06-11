const express = require("express");
const amqp = require("amqplib");
const crypto = require("crypto");

const RABBITMQ_URL = process.env.RABBITMQ_URL || "amqp://localhost:5672";
const EXCHANGE = "scale.topic";
const REPLY_QUEUE = "orchestrator.replies";
const ROUTING_HEADER = "x-routing-key";
const REPLY_TIMEOUT_MS = Number(process.env.REPLY_TIMEOUT_MS) || 30000;

let channel = null;
const pendingReplies = new Map();

async function connectRabbitMQ() {
  const conn = await amqp.connect(RABBITMQ_URL);
  channel = await conn.createChannel();
  await channel.assertExchange(EXCHANGE, "topic", { durable: true });
  await channel.assertQueue(REPLY_QUEUE, { durable: true });
  channel.prefetch(Number(process.env.ORCHESTRATOR_REPLY_PREFETCH) || 50);

  channel.consume(REPLY_QUEUE, (msg) => {
    if (!msg) return;
    const correlationId = msg.properties.correlationId;
    const pending = correlationId ? pendingReplies.get(correlationId) : null;
    if (pending) {
      clearTimeout(pending.timeoutHandle);
      pendingReplies.delete(correlationId);
      try {
        const raw = msg.content.toString();
        let payload;
        try {
          payload = JSON.parse(raw);
        } catch {
          payload = { body: raw };
        }
        const statusCode = payload.statusCode ?? 200;
        const body = payload.body !== undefined ? payload.body : payload;
        pending.resolve({ statusCode, body });
      } catch (err) {
        pending.reject(err);
      }
    }
    channel.ack(msg);
  });

  return channel;
}

function getRoutingKey(req) {
  const key = req.get(ROUTING_HEADER) || req.get("X-Routing-Key") || req.get("x-scale-routing-key");
  if (!key) return null;
  return key.trim();
}

function waitForReply(correlationId) {
  return new Promise((resolve, reject) => {
    const timeoutHandle = setTimeout(() => {
      if (pendingReplies.delete(correlationId)) {
        reject(new Error("Reply timeout"));
      }
    }, REPLY_TIMEOUT_MS);
    pendingReplies.set(correlationId, { resolve, reject, timeoutHandle });
  });
}

const app = express();
app.use(express.json({ limit: "10mb" }));
app.use(express.text({ type: "*/*", limit: "10mb" }));

app.get("/health", (req, res) => {
  res.json({ status: "ok", service: "orchestrator" });
});

app.all("*", async (req, res) => {
  const routingKey = getRoutingKey(req);
  if (!routingKey) {
    return res.status(400).json({
      error: "Missing routing key",
      hint: `Set header "${ROUTING_HEADER}" or "X-Routing-Key" (e.g. logging, worker)`,
    });
  }

  if (!channel) {
    return res.status(503).json({ error: "Orchestrator not connected to RabbitMQ" });
  }

  const payload = {
    method: req.method,
    path: req.path,
    query: req.query,
    headers: req.headers,
    body: req.body,
    timestamp: new Date().toISOString(),
  };

  const correlationId = crypto.randomUUID();

  try {
    const content = Buffer.from(JSON.stringify(payload));
    channel.publish(EXCHANGE, routingKey, content, {
      persistent: true,
      contentType: "application/json",
      replyTo: REPLY_QUEUE,
      correlationId,
    });

    const reply = await waitForReply(correlationId);
    const status = reply.statusCode ?? 200;
    res.status(status);
    if (reply.body !== undefined && reply.body !== null && typeof reply.body === "object" && !Buffer.isBuffer(reply.body)) {
      res.json(reply.body);
    } else {
      res.send(reply.body);
    }
  } catch (err) {
    if (err.message === "Reply timeout") {
      return res.status(504).json({ error: "Gateway timeout", message: "Microservice did not respond in time" });
    }
    console.error("Orchestrator error:", err);
    res.status(500).json({ error: "Failed to forward request" });
  }
});

const PORT = Number(process.env.ORCHESTRATOR_PORT) || 3000;

connectRabbitMQ()
  .then(() => {
    app.listen(PORT, "0.0.0.0", () => {
      console.log(`Orchestrator listening on port ${PORT} (request-reply)`);
    });
  })
  .catch((err) => {
    console.error("RabbitMQ connection failed:", err);
    process.exit(1);
  });
