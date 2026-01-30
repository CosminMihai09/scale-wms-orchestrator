const amqp = require("amqplib");

const RABBITMQ_URL = process.env.RABBITMQ_URL || "amqp://localhost:5672";
const EXCHANGE = "scale.topic";
const ROUTING_KEY = "worker";
const QUEUE = "scale.worker";

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

async function run() {
  const conn = await amqp.connect(RABBITMQ_URL);
  const channel = await conn.createChannel();
  await channel.assertExchange(EXCHANGE, "topic", { durable: true });
  await channel.assertQueue(QUEUE, { durable: true });
  await channel.bindQueue(QUEUE, EXCHANGE, ROUTING_KEY);
  channel.prefetch(1);

  channel.consume(QUEUE, (msg) => {
    if (!msg) return;
    try {
      const payload = JSON.parse(msg.content.toString());
      console.log("[WORKER] Processing job:", {
        service: "mock-worker",
        at: new Date().toISOString(),
        method: payload.method,
        path: payload.path,
        body: payload.body,
      });
      sendReply(channel, msg, {
        statusCode: 200,
        body: {
          ok: true,
          processed: true,
          path: payload.path,
          body: payload.body,
        },
      });
      channel.ack(msg);
    } catch (err) {
      console.error("Mock worker service error:", err);
      sendReply(channel, msg, {
        statusCode: 500,
        body: { error: err.message },
      });
      channel.ack(msg);
    }
  });

  console.log("Mock worker service bound to", ROUTING_KEY);
}

function reconnect() {
  run().catch((err) => {
    console.error("Mock worker service connection failed:", err.message);
    setTimeout(reconnect, 5000);
  });
}

reconnect();
