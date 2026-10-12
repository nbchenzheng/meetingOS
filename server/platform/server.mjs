import http from "node:http";
import { WebSocketServer } from "ws";
import { readFileSync, existsSync, statSync, createReadStream } from "node:fs";
import { resolve, join, extname, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { MeetingStore, ApiError } from "./store.mjs";
import * as auth from "./auth.mjs";
import {
  MeetingAssistant,
  assistantCatalog,
  exportMeeting,
} from "./assistant.mjs";
import { extractMaterialTextFromFile } from "../material-service.mjs";
import { asrRuntimeConfig, createAliyunStream } from "../asr-service.mjs";

const ROOT = resolve(fileURLToPath(new URL("../../", import.meta.url)));
const number = (value, fallback, max = Number.MAX_SAFE_INTEGER) => {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > max)
    throw new ApiError(400, "INVALID_CURSOR", "分页或版本参数不正确");
  return parsed;
};
const apiJson = (res, status, value) => {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(value));
};
const errorJson = (res, error) => {
  if (res.headersSent) return res.end();
  apiJson(res, error instanceof ApiError ? error.status : 500, {
    ok: false,
    code: error instanceof ApiError ? error.code : "INTERNAL_ERROR",
    message:
      error instanceof ApiError ? error.message : "服务暂不可用，请稍后重试",
  });
};

async function body(req, limit = 128 * 1024) {
  if (Number(req.headers["content-length"] || 0) > limit)
    throw new ApiError(413, "BODY_TOO_LARGE", "请求内容过大");
  const chunks = [];
  let length = 0;
  for await (const chunk of req) {
    length += chunk.length;
    if (length > limit)
      throw new ApiError(413, "BODY_TOO_LARGE", "请求内容过大");
    chunks.push(chunk);
  }
  if (!length) return {};
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!value || Array.isArray(value) || typeof value !== "object")
      throw Error();
    return value;
  } catch {
    throw new ApiError(400, "INVALID_JSON", "请求内容需要是有效 JSON 对象");
  }
}

function isCustomer(url) {
  return url.searchParams.get("audience") === "customer";
}
function visibleEvent(event, principal, customer = false) {
  return (
    event.visibility !== "private" ||
    (!customer && auth.canPrivateRead(principal))
  );
}
function projectedEvent(event, principal, customer = false) {
  if (!customer && auth.canPrivateRead(principal)) return event;
  const { originalText: _original, data: _data, ...shared } = event;
  return { ...shared, data: { model: event.data?.model } };
}
function projectedMeeting(meeting, principal, customer = false) {
  const projected = auth.projectMeeting(meeting, principal);
  if (!customer) return projected;
  const { privateNotes: _private, ...shared } = projected;
  return shared;
}
function projectedChange(change, principal, customer, store) {
  // A visibility change must also remove already displayed records. Replay uses
  // current visibility so an old public revision cannot reveal a now private record.
  if (change.kind.startsWith("event.")) {
    const current = store.event(change.meetingId, change.payload.id);
    if (!visibleEvent(current || change.payload, principal, customer))
      return {
        cursor: change.cursor,
        meetingId: change.meetingId,
        kind: "event.removed",
        payload: { id: change.payload.id },
      };
    return {
      ...change,
      payload: projectedEvent(change.payload, principal, customer),
    };
  }
  return change.kind === "meeting.updated"
    ? {
        ...change,
        payload: projectedMeeting(change.payload, principal, customer),
      }
    : change;
}

export function loadEnvironment() {
  const path = join(ROOT, ".env");
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const match = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/i.exec(line);
    if (match && !(match[1] in process.env))
      process.env[match[1]] = match[2].replace(/^(["'])(.*)\1$/, "$2");
  }
}

export function createMeetingServer({
  dataDir = process.env.AI_BOARD_DATA_DIR || join(ROOT, "server/data"),
  webRoot = join(ROOT, "out"),
  databasePath,
} = {}) {
  const store = new MeetingStore(
    databasePath || join(dataDir, "meetingos.sqlite"),
  );
  store.setMaxListeners(0);
  const assistant = new MeetingAssistant(store);
  const streams = new Set();
  const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 });
  let closing = false;

  function openStream(req, res, url, principal, meetingId) {
    const customer = isCustomer(url);
    const after = number(
      req.headers["last-event-id"] || url.searchParams.get("after"),
      0,
    );
    if (
      [...streams].filter((s) => s.principal.user.id === principal.user.id)
        .length >= 15
    )
      throw new ApiError(
        429,
        "TOO_MANY_STREAMS",
        "连接数量过多，请关闭其他页面后重试",
      );
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    const send = (name, value, id) => {
      if (!res.writableEnded && !res.destroyed)
        res.write(
          `${id ? "id: " + id + "\n" : ""}event: ${name}\ndata: ${JSON.stringify(value)}\n\n`,
        );
    };
    const entry = { principal, res };
    streams.add(entry);
    const onChange = (change) => {
      if (change.meetingId === meetingId) {
        const visible = projectedChange(change, principal, customer, store);
        if (visible) send("change", visible, change.cursor);
        else send("cursor", { cursor: change.cursor }, change.cursor);
      }
    };
    const onError = (error) => {
      if (error.meetingId === meetingId && !customer)
        send("assistant-error", { code: error.code, message: error.message });
    };
    const onRevoked = (id) => {
      if (id === principal.tokenId) res.end();
    };
    const onLogout = (hash) => {
      if (hash === principal.sessionHash) res.end();
    };
    store.on("change", onChange);
    store.on("assistant-error", onError);
    store.on("token-revoked", onRevoked);
    store.on("session-ended", onLogout);
    const changes = store.changes(meetingId, after, 1000);
    for (const change of changes) onChange(change);
    const cursor = store.cursor(meetingId);
    send("ready", {
      cursor,
      reload: changes.length === 1000 && changes.at(-1).cursor < cursor,
    });
    const heartbeat = setInterval(() => {
      if (Date.now() > principal.expiresAt) res.end();
      else if (!res.destroyed) res.write(": heartbeat\n\n");
    }, 15000);
    const cleanup = () => {
      clearInterval(heartbeat);
      streams.delete(entry);
      store.off("change", onChange);
      store.off("assistant-error", onError);
      store.off("token-revoked", onRevoked);
      store.off("session-ended", onLogout);
    };
    res.on("close", cleanup);
  }

  async function route(req, res, url) {
    const path = url.pathname,
      method = req.method || "GET";
    if (["POST", "PATCH", "DELETE"].includes(method)) auth.sameOrigin(req);
    if (path === "/api/health")
      return apiJson(res, 200, {
        ok: true,
        application: "MeetingOS",
        schemaVersion: 1,
        asr: asrRuntimeConfig(),
        testMode: process.env.MEETINGOS_TEST_MODE === "true",
      });
    if (path === "/api/v1/auth/register" && method === "POST") {
      const result = auth.register(store, req, await body(req));
      res.setHeader("Set-Cookie", result.cookie);
      return apiJson(res, 201, { ok: true, user: result.user });
    }
    if (path === "/api/v1/auth/login" && method === "POST") {
      const result = auth.login(store, req, await body(req));
      res.setHeader("Set-Cookie", result.cookie);
      return apiJson(res, 200, { ok: true, user: result.user });
    }
    const principal = auth.authenticate(store, req);
    if (path === "/api/v1/auth/me" && method === "GET")
      return apiJson(res, 200, {
        ok: true,
        user: principal.user,
        kind: principal.kind,
      });
    if (path === "/api/v1/auth/logout" && method === "POST") {
      auth.humanOnly(principal);
      res.setHeader("Set-Cookie", auth.logout(store, req));
      return apiJson(res, 200, { ok: true });
    }
    if (path === "/api/v1/assistants" && method === "GET") {
      auth.requireScope(principal, "meetings:read");
      return apiJson(res, 200, { ok: true, assistants: assistantCatalog() });
    }
    if (path === "/api/v1/tokens") {
      auth.humanOnly(principal);
      if (method === "GET")
        return apiJson(res, 200, {
          ok: true,
          tokens: store.listTokens(principal.user.id),
        });
      if (method === "POST")
        return apiJson(res, 201, {
          ok: true,
          token: auth.issueToken(store, principal, await body(req)),
        });
    }
    const tokenMatch = /^\/api\/v1\/tokens\/([^/]+)$/.exec(path);
    if (tokenMatch && method === "DELETE") {
      auth.humanOnly(principal);
      store.revokeToken(principal.user.id, tokenMatch[1]);
      return apiJson(res, 200, { ok: true });
    }
    if (path === "/api/v1/agent/skill" && method === "GET") {
      auth.requireScope(principal, "meetings:read");
      const skill = join(ROOT, "skills/meetingos/SKILL.md");
      if (!existsSync(skill))
        throw new ApiError(404, "SKILL_NOT_FOUND", "接入说明暂不可用");
      res.writeHead(200, {
        "Content-Type": "text/markdown; charset=utf-8",
        "Cache-Control": "no-store",
      });
      return res.end(readFileSync(skill));
    }
    if (path === "/api/v1/meetings") {
      if (method === "GET") {
        auth.requireScope(principal, "meetings:read");
        const meetings = store
          .listMeetings(principal.user.id)
          .filter(
            (m) =>
              !principal.meetingIds.length ||
              principal.meetingIds.includes(m.id),
          )
          .map((m) => projectedMeeting(m, principal, isCustomer(url)));
        return apiJson(res, 200, { ok: true, meetings });
      }
      if (method === "POST") {
        auth.requireScope(principal, "meetings:write");
        if (principal.kind === "agent" && principal.meetingIds.length)
          throw new ApiError(
            403,
            "MEETING_OUT_OF_SCOPE",
            "限定会议的授权不能创建新会议",
          );
        const input = await body(req);
        if (input.privateNotes && !auth.canPrivateWrite(principal))
          throw new ApiError(
            403,
            "INSUFFICIENT_SCOPE",
            "没有写入内部约束的权限",
          );
        if (
          input.model &&
          !assistantCatalog().some((a) => a.id === input.model)
        )
          throw new ApiError(400, "INVALID_ASSISTANT", "请选择有效的会议助手");
        if (input.autoEnabled)
          throw new ApiError(
            400,
            "ENABLE_AFTER_CREATION",
            "请创建会议后连接助手，再开启自动建议",
          );
        return apiJson(res, 201, {
          ok: true,
          meeting: projectedMeeting(
            store.createMeeting(principal.user.id, input),
            principal,
          ),
        });
      }
    }
    const match =
      /^\/api\/v1\/meetings\/([^/]+)(?:\/(events|materials|changes|stream|assistant|export)(?:\/([^/]+)(?:\/(file))?)?)?$/.exec(
        path,
      );
    if (!match) throw new ApiError(404, "NOT_FOUND", "接口不存在");
    const [, id, resource, item, file] = match;
    const writing = ["POST", "PATCH", "DELETE"].includes(method);
    const needed =
      resource === "assistant"
        ? "assistant:ask"
        : resource === "events" && writing
          ? "events:write"
          : writing
            ? "meetings:write"
            : "meetings:read";
    const meeting = auth.accessMeeting(store, principal, id, needed);
    const customer = isCustomer(url);
    const includePrivate = auth.canPrivateRead(principal) && !customer;
    if (!resource) {
      if (method === "GET")
        return apiJson(res, 200, {
          ok: true,
          meeting: projectedMeeting(meeting, principal, customer),
          eventCount: store.countEvents(id, includePrivate),
          cursor: store.cursor(id),
        });
      if (method === "PATCH") {
        const input = await body(req);
        if (
          input.privateNotes !== undefined &&
          !auth.canPrivateWrite(principal)
        )
          throw new ApiError(
            403,
            "INSUFFICIENT_SCOPE",
            "没有修改内部约束的权限",
          );
        if (
          input.model &&
          !assistantCatalog().some((a) => a.id === input.model)
        )
          throw new ApiError(400, "INVALID_ASSISTANT", "请选择有效的会议助手");
        if (
          input.autoEnabled &&
          !assistantCatalog().find(
            (a) => a.id === (input.model || meeting.model),
          )?.configured
        )
          throw new ApiError(
            503,
            "MODEL_NOT_CONFIGURED",
            "请先连接会议助手，再开启自动建议",
          );
        return apiJson(res, 200, {
          ok: true,
          meeting: projectedMeeting(store.updateMeeting(id, input), principal),
        });
      }
    }
    if (resource === "events") {
      if (method === "GET" && !item) {
        const after = number(url.searchParams.get("after"), 0),
          limit = Math.max(1, number(url.searchParams.get("limit"), 200, 500));
        const events = store.events(id, { after, limit, includePrivate }),
          total = store.countEvents(id, includePrivate);
        return apiJson(res, 200, {
          ok: true,
          events: events.map((e) => projectedEvent(e, principal, customer)),
          total,
          nextAfter: events.at(-1)?.seq || after,
          hasMore: events.length === limit,
        });
      }
      if (method === "POST" && !item) {
        const input = await body(req);
        if (input.type === "advice") input.visibility = "private";
        if (input.visibility === "private" && !auth.canPrivateWrite(principal))
          throw new ApiError(
            403,
            "INSUFFICIENT_SCOPE",
            "没有写入私有记录的权限",
          );
        if (
          !["speech", "note", "decision", "action", "advice"].includes(
            input.type || "speech",
          )
        )
          throw new ApiError(400, "INVALID_EVENT_TYPE", "请选择有效的记录类型");
        const result = store.addEvent(id, input, principal);
        if (result.event.type === "speech" && !result.duplicate)
          assistant.schedule(id);
        const event = visibleEvent(result.event, principal)
          ? projectedEvent(result.event, principal)
          : { id: result.event.id, acknowledged: true };
        return apiJson(res, result.duplicate ? 200 : 201, {
          ok: true,
          event,
          duplicate: result.duplicate,
        });
      }
      if (method === "PATCH" && item) {
        const previous = store.event(id, item);
        if (!previous || !visibleEvent(previous, principal))
          throw new ApiError(404, "EVENT_NOT_FOUND", "记录不存在或不可访问");
        const input = await body(req);
        if (
          (previous.visibility === "private" ||
            input.visibility === "private") &&
          !auth.canPrivateWrite(principal)
        )
          throw new ApiError(
            403,
            "INSUFFICIENT_SCOPE",
            "没有修改私有记录的权限",
          );
        if (previous.visibility === "private" && input.visibility === "shared")
          auth.humanOnly(principal);
        const event = store.editEvent(id, item, input, principal);
        return apiJson(res, 200, { ok: true, event });
      }
    }
    if (resource === "materials") {
      if (method === "GET" && !item)
        return apiJson(res, 200, { ok: true, materials: store.materials(id) });
      if (method === "GET" && item && file) {
        const material = store.materialFile(id, item);
        if (!material?.raw)
          throw new ApiError(404, "FILE_NOT_FOUND", "原始文件不存在");
        res.writeHead(200, {
          "Content-Type": "application/octet-stream",
          "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(material.name)}`,
          "Cache-Control": "no-store",
        });
        return res.end(Buffer.from(material.raw));
      }
      if (method === "POST" && !item) {
        const input = await body(req, 23 * 1024 * 1024);
        if (
          typeof input.base64 !== "string" ||
          !input.base64 ||
          !/^[A-Za-z0-9+/]*={0,2}$/.test(input.base64)
        )
          throw new ApiError(400, "INVALID_FILE", "资料内容格式不正确");
        const raw = Buffer.from(input.base64, "base64");
        if (raw.length > 15 * 1024 * 1024)
          throw new ApiError(
            413,
            "FILE_TOO_LARGE",
            "单份资料上限为 15MB，请拆分后重试",
          );
        if (!/\.(txt|md|pdf|docx|pptx)$/i.test(String(input.fileName)))
          throw new ApiError(
            415,
            "UNSUPPORTED_FILE",
            "支持 TXT、Markdown、PDF、DOCX 和 PPTX",
          );
        let extracted;
        try {
          extracted = extractMaterialTextFromFile({
            fileName: input.fileName,
            mimeType: input.mimeType || "",
            fileData: input.base64,
          });
        } catch {
          throw new ApiError(
            422,
            "FILE_UNREADABLE",
            "无法安全读取该资料，请导出为 TXT 或重新上传",
          );
        }
        if (!extracted.extractedText?.trim())
          throw new ApiError(
            422,
            "FILE_UNREADABLE",
            "没有提取到文字；扫描件暂不支持，请改用文本资料",
          );
        if (extracted.extractedText.length > 300000)
          throw new ApiError(
            413,
            "EXTRACTED_TEXT_TOO_LARGE",
            "资料文字过多，请按议题拆分",
          );
        return apiJson(res, 201, {
          ok: true,
          material: store.addMaterial(id, {
            name: input.fileName,
            text: extracted.extractedText,
            bytes: raw.length,
            raw,
          }),
        });
      }
    }
    if (resource === "changes" && method === "GET") {
      const changes = store.changes(
        id,
        number(url.searchParams.get("after"), 0),
        500,
      );
      return apiJson(res, 200, {
        ok: true,
        changes: changes
          .map((c) => projectedChange(c, principal, customer, store))
          .filter(Boolean),
        cursor: changes.at(-1)?.cursor || store.cursor(id),
        hasMore: changes.length === 500,
      });
    }
    if (resource === "stream" && method === "GET")
      return openStream(req, res, url, principal, id);
    if (resource === "export" && method === "GET") {
      const audience =
        url.searchParams.get("audience") === "internal"
          ? "internal"
          : "customer";
      if (audience === "internal") auth.requireScope(principal, "private:read");
      res.writeHead(200, {
        "Content-Type": "text/markdown; charset=utf-8",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(meeting.title + ".md")}`,
        "Cache-Control": "no-store",
      });
      return res.end(exportMeeting(store, meeting, { audience }));
    }
    if (resource === "assistant" && method === "POST") {
      rateLimitAssistant(principal);
      const input = await body(req);
      const audience = input.audience === "customer" ? "customer" : "internal";
      if (input.kind !== "summary" || audience !== "customer")
        auth.requireScope(principal, "private:write");
      if (
        input.roleId &&
        !assistantCatalog().some((a) => a.id === input.roleId)
      )
        throw new ApiError(400, "INVALID_ASSISTANT", "请选择有效的会议助手");
      const stream = String(req.headers.accept || "").includes(
        "text/event-stream",
      );
      const controller = new AbortController();
      const revoked = (tokenId) => {
        if (tokenId === principal.tokenId) controller.abort();
      };
      const loggedOut = (hash) => {
        if (hash === principal.sessionHash) controller.abort();
      };
      store.on("token-revoked", revoked);
      store.on("session-ended", loggedOut);
      const expiry = setTimeout(
        () => controller.abort(),
        Math.min(60000, Math.max(1, principal.expiresAt - Date.now())),
      );
      const cleanup = () => {
        clearTimeout(expiry);
        store.off("token-revoked", revoked);
        store.off("session-ended", loggedOut);
      };
      res.on("close", () => {
        if (!res.writableEnded) controller.abort();
      });
      if (!stream) {
        try {
          return apiJson(res, 200, {
            ok: true,
            ...(await assistant.generate(meeting, principal, {
              ...input,
              audience,
              signal: controller.signal,
            })),
          });
        } finally {
          cleanup();
        }
      }
      res.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        "X-Accel-Buffering": "no",
      });
      const send = (name, value) => {
        if (!res.destroyed)
          res.write(`event: ${name}\ndata: ${JSON.stringify(value)}\n\n`);
      };
      try {
        send("start", { meetingId: id });
        const result = await assistant.generate(meeting, principal, {
          ...input,
          audience,
          signal: controller.signal,
          onToken: (delta) => send("token", { delta }),
        });
        send("end", { ok: true, ...result });
      } catch (error) {
        send("error", {
          ok: false,
          code: error instanceof ApiError ? error.code : "ASSISTANT_ERROR",
          message:
            error instanceof ApiError ? error.message : "会议助手暂不可用",
        });
      } finally {
        cleanup();
      }
      return res.end();
    }
    throw new ApiError(405, "METHOD_NOT_ALLOWED", "此接口不支持这个操作");
  }

  function rateLimitAssistant(principal) {
    auth.rateLimit("assistant:" + principal.user.id, 30, 60000);
  }
  const server = http.createServer((req, res) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "same-origin");
    res.setHeader("X-Frame-Options", "DENY");
    let url;
    try {
      url = new URL(req.url, "http://localhost");
    } catch {
      return errorJson(res, new ApiError(400, "INVALID_URL", "地址不正确"));
    }
    if (url.pathname.startsWith("/api/"))
      return route(req, res, url).catch((error) => errorJson(res, error));
    if (!["GET", "HEAD"].includes(req.method))
      return errorJson(
        res,
        new ApiError(405, "METHOD_NOT_ALLOWED", "不支持这个操作"),
      );
    try {
      const pathname = decodeURIComponent(url.pathname);
      let path = resolve(webRoot, "." + pathname);
      if (path !== resolve(webRoot) && !path.startsWith(resolve(webRoot) + sep))
        throw new ApiError(403, "FORBIDDEN", "不可访问该文件");
      if (!existsSync(path) || statSync(path).isDirectory()) {
        if (extname(path))
          throw new ApiError(404, "FILE_NOT_FOUND", "文件不存在");
        path = join(webRoot, "index.html");
      }
      if (!existsSync(path))
        throw new ApiError(503, "BUILD_REQUIRED", "前端尚未构建");
      const mime = {
        ".html": "text/html; charset=utf-8",
        ".js": "application/javascript; charset=utf-8",
        ".css": "text/css; charset=utf-8",
        ".svg": "image/svg+xml",
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".webp": "image/webp",
        ".woff2": "font/woff2",
      };
      res.setHeader(
        "Content-Security-Policy",
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; base-uri 'self'; frame-ancestors 'none'",
      );
      res.writeHead(200, {
        "Content-Type": mime[extname(path)] || "application/octet-stream",
        "Cache-Control":
          extname(path) === ".html" ? "no-cache" : "public, max-age=3600",
      });
      if (req.method === "HEAD") return res.end();
      createReadStream(path)
        .on("error", () => res.destroy())
        .pipe(res);
    } catch (error) {
      errorJson(res, error);
    }
  });

  server.on("upgrade", (req, socket, head) => {
    try {
      auth.sameOrigin(req);
      const url = new URL(req.url, "http://localhost");
      if (url.pathname !== "/ws/board/transcribe")
        throw new ApiError(404, "NOT_FOUND", "接口不存在");
      const principal = auth.authenticate(store, req),
        id = url.searchParams.get("sessionId") || "";
      auth.accessMeeting(store, principal, id, "events:write");
      wss.handleUpgrade(req, socket, head, (ws) => {
        const expiry = setInterval(() => {
          if (Date.now() >= principal.expiresAt)
            ws.close(1008, "authorization expired");
        }, 15000);
        let speaker = principal.name;
        const save = (text) => {
          auth.authenticate(store, req);
          const result = store.addEvent(
            id,
            {
              id: randomUUID(),
              type: "speech",
              text,
              speaker,
              visibility: "shared",
            },
            principal,
          );
          assistant.schedule(id);
          return result.event;
        };
        const runtime = asrRuntimeConfig();
        const asrError = () => {
          if (ws.readyState === ws.OPEN)
            ws.send(
              JSON.stringify({
                type: "error",
                message: "云端语音转写连接中断，可以继续手动输入",
              }),
            );
        };
        const asr =
          runtime.provider === "aliyun"
            ? createAliyunStream({
                sampleRate: 16000,
                format: "pcm",
                onError: asrError,
                onResult: (text, final) => {
                  try {
                    if (final && text) {
                      save(text);
                      if (ws.readyState === ws.OPEN)
                        ws.send(
                          JSON.stringify({
                            type: "transcript",
                            text,
                            final: true,
                          }),
                        );
                    }
                  } catch {
                    asrError();
                    ws.close(1008, "authorization unavailable");
                  }
                },
              })
            : null;
        if (asr)
          void asr.ready().catch(() => {
            asrError();
            asr.close();
          });
        ws.on("message", (raw, binary) => {
          try {
            auth.authenticate(store, req);
            if (binary) {
              if (asr) asr.sendAudio(raw);
              return;
            }
            const input = JSON.parse(raw.toString());
            if (input.type === "speaker") {
              if (
                typeof input.speaker !== "string" ||
                !input.speaker.trim() ||
                input.speaker.length > 80
              )
                throw new ApiError(
                  400,
                  "INVALID_SPEAKER",
                  "请输入1–80字的发言人",
                );
              speaker = input.speaker.trim();
              return;
            }
            if (input.type === "audio_done") {
              asr?.finish();
              return;
            }
            if (input.type === "transcript" && input.final !== false) {
              const result = store.addEvent(
                id,
                {
                  id: input.id,
                  type: "speech",
                  text: input.text,
                  speaker,
                  visibility: "shared",
                },
                principal,
              );
              if (!result.duplicate) assistant.schedule(id);
            }
          } catch (error) {
            if (ws.readyState === ws.OPEN)
              ws.send(
                JSON.stringify({
                  type: "error",
                  code:
                    error instanceof ApiError ? error.code : "INVALID_MESSAGE",
                  message:
                    error instanceof ApiError
                      ? error.message
                      : "消息格式不正确",
                }),
              );
          }
        });
        const revoked = (tokenId) => {
          if (tokenId === principal.tokenId)
            ws.close(1008, "authorization revoked");
        };
        const loggedOut = (hash) => {
          if (hash === principal.sessionHash) ws.close(1008, "session ended");
        };
        store.on("token-revoked", revoked);
        store.on("session-ended", loggedOut);
        ws.on("close", () => {
          clearInterval(expiry);
          asr?.finish();
          store.off("token-revoked", revoked);
          store.off("session-ended", loggedOut);
        });
        ws.on("error", () => {});
      });
    } catch (error) {
      socket.write(
        `HTTP/1.1 ${error instanceof ApiError ? error.status : 401} Unauthorized\r\nConnection: close\r\n\r\n`,
      );
      socket.destroy();
    }
  });
  const close = async () => {
    if (closing) return;
    closing = true;
    assistant.close();
    for (const entry of streams) entry.res.end();
    for (const ws of wss.clients) ws.terminate();
    wss.close();
    await new Promise((resolveClose) => {
      if (!server.listening) return resolveClose();
      server.close(resolveClose);
      server.closeIdleConnections();
    });
    store.close();
  };
  return { server, store, assistant, close };
}
