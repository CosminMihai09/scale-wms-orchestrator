const amqp = require("amqplib");
const queries = require("./queries");
const { getPool, runNamedQuery } = require("./db");

const RABBITMQ_URL = process.env.RABBITMQ_URL || "amqp://localhost:5672";
const EXCHANGE = "scale.topic";
const ROUTING_KEY = "worker";
const QUEUE = "scale.worker";
const PREFETCH = Number(process.env.WORKER_PREFETCH) || 20;

function sendReply(channel, msg, payload) {
  const replyTo = msg.properties.replyTo;
  const correlationId = msg.properties.correlationId;
  if (!replyTo || !correlationId) return;
  const content = Buffer.from(JSON.stringify(payload));
  channel.sendToQueue(replyTo, content, {
    correlationId,
    contentType: "application/json",
  });
}

function extractQueryRequest(payload) {
  const body = payload.body;
  if (!body || typeof body !== "object") {
    return { error: "Request body must be a JSON object with { query, params? }" };
  }
  const queryName = body.query;
  if (!queryName || typeof queryName !== "string") {
    return { error: "Missing or invalid 'query' field in request body" };
  }
  const params = body.params && typeof body.params === "object" ? body.params : {};
  return { queryName, params };
}

async function processMessage(channel, msg) {
  const payload = JSON.parse(msg.content.toString());
  const extracted = extractQueryRequest(payload);

  if (extracted.error) {
    sendReply(channel, msg, {
      statusCode: 400,
      body: { ok: false, error: extracted.error },
    });
    channel.ack(msg);
    return;
  }

  const { queryName, params } = extracted;
  const queryDef = queries[queryName];

  if (!queryDef) {
    sendReply(channel, msg, {
      statusCode: 400,
      body: {
        ok: false,
        error: `Unknown query: ${queryName}`,
        availableQueries: Object.keys(queries),
      },
    });
    channel.ack(msg);
    return;
  }

  try {
    const result = await runNamedQuery(queryDef, params);
    console.log("[WORKER] Query executed:", {
      service: "worker",
      at: new Date().toISOString(),
      query: queryName,
      rowCount: result.rowCount,
    });
    sendReply(channel, msg, {
      statusCode: 200,
      body: {
        ok: true,
        query: queryName,
        rowCount: result.rowCount,
        rows: result.rows,
      },
    });
    channel.ack(msg);
  } catch (err) {
    console.error("[WORKER] Query error:", err.message);
    sendReply(channel, msg, {
      statusCode: 500,
      body: { ok: false, error: err.message, query: queryName },
    });
    channel.ack(msg);
  }
}

async function run() {
  await getPool();

  const conn = await amqp.connect(RABBITMQ_URL);
  const channel = await conn.createChannel();
  await channel.assertExchange(EXCHANGE, "topic", { durable: true });
  await channel.assertQueue(QUEUE, { durable: true });
  await channel.bindQueue(QUEUE, EXCHANGE, ROUTING_KEY);
  channel.prefetch(PREFETCH);

  channel.consume(QUEUE, (msg) => {
    if (!msg) return;
    processMessage(channel, msg).catch((err) => {
      console.error("[WORKER] Unhandled error:", err);
      sendReply(channel, msg, {
        statusCode: 500,
        body: { ok: false, error: err.message },
      });
      channel.ack(msg);
    });
  });

  console.log(`Worker service bound to ${ROUTING_KEY} (prefetch=${PREFETCH})`);
}

function reconnect() {
  run().catch((err) => {
    console.error("Worker service connection failed:", err.message);
    setTimeout(reconnect, 5000);
  });
}

reconnect();
