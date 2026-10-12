import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import http from "node:http";
import { WebSocketServer } from "ws";
import { createAliyunStream, asrRuntimeConfig } from "../asr-service.mjs";

test("百炼实时ASR使用独立凭证与可配置型号，PCM结果和结束协议正常", async () => {
  const names = [
    "ALIYUN_ASR_API_KEY",
    "ALIYUN_ASR_ENABLED",
    "ALIYUN_ASR_WS_URL",
    "ALIYUN_ASR_MODEL",
  ];
  const saved = Object.fromEntries(names.map((n) => [n, process.env[n]]));
  const server = http.createServer();
  const ws = new WebSocketServer({ server });
  const received = [];
  let credential,
    bytes = 0;
  ws.on("connection", (socket, req) => {
    credential = req.headers.authorization;
    socket.on("message", (raw, binary) => {
      if (binary) {
        bytes += raw.length;
        socket.send(
          JSON.stringify({
            header: { event: "result-generated" },
            payload: {
              output: {
                sentence: { text: "预算上限十二万元。", sentence_end: true },
              },
            },
          }),
        );
        return;
      }
      const input = JSON.parse(raw.toString());
      received.push(input);
      if (input.header.action === "run-task")
        socket.send(JSON.stringify({ header: { event: "task-started" } }));
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  process.env.ALIYUN_ASR_API_KEY = "asr-test-only-key";
  process.env.ALIYUN_ASR_ENABLED = "true";
  process.env.ALIYUN_ASR_WS_URL = "ws://127.0.0.1:" + server.address().port;
  process.env.ALIYUN_ASR_MODEL = "fun-asr-realtime";
  let stream;
  try {
    assert.equal(asrRuntimeConfig().provider, "aliyun");
    const results = [];
    const result = new Promise((resolve) => {
      stream = createAliyunStream({
        onResult: (text, final) => {
          results.push({ text, final });
          resolve();
        },
      });
    });
    await stream.ready();
    assert.equal(credential, "Bearer asr-test-only-key");
    assert.equal(received[0].payload.model, "fun-asr-realtime");
    assert.equal(received[0].payload.parameters.sample_rate, 16000);
    stream.sendAudio(Buffer.alloc(3200));
    await result;
    assert.equal(bytes, 3200);
    assert.deepEqual(results, [{ text: "预算上限十二万元。", final: true }]);
    stream.finish();
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(received.at(-1).header.action, "finish-task");
  } finally {
    stream?.close();
    for (const socket of ws.clients) socket.terminate();
    await new Promise((r) => ws.close(r));
    await new Promise((r) => server.close(r));
    for (const name of names)
      if (saved[name] === undefined) delete process.env[name];
      else process.env[name] = saved[name];
  }
});
