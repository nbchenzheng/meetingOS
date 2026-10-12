import { DatabaseSync } from "node:sqlite";
import { EventEmitter } from "node:events";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { createHash, randomUUID } from "node:crypto";

export class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export const now = () => new Date().toISOString();
export const json = (value) => JSON.stringify(value);
export const decode = (value, fallback = {}) => {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
};

const eventTypes = new Set([
  "speech",
  "note",
  "decision",
  "action",
  "advice",
  "summary",
]);
function metadata(value) {
  const data =
    value && typeof value === "object" && !Array.isArray(value)
      ? { ...value }
      : {};
  if (data.question === null) data.question = "";
  if (data.sources === null) data.sources = [];
  if (
    (data.question !== undefined && typeof data.question !== "string") ||
    (data.sources !== undefined &&
      (!Array.isArray(data.sources) ||
        data.sources.some(
          (s) =>
            !s ||
            typeof s !== "object" ||
            ["id", "label", "excerpt"].some(
              (key) => typeof s[key] !== "string",
            ),
        )))
  )
    throw new ApiError(
      400,
      "INVALID_METADATA",
      "问题应为文本；引用 sources 需要包含 id、label、excerpt 文本字段",
    );
  return data;
}
const string = (value, maximum = 50000) =>
  String(value ?? "")
    .trim()
    .slice(0, maximum);
const eventId = (value) => {
  const id = value || randomUUID();
  if (!/^[a-zA-Z0-9_.:-]{1,120}$/.test(id))
    throw new ApiError(400, "INVALID_EVENT_ID", "记录 ID 格式不正确");
  return id;
};

export function publicUser(row) {
  return row ? { id: row.id, name: row.name, login: row.login } : null;
}

export class MeetingStore extends EventEmitter {
  constructor(path) {
    super();
    mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode=WAL;
      PRAGMA foreign_keys=ON;
      PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY, login TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
        password_hash TEXT NOT NULL, created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sessions (
        hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), expires_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS agent_tokens (
        id TEXT PRIMARY KEY, hash TEXT NOT NULL UNIQUE, user_id TEXT NOT NULL REFERENCES users(id),
        name TEXT NOT NULL, scopes TEXT NOT NULL, meeting_ids TEXT NOT NULL,
        created_at TEXT NOT NULL, expires_at INTEGER NOT NULL, revoked INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS meetings (
        id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id), title TEXT NOT NULL,
        mode TEXT NOT NULL, brief TEXT NOT NULL DEFAULT '', private_notes TEXT NOT NULL DEFAULT '',
        model TEXT NOT NULL DEFAULT 'deepseek', role_ids TEXT NOT NULL DEFAULT '[]',
        auto_enabled INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'active',
        version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS events (
        meeting_id TEXT NOT NULL REFERENCES meetings(id), id TEXT NOT NULL, seq INTEGER NOT NULL,
        type TEXT NOT NULL, text TEXT NOT NULL, original_text TEXT NOT NULL,
        speaker TEXT NOT NULL, actor_id TEXT NOT NULL, visibility TEXT NOT NULL,
        source TEXT NOT NULL, data TEXT NOT NULL DEFAULT '{}', revision INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        PRIMARY KEY(meeting_id,id), UNIQUE(meeting_id,seq)
      );
      CREATE TABLE IF NOT EXISTS event_versions (
        meeting_id TEXT NOT NULL, event_id TEXT NOT NULL, revision INTEGER NOT NULL,
        text TEXT NOT NULL, speaker TEXT NOT NULL, visibility TEXT NOT NULL, data TEXT NOT NULL,
        actor_id TEXT NOT NULL, created_at TEXT NOT NULL,
        PRIMARY KEY(meeting_id,event_id,revision)
      );
      CREATE TABLE IF NOT EXISTS materials (
        id TEXT PRIMARY KEY, meeting_id TEXT NOT NULL REFERENCES meetings(id), name TEXT NOT NULL,
        text TEXT NOT NULL, bytes INTEGER NOT NULL, created_at TEXT NOT NULL, raw BLOB, digest TEXT
      );
      CREATE TABLE IF NOT EXISTS changes (
        cursor INTEGER PRIMARY KEY AUTOINCREMENT, meeting_id TEXT NOT NULL REFERENCES meetings(id),
        kind TEXT NOT NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS generations (
        meeting_id TEXT NOT NULL REFERENCES meetings(id), cache_key TEXT NOT NULL,
        event_id TEXT NOT NULL, PRIMARY KEY(meeting_id,cache_key)
      );
      CREATE INDEX IF NOT EXISTS event_sequence ON events(meeting_id,seq);
      CREATE INDEX IF NOT EXISTS owner_meetings ON meetings(owner_id,updated_at);
      CREATE INDEX IF NOT EXISTS meeting_changes ON changes(meeting_id,cursor);
      PRAGMA user_version=1;
    `);
    const materialColumns = new Set(
      this.db
        .prepare("PRAGMA table_info(materials)")
        .all()
        .map((c) => c.name),
    );
    if (!materialColumns.has("raw"))
      this.db.exec("ALTER TABLE materials ADD COLUMN raw BLOB");
    if (!materialColumns.has("digest"))
      this.db.exec("ALTER TABLE materials ADD COLUMN digest TEXT");
    for (const [name, definition] of [
      ["visibility", "TEXT NOT NULL DEFAULT 'shared'"],
      ["included", "INTEGER NOT NULL DEFAULT 1"],
      ["revision", "INTEGER NOT NULL DEFAULT 1"],
    ])
      if (!materialColumns.has(name))
        this.db.exec(`ALTER TABLE materials ADD COLUMN ${name} ${definition}`);
  }

  transaction(callback) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = callback();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  createUser({ login, name, passwordHash }) {
    const user = { id: randomUUID(), login, name, createdAt: now() };
    try {
      this.db
        .prepare("INSERT INTO users VALUES (?,?,?,?,?)")
        .run(user.id, login, name, passwordHash, user.createdAt);
    } catch (error) {
      if (String(error.message).includes("UNIQUE"))
        throw new ApiError(409, "ACCOUNT_EXISTS", "这个账号已经注册");
      throw error;
    }
    return publicUser(user);
  }

  findUser(login) {
    return this.db.prepare("SELECT * FROM users WHERE login=?").get(login);
  }
  user(id) {
    return publicUser(
      this.db.prepare("SELECT * FROM users WHERE id=?").get(id),
    );
  }
  saveSession(hash, userId, expiresAt) {
    this.db
      .prepare("INSERT INTO sessions VALUES (?,?,?)")
      .run(hash, userId, expiresAt);
  }
  session(hash) {
    const row = this.db
      .prepare("SELECT * FROM sessions WHERE hash=? AND expires_at>?")
      .get(hash, Date.now());
    return row ? { ...row, user: this.user(row.user_id) } : null;
  }
  deleteSession(hash) {
    this.db.prepare("DELETE FROM sessions WHERE hash=?").run(hash);
    this.emit("session-ended", hash);
  }

  createToken({ hash, userId, name, scopes, meetingIds, expiresAt }) {
    const token = {
      id: randomUUID(),
      name: string(name, 80) || "个人 Agent",
      scopes,
      meetingIds,
      createdAt: now(),
      expiresAt,
      revoked: false,
    };
    this.db
      .prepare("INSERT INTO agent_tokens VALUES (?,?,?,?,?,?,?,?,0)")
      .run(
        token.id,
        hash,
        userId,
        token.name,
        json(scopes),
        json(meetingIds),
        token.createdAt,
        expiresAt,
      );
    return token;
  }
  tokenByHash(hash) {
    const row = this.db
      .prepare(
        "SELECT * FROM agent_tokens WHERE hash=? AND revoked=0 AND expires_at>?",
      )
      .get(hash, Date.now());
    return row
      ? {
          id: row.id,
          name: row.name,
          user: this.user(row.user_id),
          scopes: decode(row.scopes, []),
          meetingIds: decode(row.meeting_ids, []),
          expiresAt: row.expires_at,
        }
      : null;
  }
  listTokens(userId) {
    return this.db
      .prepare(
        "SELECT id,name,scopes,meeting_ids,created_at,expires_at,revoked FROM agent_tokens WHERE user_id=? ORDER BY created_at DESC",
      )
      .all(userId)
      .map((r) => ({
        id: r.id,
        name: r.name,
        scopes: decode(r.scopes, []),
        meetingIds: decode(r.meeting_ids, []),
        createdAt: r.created_at,
        expiresAt: r.expires_at,
        revoked: Boolean(r.revoked),
      }));
  }
  revokeToken(userId, id) {
    const result = this.db
      .prepare("UPDATE agent_tokens SET revoked=1 WHERE user_id=? AND id=?")
      .run(userId, id);
    if (!result.changes)
      throw new ApiError(404, "TOKEN_NOT_FOUND", "授权不存在");
    this.emit("token-revoked", id);
  }

  meeting(id) {
    const r = this.db.prepare("SELECT * FROM meetings WHERE id=?").get(id);
    return r
      ? {
          id: r.id,
          ownerId: r.owner_id,
          title: r.title,
          mode: r.mode,
          brief: r.brief,
          privateNotes: r.private_notes,
          model: r.model,
          roleIds: decode(r.role_ids, []),
          autoEnabled: Boolean(r.auto_enabled),
          status: r.status,
          version: r.version,
          createdAt: r.created_at,
          updatedAt: r.updated_at,
        }
      : null;
  }
  listMeetings(ownerId) {
    return this.db
      .prepare(
        "SELECT id FROM meetings WHERE owner_id=? ORDER BY updated_at DESC,id",
      )
      .all(ownerId)
      .map((r) => this.meeting(r.id));
  }
  createMeeting(ownerId, input = {}) {
    for (const [key, max] of [
      ["title", 160],
      ["brief", 12000],
      ["privateNotes", 12000],
    ])
      if (String(input[key] || "").length > max)
        throw new ApiError(
          413,
          "MEETING_TEXT_TOO_LARGE",
          `会议 ${key} 最多 ${max} 字符`,
        );
    const id = randomUUID(),
      date = now();
    const title = string(input.title, 160) || "未命名会议";
    const mode = input.mode === "customer" ? "customer" : "internal";
    const roles = Array.isArray(input.roleIds)
      ? [...new Set(input.roleIds.map(String))].slice(0, 10)
      : [];
    this.db
      .prepare(
        "INSERT INTO meetings (id,owner_id,title,mode,brief,private_notes,model,role_ids,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
      )
      .run(
        id,
        ownerId,
        title,
        mode,
        string(input.brief, 12000),
        string(input.privateNotes, 12000),
        string(input.model, 80) || "deepseek",
        json(roles),
        date,
        date,
      );
    return this.meeting(id);
  }

  bump(id, affectsContext = true) {
    this.db
      .prepare("UPDATE meetings SET version=version+?,updated_at=? WHERE id=?")
      .run(affectsContext ? 1 : 0, now(), id);
  }
  change(id, kind, payload) {
    const date = now();
    const row = this.db
      .prepare(
        "INSERT INTO changes(meeting_id,kind,payload,created_at) VALUES (?,?,?,?)",
      )
      .run(id, kind, json(payload), date);
    return {
      cursor: Number(row.lastInsertRowid),
      meetingId: id,
      kind,
      payload,
      createdAt: date,
    };
  }
  publish(change) {
    this.emit("change", change);
  }

  updateMeeting(id, patch = {}) {
    const previous = this.meeting(id);
    const next = { ...previous };
    for (const [key, max] of [
      ["title", 160],
      ["brief", 12000],
      ["privateNotes", 12000],
    ])
      if (String(patch[key] || "").length > max)
        throw new ApiError(
          413,
          "MEETING_TEXT_TOO_LARGE",
          `会议 ${key} 最多 ${max} 字符`,
        );
    if (["internal", "customer"].includes(patch.mode)) next.mode = patch.mode;
    for (const [key, limit] of [
      ["title", 160],
      ["brief", 12000],
      ["privateNotes", 12000],
      ["model", 80],
    ])
      if (typeof patch[key] === "string") next[key] = string(patch[key], limit);
    if (!next.title) next.title = "未命名会议";
    if (Array.isArray(patch.roleIds))
      next.roleIds = [...new Set(patch.roleIds.map(String))].slice(0, 10);
    if (typeof patch.autoEnabled === "boolean")
      next.autoEnabled = patch.autoEnabled;
    if (["active", "completed"].includes(patch.status))
      next.status = patch.status;
    if (next.status === "completed") next.autoEnabled = false;
    const change = this.transaction(() => {
      this.db
        .prepare(
          "UPDATE meetings SET title=?,brief=?,private_notes=?,model=?,role_ids=?,auto_enabled=?,status=?,mode=? WHERE id=?",
        )
        .run(
          next.title,
          next.brief,
          next.privateNotes,
          next.model,
          json(next.roleIds),
          Number(next.autoEnabled),
          next.status,
          next.mode,
          id,
        );
      this.bump(id);
      return this.change(id, "meeting.updated", this.meeting(id));
    });
    this.publish(change);
    return this.meeting(id);
  }

  event(meetingId, id) {
    const r = this.db
      .prepare("SELECT * FROM events WHERE meeting_id=? AND id=?")
      .get(meetingId, id);
    return r
      ? {
          id: r.id,
          seq: r.seq,
          type: r.type,
          text: r.text,
          originalText: r.original_text,
          speaker: r.speaker,
          actorId: r.actor_id,
          visibility: r.visibility,
          source: r.source,
          data: decode(r.data),
          revision: r.revision,
          createdAt: r.created_at,
          updatedAt: r.updated_at,
        }
      : null;
  }
  events(meetingId, { after = 0, limit = 200, includePrivate = true } = {}) {
    return this.db
      .prepare(
        `SELECT id FROM events WHERE meeting_id=? AND seq>? ${includePrivate ? "" : "AND visibility='shared'"} ORDER BY seq LIMIT ?`,
      )
      .all(meetingId, after, limit)
      .map((r) => this.event(meetingId, r.id));
  }
  allEvents(meetingId, includePrivate = true) {
    return this.db
      .prepare(
        `SELECT id FROM events WHERE meeting_id=? ${includePrivate ? "" : "AND visibility='shared'"} ORDER BY seq`,
      )
      .all(meetingId)
      .map((row) => this.event(meetingId, row.id));
  }
  countEvents(meetingId, includePrivate = true) {
    return this.db
      .prepare(
        `SELECT COUNT(*) AS n FROM events WHERE meeting_id=? ${includePrivate ? "" : "AND visibility='shared'"}`,
      )
      .get(meetingId).n;
  }

  addEvent(meetingId, input, actor) {
    const id = eventId(input.id);
    const type = eventTypes.has(input.type) ? input.type : "speech";
    const text = string(input.text);
    if (!text) throw new ApiError(400, "EMPTY_TEXT", "请输入记录内容");
    if (String(input.text).length > 50000)
      throw new ApiError(413, "TEXT_TOO_LARGE", "单条记录最多 50000 字符");
    const visibility = input.visibility === "private" ? "private" : "shared";
    const speaker = string(input.speaker, 80) || actor.name;
    const data = metadata(input.data);
    if (json(data).length > 20000)
      throw new ApiError(413, "METADATA_TOO_LARGE", "记录附加信息过大");
    let emitted;
    const result = this.transaction(() => {
      const existing = this.event(meetingId, id);
      if (existing) {
        if (
          existing.text !== text ||
          existing.type !== type ||
          existing.visibility !== visibility ||
          existing.speaker !== speaker
        )
          throw new ApiError(
            409,
            "EVENT_ID_CONFLICT",
            "同一 ID 已有不同记录，请使用编辑接口",
          );
        return { event: existing, duplicate: true };
      }
      const seq = this.db
        .prepare(
          "SELECT COALESCE(MAX(seq),0)+1 AS seq FROM events WHERE meeting_id=?",
        )
        .get(meetingId).seq;
      const date = now();
      const source =
        actor.kind === "assistant"
          ? "model"
          : actor.kind === "agent"
            ? "agent"
            : "human";
      this.db
        .prepare("INSERT INTO events VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
        .run(
          meetingId,
          id,
          seq,
          type,
          text,
          text,
          speaker,
          actor.id,
          visibility,
          source,
          json(data),
          1,
          date,
          date,
        );
      this.bump(meetingId, type !== "summary");
      const event = this.event(meetingId, id);
      emitted = this.change(meetingId, "event.created", event);
      return { event, duplicate: false };
    });
    if (emitted) this.publish(emitted);
    return result;
  }

  editEvent(meetingId, id, patch, actor) {
    let emitted;
    const result = this.transaction(() => {
      const old = this.event(meetingId, id);
      if (!old) throw new ApiError(404, "EVENT_NOT_FOUND", "这条记录不存在");
      if (patch.revision !== old.revision)
        throw new ApiError(
          409,
          "REVISION_CONFLICT",
          "这条记录已被更新，请刷新后再编辑",
        );
      const text = patch.text === undefined ? old.text : string(patch.text);
      if (!text) throw new ApiError(400, "EMPTY_TEXT", "内容不能为空");
      if (patch.text && String(patch.text).length > 50000)
        throw new ApiError(413, "TEXT_TOO_LARGE", "单条记录最多 50000 字符");
      const speaker =
        patch.speaker === undefined
          ? old.speaker
          : string(patch.speaker, 80) || old.speaker;
      const visibility =
        patch.visibility === undefined
          ? old.visibility
          : patch.visibility === "private"
            ? "private"
            : "shared";
      const data = metadata(
        patch.data &&
          typeof patch.data === "object" &&
          !Array.isArray(patch.data)
          ? { ...old.data, ...patch.data }
          : old.data,
      );
      if (json(data).length > 20000)
        throw new ApiError(413, "METADATA_TOO_LARGE", "记录附加信息过大");
      this.db
        .prepare("INSERT INTO event_versions VALUES (?,?,?,?,?,?,?,?,?)")
        .run(
          meetingId,
          id,
          old.revision,
          old.text,
          old.speaker,
          old.visibility,
          json(old.data),
          actor.id,
          now(),
        );
      this.db
        .prepare(
          "UPDATE events SET text=?,speaker=?,visibility=?,data=?,revision=revision+1,updated_at=? WHERE meeting_id=? AND id=?",
        )
        .run(text, speaker, visibility, json(data), now(), meetingId, id);
      this.bump(meetingId, old.type !== "summary");
      this.db
        .prepare("DELETE FROM generations WHERE meeting_id=? AND event_id=?")
        .run(meetingId, id);
      const event = this.event(meetingId, id);
      emitted = this.change(meetingId, "event.updated", event);
      return event;
    });
    this.publish(emitted);
    return result;
  }

  materials(meetingId) {
    return this.db
      .prepare(
        "SELECT id,name,text,bytes,created_at,visibility,included,revision FROM materials WHERE meeting_id=? ORDER BY created_at",
      )
      .all(meetingId)
      .map((r) => ({
        id: r.id,
        name: r.name,
        text: r.text,
        bytes: r.bytes,
        createdAt: r.created_at,
        visibility: r.visibility,
        included: Boolean(r.included),
        revision: r.revision,
      }));
  }
  material(meetingId, id) {
    return this.materials(meetingId).find((m) => m.id === id);
  }
  materialFile(meetingId, id) {
    return this.db
      .prepare(
        "SELECT name,raw,visibility FROM materials WHERE meeting_id=? AND id=?",
      )
      .get(meetingId, id);
  }
  addMaterial(
    meetingId,
    { name, text, bytes, raw = null, visibility = "shared", included = true },
  ) {
    const digest = raw ? createHash("sha256").update(raw).digest("hex") : null;
    if (digest) {
      const existing = this.db
        .prepare(
          "SELECT id FROM materials WHERE meeting_id=? AND digest=? AND visibility=?",
        )
        .get(meetingId, digest, visibility);
      if (existing)
        return this.materials(meetingId).find((m) => m.id === existing.id);
    }
    const material = {
      id: randomUUID(),
      name: string(name, 180),
      text: String(text ?? ""),
      bytes,
      visibility,
      included,
      revision: 1,
      createdAt: now(),
    };
    const change = this.transaction(() => {
      this.db
        .prepare(
          "INSERT INTO materials (id,meeting_id,name,text,bytes,created_at,raw,digest,visibility,included,revision) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
        )
        .run(
          material.id,
          meetingId,
          material.name,
          material.text,
          material.bytes,
          material.createdAt,
          raw,
          digest,
          visibility,
          Number(included),
          1,
        );
      this.bump(meetingId);
      return this.change(meetingId, "material.created", material);
    });
    this.publish(change);
    return material;
  }
  updateMaterial(meetingId, id, patch) {
    const previous = this.material(meetingId, id);
    if (!previous) throw new ApiError(404, "FILE_NOT_FOUND", "资料不存在");
    if (patch.revision !== previous.revision)
      throw new ApiError(
        409,
        "REVISION_CONFLICT",
        "资料已被修改，请刷新后重试",
      );
    const next = { ...previous, ...patch, id, revision: previous.revision + 1 };
    const change = this.transaction(() => {
      this.db
        .prepare(
          "UPDATE materials SET visibility=?,included=?,revision=? WHERE meeting_id=? AND id=?",
        )
        .run(
          next.visibility,
          Number(next.included),
          next.revision,
          meetingId,
          id,
        );
      this.bump(meetingId);
      return this.change(
        meetingId,
        "material.updated",
        this.material(meetingId, id),
      );
    });
    this.publish(change);
    return this.material(meetingId, id);
  }
  deleteMaterial(meetingId, id, revision) {
    const previous = this.material(meetingId, id);
    if (!previous) throw new ApiError(404, "FILE_NOT_FOUND", "资料不存在");
    if (revision !== previous.revision)
      throw new ApiError(
        409,
        "REVISION_CONFLICT",
        "资料已被修改，请刷新后重试",
      );
    const change = this.transaction(() => {
      this.db
        .prepare("DELETE FROM materials WHERE meeting_id=? AND id=?")
        .run(meetingId, id);
      // Clear extracted text from replay history as well as the original file.
      this.db
        .prepare(
          "DELETE FROM changes WHERE meeting_id=? AND kind LIKE 'material.%' AND json_extract(payload,'$.id')=?",
        )
        .run(meetingId, id);
      this.bump(meetingId);
      return this.change(meetingId, "material.removed", { id });
    });
    this.publish(change);
  }
  cursor(id) {
    return this.db
      .prepare(
        "SELECT COALESCE(MAX(cursor),0) AS cursor FROM changes WHERE meeting_id=?",
      )
      .get(id).cursor;
  }
  changes(id, after = 0, limit = 500) {
    return this.db
      .prepare(
        "SELECT * FROM changes WHERE meeting_id=? AND cursor>? ORDER BY cursor LIMIT ?",
      )
      .all(id, after, limit)
      .map((r) => ({
        cursor: r.cursor,
        meetingId: id,
        kind: r.kind,
        payload: decode(r.payload),
        createdAt: r.created_at,
      }));
  }
  cache(id, key) {
    const r = this.db
      .prepare(
        "SELECT event_id FROM generations WHERE meeting_id=? AND cache_key=?",
      )
      .get(id, key);
    return r ? this.event(id, r.event_id) : null;
  }
  saveCache(id, key, eventId) {
    this.db
      .prepare("INSERT OR REPLACE INTO generations VALUES (?,?,?)")
      .run(id, key, eventId);
  }
  close() {
    this.db.close();
  }
}
