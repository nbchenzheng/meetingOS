import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { once } from "node:events";
import WebSocket from "ws";
import { createMeetingServer } from "../platform/server.mjs";
import { passwordHash, createSession, digest } from "../platform/auth.mjs";

let app,
  base,
  dir,
  gateway,
  cookie,
  owner,
  meeting,
  mode = "success";
const prompts = [];
const envKeys = [
  "LINKHARBOR_API_KEY",
  "LINKHARBOR_BASE_URL",
  "WEI_LLM_API_KEY",
  "WEI_LLM_BASE_URL",
  "NODE_ENV",
  "MEETINGOS_INVITE_CODE",
  "MEETINGOS_PUBLIC_URL",
  "ALIYUN_ASR_ENABLED",
];
const saved = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
async function request(path, input, options = {}) {
  const response = await fetch(base + "/api/v1" + path, {
    method: input === undefined ? "GET" : "POST",
    ...options,
    headers: {
      Cookie: cookie,
      "Content-Type": "application/json",
      ...options.headers,
    },
    body: input === undefined ? undefined : JSON.stringify(input),
  });
  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  return { response, status: response.status, data };
}
async function event(text, extra = {}) {
  const r = await request("/meetings/" + meeting.id + "/events", {
    id: crypto.randomUUID(),
    type: "speech",
    text,
    speaker: "测试同事",
    ...extra,
  });
  assert.equal(r.status, 201);
  return r.data.event;
}
async function streamFor(
  headers = {},
  audience = "",
  after = app.store.cursor(meeting.id),
) {
  const controller = new AbortController();
  const response = await fetch(
    base +
      "/api/v1/meetings/" +
      meeting.id +
      "/stream?after=" +
      after +
      audience,
    { headers: { Cookie: cookie, ...headers }, signal: controller.signal },
  );
  assert.equal(response.status, 200);
  const reader = response.body.getReader();
  const seen = [];
  let buffer = "";
  async function until(predicate) {
    const timeout = setTimeout(() => controller.abort(), 3000);
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) return null;
        buffer += new TextDecoder().decode(chunk.value);
        const frames = buffer.split("\n\n");
        buffer = frames.pop();
        for (const frame of frames) {
          const raw = frame.split("\n").find((l) => l.startsWith("data: "));
          if (raw) {
            const data = JSON.parse(raw.slice(6));
            seen.push(data);
            if (predicate(data)) return data;
          }
        }
      }
    } finally {
      clearTimeout(timeout);
    }
  }
  return { controller, reader, until, seen };
}
before(async () => {
  dir = mkdtempSync(join(tmpdir(), "meetingos-api-"));
  gateway = http.createServer(async (req, res) => {
    let text = "";
    for await (const chunk of req) text += chunk;
    const payload = JSON.parse(text);
    prompts.push(payload);
    if (mode === "error") {
      res.writeHead(429);
      res.end("{}");
      return;
    }
    if (mode === "blocked") {
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.write(": waiting\n\n");
      return;
    }
    if (mode === "delayed")
      await new Promise((resolve) => setTimeout(resolve, 150));
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    const answer = payload.messages[0].content.includes("整理一份")
      ? "## 已确认决定\n只按确认记录整理 [brief]"
      : "建议先核实交付时间，再确认承诺。 [brief]";
    for (const text of [answer.slice(0, 12), answer.slice(12)])
      res.write(
        "data: " +
          JSON.stringify({ choices: [{ delta: { content: text } }] }) +
          "\n\n",
      );
    res.end("data: [DONE]\n\n");
  });
  gateway.listen(0, "127.0.0.1");
  await once(gateway, "listening");
  const gatewayURL = "http://127.0.0.1:" + gateway.address().port + "/v1";
  process.env.LINKHARBOR_API_KEY = "controlled-fixture-key";
  process.env.LINKHARBOR_BASE_URL = gatewayURL;
  process.env.WEI_LLM_API_KEY = "controlled-fixture-key";
  process.env.WEI_LLM_BASE_URL = gatewayURL;
  process.env.NODE_ENV = "development";
  process.env.ALIYUN_ASR_ENABLED = "false";
  delete process.env.MEETINGOS_INVITE_CODE;
  delete process.env.MEETINGOS_PUBLIC_URL;
  app = createMeetingServer({ dataDir: dir });
  app.server.listen(0, "127.0.0.1");
  await once(app.server, "listening");
  base = "http://127.0.0.1:" + app.server.address().port;
  owner = app.store.createUser({
    login: "api-owner",
    name: "测试同事",
    passwordHash: passwordHash("only-fixture-password"),
  });
  cookie = createSession(
    app.store,
    { headers: {}, socket: {} },
    owner,
  ).cookie.split(";")[0];
  meeting = app.store.createMeeting(owner.id, {
    title: "测试计划",
    model: "gpt55",
    mode: "customer",
    brief: "BRIEF_MARKER 三周部署，预算12万元",
    privateNotes: "PRIVATE_MARKER 报价底线",
  });
});
after(async () => {
  await app.close();
  gateway.closeAllConnections();
  await new Promise((resolve) => gateway.close(resolve));
  rmSync(dir, { recursive: true, force: true });
  for (const key of envKeys) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

test("匿名接口拒绝、注册登录真实会话、跨站写入拒绝和账号隔离", async () => {
  assert.equal(
    (await request("/meetings", undefined, { headers: { Cookie: "" } })).status,
    401,
  );
  const registered = await request("/auth/register", {
    login: "new-person",
    name: "另一同事",
    password: "only-fixture-register-password",
  });
  assert.equal(registered.status, 201);
  assert.match(
    registered.response.headers.get("set-cookie"),
    /HttpOnly; SameSite=Strict/,
  );
  assert.equal(
    (await request("/auth/login", { login: "new-person", password: "wrong" }))
      .status,
    401,
  );
  const other = await request("/auth/login", {
    login: "new-person",
    password: "only-fixture-register-password",
  });
  assert.equal(other.status, 200);
  assert.equal(
    (
      await request("/meetings/" + meeting.id, undefined, {
        headers: {
          Cookie: other.response.headers.get("set-cookie").split(";")[0],
        },
      })
    ).status,
    404,
  );
  assert.equal(
    (
      await request(
        "/meetings",
        { title: "forbidden" },
        { headers: { Origin: "https://other.example" } },
      )
    ).status,
    403,
  );
});
test("资料保存原始文件、提取文字、按内容去重，并进入统一模型上下文", async () => {
  const file = Buffer.from("MATERIAL_MARKER 产品部署需要三周。");
  const input = { fileName: "产品说明.txt", base64: file.toString("base64") };
  const first = await request("/meetings/" + meeting.id + "/materials", input),
    second = await request("/meetings/" + meeting.id + "/materials", input);
  assert.equal(first.status, 201);
  assert.equal(second.data.material.id, first.data.material.id);
  const raw = await fetch(
    base +
      "/api/v1/meetings/" +
      meeting.id +
      "/materials/" +
      first.data.material.id +
      "/file",
    { headers: { Cookie: cookie } },
  );
  assert.deepEqual(Buffer.from(await raw.arrayBuffer()), file);
  assert.equal(
    (
      await request("/meetings/" + meeting.id + "/materials", {
        fileName: "unsafe.exe",
        base64: "YWJj",
      })
    ).status,
    415,
  );
  assert.equal(
    (
      await request("/meetings/" + meeting.id + "/materials", {
        fileName: "bad.docx",
        base64: "YWJj",
      })
    ).status,
    422,
  );
});
test("人工求助调用网关、完整读取简报/资料/修订/前文建议，并保存私有结果与引用", async () => {
  const old = await event("OLD_MARKER 一周交付");
  assert.equal(
    (
      await request(
        "/meetings/" + meeting.id + "/events/" + old.id,
        { revision: 1, text: "EDITED_MARKER 三周交付" },
        { method: "PATCH" },
      )
    ).status,
    200,
  );
  await event("EARLIER_ADVICE_MARKER 建议分阶段验收", {
    type: "advice",
    visibility: "private",
    data: { question: "PRIOR_QUESTION_MARKER 预算与范围如何取舍？" },
  });
  const r = await request("/meetings/" + meeting.id + "/assistant", {
    question: "当前承诺合理吗？",
  });
  assert.equal(r.status, 200);
  assert.equal(r.data.event.visibility, "private");
  assert.equal(r.data.event.source, "model");
  assert.equal(r.data.event.data.sources[0].id, "brief");
  const prompt = prompts.at(-1).messages[1].content;
  for (const marker of [
    "BRIEF_MARKER",
    "PRIVATE_MARKER",
    "MATERIAL_MARKER",
    "EDITED_MARKER",
    "EARLIER_ADVICE_MARKER",
  ])
    assert.ok(prompt.includes(marker), marker);
  assert.ok(prompt.includes("记录类型=speech；写入来源=human；修订版本=2"));
  assert.ok(prompt.includes("记录类型=advice；写入来源=human"));
  assert.ok(prompt.includes("PRIOR_QUESTION_MARKER"));
  assert.ok(!prompt.includes("OLD_MARKER"));
  assert.ok(prompts.at(-1).messages[0].content.includes("当前承诺合理吗"));
});
test("总结按内容版本缓存，修订后重新调用；共享总结不读取私有内容", async () => {
  const before = prompts.length;
  const first = await request("/meetings/" + meeting.id + "/assistant", {
    kind: "summary",
    question: "固定总结问题",
  });
  const cached = await request("/meetings/" + meeting.id + "/assistant", {
    kind: "summary",
    question: "固定总结问题",
  });
  assert.equal(first.status, 200);
  assert.equal(cached.data.cached, true);
  assert.equal(prompts.length, before + 1);
  await event("更新后的共享发言");
  assert.equal(
    (
      await request("/meetings/" + meeting.id + "/assistant", {
        kind: "summary",
        question: "固定总结问题",
      })
    ).data.cached,
    false,
  );
  assert.equal(
    (
      await request("/meetings/" + meeting.id + "/assistant", {
        kind: "summary",
        audience: "customer",
      })
    ).status,
    200,
  );
  assert.ok(!prompts.at(-1).messages[1].content.includes("PRIVATE_MARKER"));
  assert.ok(
    !prompts.at(-1).messages[1].content.includes("EARLIER_ADVICE_MARKER"),
  );
});
test("私有内容不进入客户 API/导出/回放；公开转私有立即发出移除事件", async () => {
  const publicRecord = await event("WAS_SHARED_MARKER");
  const customer = await streamFor({}, "&audience=customer");
  assert.equal(
    (
      await request(
        "/meetings/" + meeting.id + "/events/" + publicRecord.id,
        { revision: 1, visibility: "private" },
        { method: "PATCH" },
      )
    ).status,
    200,
  );
  const removed = await customer.until(
    (data) =>
      data.kind === "event.removed" && data.payload.id === publicRecord.id,
  );
  assert.equal(removed.payload.id, publicRecord.id);
  customer.controller.abort();
  const redacted = await event("NEVER_SHARED_HISTORY_MARKER", {
    visibility: "private",
    data: { model: { private: "PRIVATE_METADATA_MARKER" } },
  });
  assert.equal(
    (
      await request(
        "/meetings/" + meeting.id + "/events/" + redacted.id,
        { revision: 1, text: "人类允许公开的修订内容", visibility: "shared" },
        { method: "PATCH" },
      )
    ).status,
    200,
  );
  const replay = await streamFor({}, "&audience=customer", 0);
  await replay.until((data) => typeof data.reload === "boolean");
  assert.ok(
    !JSON.stringify(replay.seen).includes("NEVER_SHARED_HISTORY_MARKER"),
  );
  assert.ok(!JSON.stringify(replay.seen).includes("PRIVATE_METADATA_MARKER"));
  replay.controller.abort();
  for (const path of [
    "/meetings/" + meeting.id + "?audience=customer",
    "/meetings/" + meeting.id + "/events?audience=customer",
    "/meetings/" + meeting.id + "/changes?audience=customer",
    "/meetings/" + meeting.id + "/export?audience=customer",
  ]) {
    const r = await request(path);
    assert.equal(r.status, 200);
    const output = JSON.stringify(r.data);
    assert.ok(!output.includes("PRIVATE_MARKER"));
    assert.ok(!output.includes("EARLIER_ADVICE_MARKER"));
    assert.ok(!output.includes("WAS_SHARED_MARKER"));
    assert.ok(!output.includes("NEVER_SHARED_HISTORY_MARKER"));
    assert.ok(!output.includes("PRIVATE_METADATA_MARKER"));
  }
});
test("Agent 限会议/权限写入，人类实时接收；撤销关闭流并拒绝后续请求", async () => {
  const issued = await request("/tokens", {
    name: "Fixture Hermes",
    scopes: ["meetings:read", "events:write"],
    meetingIds: [meeting.id],
    days: 1,
  });
  const token = issued.data.token,
    headers = { Authorization: "Bearer " + token.secret, Cookie: "" };
  assert.equal(
    (await request("/meetings/" + meeting.id, undefined, { headers })).data
      .meeting.privateNotes,
    undefined,
  );
  assert.equal(
    (
      await request(
        "/meetings/" + meeting.id + "/events",
        { text: "privileged", visibility: "private" },
        { headers },
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await request(
        "/meetings/" + meeting.id,
        { brief: "no scope" },
        { method: "PATCH", headers },
      )
    ).status,
    403,
  );
  for (const data of [
    { question: { unexpected: "object" } },
    { sources: "wrong-type" },
    { sources: [{ id: "brief", label: {}, excerpt: "x" }] },
  ]) {
    assert.equal(
      (
        await request(
          "/meetings/" + meeting.id + "/events",
          { type: "note", text: "无效元数据", data },
          { headers },
        )
      ).data.code,
      "INVALID_METADATA",
    );
  }
  const human = await streamFor(),
    agent = await streamFor(headers);
  const added = await request(
    "/meetings/" + meeting.id + "/events",
    { id: "hermes-event", text: "AGENT_MARKER 发现一个交付风险", type: "note" },
    { headers },
  );
  assert.equal(added.status, 201);
  const received = await human.until(
    (data) =>
      data.kind === "event.created" && data.payload.id === "hermes-event",
  );
  assert.equal(received.payload.source, "agent");
  human.controller.abort();
  assert.equal(
    (await request("/tokens/" + token.id, undefined, { method: "DELETE" }))
      .status,
    200,
  );
  assert.equal(await agent.until(() => false), null);
  assert.equal(
    (await request("/meetings", undefined, { headers })).status,
    401,
  );
});
test("过期授权拒绝；完整权限 Agent 也不能把私有记录公开或管理他人令牌", async () => {
  const settingToken = (
    await request("/tokens", { scopes: ["meetings:read", "meetings:write"] })
  ).data.token;
  const settingHeaders = {
    Authorization: "Bearer " + settingToken.secret,
    Cookie: "",
  };
  assert.equal(
    (
      await request(
        "/meetings/" + meeting.id,
        { autoEnabled: true },
        { method: "PATCH", headers: settingHeaders },
      )
    ).data.code,
    "HUMAN_SETTINGS_REQUIRED",
  );
  assert.equal(
    (
      await request(
        "/meetings/" + meeting.id,
        { model: "claude" },
        { method: "PATCH", headers: settingHeaders },
      )
    ).data.code,
    "HUMAN_SETTINGS_REQUIRED",
  );
  const issued = await request("/tokens", {
    scopes: ["meetings:read", "events:write", "private:read", "private:write"],
  });
  const token = issued.data.token,
    headers = { Authorization: "Bearer " + token.secret, Cookie: "" };
  const privateRecord = await event("私人内容", { visibility: "private" });
  assert.equal(
    (
      await request(
        "/meetings/" + meeting.id + "/events/" + privateRecord.id,
        { revision: 1, visibility: "shared" },
        { method: "PATCH", headers },
      )
    ).status,
    403,
  );
  assert.equal((await request("/tokens", undefined, { headers })).status, 403);
  assert.equal(
    (
      await request(
        "/meetings/" + meeting.id + "/events",
        { type: "decision", text: "未经确认的决定" },
        { headers },
      )
    ).data.code,
    "HUMAN_CONFIRMATION_REQUIRED",
  );
  const confirmed = await event("人类确认的决定", { type: "decision" });
  assert.equal(
    (
      await request(
        "/meetings/" + meeting.id + "/events/" + confirmed.id,
        { revision: 1, text: "Agent覆盖决定" },
        { method: "PATCH", headers },
      )
    ).data.code,
    "HUMAN_CONFIRMATION_REQUIRED",
  );
  app.store.db
    .prepare("UPDATE agent_tokens SET expires_at=? WHERE hash=?")
    .run(Date.now() - 1, digest(token.secret));
  assert.equal(
    (await request("/meetings", undefined, { headers })).status,
    401,
  );
});
test("缺少模型或模型拒绝时返回明确错误，绝不写入伪建议；流式接口给出真实增量", async () => {
  const count = app.store.countEvents(meeting.id),
    key = process.env.LINKHARBOR_API_KEY;
  delete process.env.LINKHARBOR_API_KEY;
  assert.equal(
    (await request("/meetings/" + meeting.id + "/assistant", {})).data.code,
    "MODEL_NOT_CONFIGURED",
  );
  assert.equal(
    (
      await request(
        "/meetings/" + meeting.id,
        { autoEnabled: true },
        { method: "PATCH" },
      )
    ).status,
    503,
  );
  process.env.LINKHARBOR_API_KEY = key;
  mode = "error";
  assert.equal(
    (await request("/meetings/" + meeting.id + "/assistant", {})).data.code,
    "MODEL_RATE_LIMIT",
  );
  assert.equal(app.store.countEvents(meeting.id), count);
  mode = "success";
  const streamed = await request(
    "/meetings/" + meeting.id + "/assistant",
    { question: "流式请求" },
    { headers: { Accept: "text/event-stream" } },
  );
  assert.match(streamed.data, /event: token/);
  assert.match(streamed.data, /event: end/);
});
test("自动建议按新发言触发并包含资料；人工请求优先取消正在进行的自动分析", async () => {
  assert.equal(
    (
      await request(
        "/meetings/" + meeting.id,
        { autoEnabled: true },
        { method: "PATCH" },
      )
    ).status,
    200,
  );
  const before = prompts.length;
  await event("AUTO_MARKER 新提问");
  const end = Date.now() + 4000;
  while (prompts.length === before && Date.now() < end)
    await new Promise((resolve) => setTimeout(resolve, 50));
  assert.ok(prompts.length > before);
  assert.ok(prompts.at(-1).messages[1].content.includes("MATERIAL_MARKER"));
  await new Promise((resolve) => setTimeout(resolve, 50));
  mode = "blocked";
  const beforeBlocked = prompts.length;
  await event("自动分析中的发言");
  const until = Date.now() + 4000;
  while (prompts.length === beforeBlocked && Date.now() < until)
    await new Promise((resolve) => setTimeout(resolve, 50));
  assert.ok(app.assistant.active.get(meeting.id)?.automatic);
  mode = "success";
  assert.equal(
    (
      await request("/meetings/" + meeting.id + "/assistant", {
        question: "人工紧急问题",
      })
    ).status,
    200,
  );
  assert.ok(prompts.at(-1).messages[0].content.includes("人工紧急问题"));
  await request(
    "/meetings/" + meeting.id,
    { autoEnabled: false },
    { method: "PATCH" },
  );
});
test("认证 WebSocket 写入与网页事件流相同数据库，同 ID 重试不重复", async () => {
  const ws = new WebSocket(
    base.replace("http:", "ws:") +
      "/ws/board/transcribe?sessionId=" +
      meeting.id,
    { headers: { Cookie: cookie } },
  );
  await once(ws, "open");
  ws.send(JSON.stringify({ type: "speaker", speaker: "客户测试" }));
  ws.send(
    JSON.stringify({
      type: "transcript",
      id: "ws-once",
      text: "WS_MARKER 实时发言",
      final: true,
    }),
  );
  ws.send(
    JSON.stringify({
      type: "transcript",
      id: "ws-once",
      text: "WS_MARKER 实时发言",
      final: true,
    }),
  );
  const end = Date.now() + 2000;
  while (!app.store.event(meeting.id, "ws-once") && Date.now() < end)
    await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(
    app.store.allEvents(meeting.id).filter((e) => e.id === "ws-once").length,
    1,
  );
  assert.equal(app.store.event(meeting.id, "ws-once").speaker, "客户测试");
  ws.close();
  await once(ws, "close");
});
test("预算超限明确拒绝模型请求，原始长记录保留；修订冲突拒绝覆盖", async () => {
  const one = await event("并发原文");
  await request(
    "/meetings/" + meeting.id + "/events/" + one.id,
    { revision: 1, text: "已更新" },
    { method: "PATCH" },
  );
  assert.equal(
    (
      await request(
        "/meetings/" + meeting.id + "/events/" + one.id,
        { revision: 1, text: "过时覆盖" },
        { method: "PATCH" },
      )
    ).data.code,
    "REVISION_CONFLICT",
  );
  const long = app.store.createMeeting(owner.id, { title: "很长的会议" });
  for (let i = 0; i < 4; i++)
    app.store.addEvent(
      long.id,
      { text: "长".repeat(42000), id: "long-" + i },
      { id: owner.id, name: owner.name, kind: "human" },
    );
  const before = prompts.length;
  assert.equal(
    (await request("/meetings/" + long.id + "/assistant", {})).data.code,
    "CONTEXT_TOO_LARGE",
  );
  assert.equal(prompts.length, before);
  assert.equal(app.store.countEvents(long.id), 4);
});

test("公开总结改私有后，缓存不能泄露私有修订或原文元数据", async () => {
  const initial = await request("/meetings/" + meeting.id + "/assistant", {
    kind: "summary",
    audience: "customer",
    question: "隐私缓存测试",
  });
  assert.equal(initial.status, 200);
  await request(
    "/meetings/" + meeting.id + "/events/" + initial.data.event.id,
    { revision: 1, text: "PRIVATE_CACHE_MARKER", visibility: "private" },
    { method: "PATCH" },
  );
  const rerun = await request("/meetings/" + meeting.id + "/assistant", {
    kind: "summary",
    audience: "customer",
    question: "隐私缓存测试",
  });
  assert.equal(rerun.status, 200);
  assert.equal(rerun.data.cached, false);
  assert.equal(rerun.data.event.visibility, "shared");
  assert.ok(!JSON.stringify(rerun.data).includes("PRIVATE_CACHE_MARKER"));
  const events = await request(
    "/meetings/" + meeting.id + "/events?audience=customer",
  );
  assert.ok(events.data.events.every((e) => e.originalText === undefined));
  assert.ok(!JSON.stringify(events.data).includes("PRIVATE_CACHE_MARKER"));
});

test("撤销授权中止在途模型请求且不保存半截建议", async () => {
  const token = (
    await request("/tokens", {
      scopes: ["meetings:read", "assistant:ask", "private:write"],
    })
  ).data.token;
  const count = app.store.countEvents(meeting.id),
    before = prompts.length;
  mode = "blocked";
  const pending = request(
    "/meetings/" + meeting.id + "/assistant",
    { question: "授权撤销测试" },
    { headers: { Cookie: "", Authorization: "Bearer " + token.secret } },
  );
  const until = Date.now() + 3000;
  while (prompts.length === before && Date.now() < until)
    await new Promise((resolve) => setTimeout(resolve, 20));
  assert.ok(prompts.length > before);
  await request("/tokens/" + token.id, undefined, { method: "DELETE" });
  const result = await pending;
  mode = "success";
  assert.equal(result.data.code, "MODEL_TIMEOUT");
  assert.equal(app.store.countEvents(meeting.id), count);
});

test("生产注册默认关闭，邀请码校验且HTTPS会话设置Secure", async () => {
  const previousMode = process.env.NODE_ENV,
    previousInvite = process.env.MEETINGOS_INVITE_CODE,
    previousURL = process.env.MEETINGOS_PUBLIC_URL;
  try {
    process.env.NODE_ENV = "production";
    delete process.env.MEETINGOS_INVITE_CODE;
    assert.equal(
      (
        await request("/auth/register", {
          login: "prod-fixture",
          name: "内部账号",
          password: "prod-fixture-only-password",
        })
      ).data.code,
      "REGISTRATION_DISABLED",
    );
    process.env.MEETINGOS_INVITE_CODE = "controlled-invite-fixture";
    process.env.MEETINGOS_PUBLIC_URL = "https://meetingos.example";
    assert.equal(
      (
        await request("/auth/register", {
          login: "prod-fixture",
          name: "内部账号",
          password: "prod-fixture-only-password",
          inviteCode: "wrong",
        })
      ).status,
      403,
    );
    const created = await request("/auth/register", {
      login: "prod-fixture",
      name: "内部账号",
      password: "prod-fixture-only-password",
      inviteCode: "controlled-invite-fixture",
    });
    assert.equal(created.status, 201);
    assert.match(created.response.headers.get("set-cookie"), /; Secure/);
  } finally {
    for (const [key, value] of [
      ["NODE_ENV", previousMode],
      ["MEETINGOS_INVITE_CODE", previousInvite],
      ["MEETINGOS_PUBLIC_URL", previousURL],
    ])
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
  }
});

test("私有附件按权限隔离，选择影响模型上下文，修订和删除同步到回放", async () => {
  const path = "/meetings/" + meeting.id;
  const sharedToken = (
    await request("/tokens", {
      name: "共享资料测试",
      scopes: ["meetings:read", "meetings:write"],
      meetingIds: [meeting.id],
    })
  ).data.token.secret;
  const headers = { Authorization: "Bearer " + sharedToken };
  const upload = async (visibility) =>
    request(path + "/materials", {
      fileName: "内部报价.txt",
      visibility,
      base64: Buffer.from("PRIVATE_ATTACHMENT_MARKER 内部最低报价").toString(
        "base64",
      ),
    });
  const created = await upload("private");
  assert.equal(created.status, 201);
  let material = created.data.material;
  assert.equal(material.visibility, "private");
  assert.equal(
    (await request(path + "/materials")).data.materials.some(
      (m) => m.id === material.id,
    ),
    true,
  );
  for (const suffix of ["?audience=customer", ""]) {
    const r = await request(
      path + "/materials" + suffix,
      undefined,
      suffix ? {} : { headers },
    );
    assert.equal(
      r.data.materials.some((m) => m.id === material.id),
      false,
    );
  }
  assert.equal(
    (
      await request(path + "/materials/" + material.id + "/file", undefined, {
        headers,
      })
    ).status,
    404,
  );
  assert.equal(
    (
      await request(
        path + "/materials",
        { fileName: "bad.txt", visibility: "private", base64: "eA==" },
        { headers },
      )
    ).status,
    403,
  );
  await request(path + "/assistant", { question: "内部附件验收" });
  assert.ok(
    prompts.at(-1).messages[1].content.includes("PRIVATE_ATTACHMENT_MARKER"),
  );
  await request(path + "/assistant", { kind: "summary", audience: "customer" });
  assert.ok(
    !prompts.at(-1).messages[1].content.includes("PRIVATE_ATTACHMENT_MARKER"),
  );
  material = (
    await request(
      path + "/materials/" + material.id,
      { revision: material.revision, included: false },
      { method: "PATCH" },
    )
  ).data.material;
  await request(path + "/assistant", { question: "暂停附件验收" });
  assert.ok(
    !prompts.at(-1).messages[1].content.includes("PRIVATE_ATTACHMENT_MARKER"),
  );
  assert.equal(
    (
      await request(
        path + "/materials/" + material.id,
        { revision: 1, included: true },
        { method: "PATCH" },
      )
    ).status,
    409,
  );
  const deniedToken = (
    await request("/tokens", {
      name: "私有资料 Agent",
      scopes: [
        "meetings:read",
        "meetings:write",
        "private:read",
        "private:write",
      ],
      meetingIds: [meeting.id],
    })
  ).data.token.secret;
  assert.equal(
    (
      await request(
        path + "/materials/" + material.id,
        { revision: material.revision, visibility: "shared" },
        {
          method: "PATCH",
          headers: { Authorization: "Bearer " + deniedToken },
        },
      )
    ).status,
    403,
  );
  material = (
    await request(
      path + "/materials/" + material.id,
      { revision: material.revision, visibility: "shared" },
      { method: "PATCH" },
    )
  ).data.material;
  assert.ok(
    (await request(path + "/materials?audience=customer")).data.materials.some(
      (m) => m.id === material.id,
    ),
  );
  material = (
    await request(
      path + "/materials/" + material.id,
      { revision: material.revision, visibility: "private" },
      { method: "PATCH" },
    )
  ).data.material;
  const replay = await request(
    path + "/changes?after=0&audience=customer&limit=500",
  );
  assert.ok(!JSON.stringify(replay.data).includes("PRIVATE_ATTACHMENT_MARKER"));
  const stream = await streamFor();
  assert.equal(
    (
      await request(
        path + "/materials/" + material.id,
        { revision: material.revision },
        { method: "DELETE" },
      )
    ).status,
    200,
  );
  const removed = await stream.until(
    (c) => c.kind === "material.removed" && c.payload.id === material.id,
  );
  assert.ok(removed);
  stream.controller.abort();
  assert.equal(app.store.materialFile(meeting.id, material.id), undefined);
  assert.ok(
    !app.store
      .changes(meeting.id, 0, 500)
      .some(
        (c) =>
          c.kind.startsWith("material.") &&
          JSON.stringify(c.payload).includes("PRIVATE_ATTACHMENT_MARKER"),
      ),
  );
  // Identical bytes at different privacy levels are distinct; shared uploads cannot disclose private IDs.
  const first = await upload("private"),
    second = await upload("shared");
  assert.notEqual(first.data.material.id, second.data.material.id);
});

test("连续发言的自动建议最多等待八秒；结束会议中止自动分析并保留记录", async () => {
  const session = app.store.createMeeting(owner.id, { title: "持续发言验收" });
  const path = "/meetings/" + session.id;
  await request(path, { autoEnabled: true }, { method: "PATCH" });
  const before = prompts.length;
  const interval = setInterval(
    () =>
      app.store.addEvent(
        session.id,
        { type: "speech", text: "连续发言", id: crypto.randomUUID() },
        { kind: "human", id: owner.id, name: owner.name },
      ),
    250,
  );
  // Route-independent store writes must explicitly schedule just as the HTTP/WS adapters do.
  const scheduleInterval = setInterval(
    () => app.assistant.schedule(session.id),
    250,
  );
  try {
    const until = Date.now() + 9500;
    while (prompts.length === before && Date.now() < until)
      await new Promise((r) => setTimeout(r, 100));
    assert.ok(
      prompts.length > before,
      "continuous speech must not postpone analysis indefinitely",
    );
  } finally {
    clearInterval(interval);
    clearInterval(scheduleInterval);
  }
  app.assistant.pause(session.id);
  mode = "blocked";
  await request(path + "/events", { type: "speech", text: "结束前的发言" });
  const until = Date.now() + 4000;
  while (!app.assistant.active.get(session.id) && Date.now() < until)
    await new Promise((r) => setTimeout(r, 50));
  assert.ok(app.assistant.active.get(session.id)?.automatic);
  const result = await request(
    path,
    { status: "completed" },
    { method: "PATCH" },
  );
  assert.equal(result.data.meeting.status, "completed");
  assert.equal(result.data.meeting.autoEnabled, false);
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(app.assistant.active.has(session.id), false);
  assert.ok(app.store.countEvents(session.id) > 20);
  mode = "success";
  const reopened = await request(
    path,
    { status: "active" },
    { method: "PATCH" },
  );
  assert.equal(reopened.data.meeting.autoEnabled, false);
});

test("客户总结期间共享资料撤回后不发布旧上下文结果", async () => {
  const session = app.store.createMeeting(owner.id, {
    title: "在途客户总结验收",
  });
  const path = "/meetings/" + session.id;
  const file = (
    await request(path + "/materials", {
      fileName: "可撤回.txt",
      visibility: "shared",
      base64: Buffer.from("撤回的共享资料").toString("base64"),
    })
  ).data.material;
  mode = "delayed";
  const before = prompts.length;
  const pending = request(path + "/assistant", {
    kind: "summary",
    audience: "customer",
  });
  const until = Date.now() + 2000;
  while (prompts.length === before && Date.now() < until)
    await new Promise((r) => setTimeout(r, 5));
  assert.ok(prompts.length > before);
  await request(
    path + "/materials/" + file.id,
    { revision: file.revision, visibility: "private" },
    { method: "PATCH" },
  );
  const result = await pending;
  mode = "success";
  assert.equal(result.status, 409);
  assert.equal(result.data.code, "CONTEXT_CHANGED");
  assert.equal(
    app.store.allEvents(session.id).filter((e) => e.type === "summary").length,
    0,
  );
});

test("新会默认wei.run DeepSeek Flash；GPT/Claude/Gemini使用LinkHarbor且失败不跨网关兜底", async () => {
  const previousKey = process.env.WEI_LLM_API_KEY,
    previousBase = process.env.WEI_LLM_BASE_URL;
  const received = [];
  const wei = http.createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    received.push({
      input: JSON.parse(raw),
      authorization: req.headers.authorization,
    });
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        choices: [{ message: { content: "先核实预算。 [brief]" } }],
      }),
    );
  });
  wei.listen(0, "127.0.0.1");
  await once(wei, "listening");
  process.env.WEI_LLM_API_KEY = "wei-specific-test-key";
  process.env.WEI_LLM_BASE_URL =
    "http://127.0.0.1:" + wei.address().port + "/v1";
  try {
    const created = await request("/meetings", {
      title: "成本路由验收",
      brief: "预算待核实",
    });
    const session = created.data.meeting;
    assert.equal(session.model, "deepseek");
    const path = "/meetings/" + session.id;
    const before = prompts.length;
    assert.equal(
      (await request(path + "/assistant", { question: "检查风险" })).status,
      200,
    );
    assert.equal(received.length, 1);
    assert.equal(received[0].input.model, "deepseek-v4-flash");
    assert.equal(received[0].authorization, "Bearer wei-specific-test-key");
    assert.equal(prompts.length, before);
    assert.equal(
      (
        await request(path + "/assistant", {
          roleId: "charlie_munger",
          question: "逆向审查",
        })
      ).status,
      200,
    );
    assert.equal(received.length, 2);
    for (const roleId of ["gpt55", "claude", "gemini"]) {
      const foreignBefore = prompts.length;
      assert.equal(
        (await request(path + "/assistant", { roleId, question: "审查" }))
          .status,
        200,
      );
      assert.equal(prompts.length, foreignBefore + 1);
      assert.equal(received.length, 2);
    }
    delete process.env.WEI_LLM_API_KEY;
    assert.equal(
      (await request(path + "/assistant", { question: "不能用昂贵线路兜底" }))
        .data.code,
      "MODEL_NOT_CONFIGURED",
    );
    assert.equal(prompts.length, before + 3);
    process.env.WEI_LLM_API_KEY = "wei-specific-test-key";
    process.env.WEI_LLM_BASE_URL = "https://api.linkharbor.ai/v1";
    assert.equal(
      (await request(path + "/assistant", { question: "拒绝错误路由" })).data
        .code,
      "MODEL_ROUTE_NOT_ALLOWED",
    );
    assert.equal(prompts.length, before + 3);
  } finally {
    process.env.WEI_LLM_API_KEY = previousKey;
    process.env.WEI_LLM_BASE_URL = previousBase;
    wei.closeAllConnections();
    await new Promise((r) => wei.close(r));
  }
});
