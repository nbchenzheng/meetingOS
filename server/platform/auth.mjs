import {
  createHash,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import { ApiError } from "./store.mjs";

export const tokenScopes = [
  "meetings:read",
  "meetings:write",
  "events:write",
  "assistant:ask",
  "private:read",
  "private:write",
];
export const digest = (value) =>
  createHash("sha256").update(value).digest("hex");
const COOKIE = "meetingos_session";
const SESSION_MS = 7 * 24 * 60 * 60 * 1000;

export function passwordHash(password) {
  const salt = randomBytes(16).toString("hex");
  return `scrypt-v1:${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
}
const dummyHash = passwordHash(randomBytes(32).toString("hex"));
export function verifyPassword(password, stored) {
  const [, salt, key] = (stored || dummyHash).split(":");
  try {
    const actual = scryptSync(password, salt, 64),
      expected = Buffer.from(key, "hex");
    return (
      expected.length === actual.length &&
      timingSafeEqual(actual, expected) &&
      Boolean(stored)
    );
  } catch {
    return false;
  }
}

export function readCookie(req) {
  const pair = (req.headers.cookie || "")
    .split(";")
    .map((v) => v.trim())
    .find((v) => v.startsWith(COOKIE + "="));
  return pair ? pair.slice(COOKIE.length + 1) : "";
}

export function sameOrigin(req) {
  if (req.headers["sec-fetch-site"] === "cross-site")
    throw new ApiError(
      403,
      "CROSS_ORIGIN_REQUEST",
      "此操作必须从 MeetingOS 内发起",
    );
  const origin = req.headers.origin;
  if (!origin) return;
  const expected = process.env.MEETINGOS_PUBLIC_URL
    ? new URL(process.env.MEETINGOS_PUBLIC_URL).origin
    : `${req.socket.encrypted ? "https" : "http"}://${req.headers.host}`;
  if (origin !== expected)
    throw new ApiError(
      403,
      "CROSS_ORIGIN_REQUEST",
      "此操作必须从 MeetingOS 内发起",
    );
}

function cookie(req, value, seconds) {
  const secure = Boolean(
    req.socket.encrypted ||
      process.env.MEETINGOS_PUBLIC_URL?.startsWith("https://"),
  );
  return `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${seconds}${secure ? "; Secure" : ""}`;
}

const attempts = new Map();
export function rateLimit(key, maximum = 30, windowMs = 60_000) {
  const current = attempts.get(key);
  const state =
    current && current.until > Date.now()
      ? current
      : { count: 0, until: Date.now() + windowMs };
  state.count += 1;
  attempts.set(key, state);
  if (attempts.size > 10000)
    for (const [name, entry] of attempts)
      if (entry.until < Date.now()) attempts.delete(name);
  if (state.count > maximum)
    throw new ApiError(429, "RATE_LIMIT", "操作过于频繁，请稍后重试");
}

export function register(store, req, body) {
  sameOrigin(req);
  rateLimit("register:" + req.socket.remoteAddress, 10, 15 * 60_000);
  const invite = process.env.MEETINGOS_INVITE_CODE;
  if (process.env.NODE_ENV === "production" && !invite)
    throw new ApiError(
      503,
      "REGISTRATION_DISABLED",
      "暂未开放注册，请联系管理员",
    );
  if (invite) {
    const provided = digest(String(body.inviteCode || "")),
      expected = digest(invite);
    if (!timingSafeEqual(Buffer.from(provided), Buffer.from(expected)))
      throw new ApiError(403, "INVITE_REQUIRED", "请输入有效的内部邀请码");
  }
  const login = String(body.login || "")
    .trim()
    .toLowerCase();
  const name = String(body.name || "").trim();
  const password = String(body.password || "");
  if (!/^[a-z0-9_.@+-]{3,100}$/.test(login))
    throw new ApiError(
      400,
      "INVALID_LOGIN",
      "账号请使用 3–100 位字母、数字或邮箱",
    );
  if (!name || name.length > 80)
    throw new ApiError(400, "INVALID_NAME", "请输入 1–80 字的姓名");
  if (password.length < 10 || password.length > 128)
    throw new ApiError(400, "INVALID_PASSWORD", "密码长度需为 10–128 位");
  const user = store.createUser({
    login,
    name,
    passwordHash: passwordHash(password),
  });
  return createSession(store, req, user);
}

export function login(store, req, body) {
  sameOrigin(req);
  rateLimit("login-ip:" + req.socket.remoteAddress, 100, 60000);
  const login = String(body.login || "")
    .trim()
    .toLowerCase()
    .slice(0, 100);
  rateLimit("login:" + req.socket.remoteAddress + ":" + login, 20, 15 * 60_000);
  const row = store.findUser(login);
  const password = String(body.password || "");
  if (password.length > 128 || !verifyPassword(password, row?.password_hash))
    throw new ApiError(401, "INVALID_CREDENTIALS", "账号或密码不正确");
  return createSession(store, req, store.user(row.id));
}

export function createSession(store, req, user) {
  const session = randomBytes(32).toString("base64url");
  store.saveSession(digest(session), user.id, Date.now() + SESSION_MS);
  return { user, cookie: cookie(req, session, SESSION_MS / 1000) };
}
export function logout(store, req) {
  sameOrigin(req);
  const value = readCookie(req);
  if (value) store.deleteSession(digest(value));
  return cookie(req, "", 0);
}

export function authenticate(store, req) {
  const header = req.headers.authorization;
  if (header) {
    const match = /^Bearer (mos_[A-Za-z0-9_-]{40,100})$/.exec(header);
    const token = match ? store.tokenByHash(digest(match[1])) : null;
    if (!token)
      throw new ApiError(
        401,
        "INVALID_TOKEN",
        "Agent 授权无效、已到期或已撤销",
      );
    return {
      kind: "agent",
      id: token.id,
      name: token.name,
      user: token.user,
      scopes: token.scopes,
      meetingIds: token.meetingIds,
      tokenId: token.id,
      expiresAt: token.expiresAt,
    };
  }
  const value = readCookie(req),
    hash = value ? digest(value) : "";
  const session = hash ? store.session(hash) : null;
  if (!session) throw new ApiError(401, "LOGIN_REQUIRED", "请先登录");
  return {
    kind: "human",
    id: session.user.id,
    name: session.user.name,
    user: session.user,
    scopes: tokenScopes,
    meetingIds: [],
    sessionHash: hash,
    expiresAt: session.expires_at,
  };
}
export function humanOnly(principal) {
  if (principal.kind !== "human")
    throw new ApiError(403, "HUMAN_ONLY", "请在登录后的网页中管理授权");
}
export function requireScope(principal, scope) {
  if (!principal.scopes.includes(scope))
    throw new ApiError(403, "INSUFFICIENT_SCOPE", "此授权没有执行该操作的权限");
}
export function canPrivateRead(principal) {
  return principal.scopes.includes("private:read");
}
export function canPrivateWrite(principal) {
  return principal.scopes.includes("private:write");
}
export function accessMeeting(store, principal, id, scope = "meetings:read") {
  requireScope(principal, scope);
  const meeting = store.meeting(id);
  if (!meeting || meeting.ownerId !== principal.user.id)
    throw new ApiError(404, "MEETING_NOT_FOUND", "会议不存在或不可访问");
  if (
    principal.kind === "agent" &&
    principal.meetingIds.length &&
    !principal.meetingIds.includes(id)
  )
    throw new ApiError(403, "MEETING_OUT_OF_SCOPE", "这场会议不在授权范围内");
  return meeting;
}

export function issueToken(store, principal, input) {
  humanOnly(principal);
  if (input.scopes !== undefined && !Array.isArray(input.scopes))
    throw new ApiError(400, "INVALID_SCOPES", "授权权限必须是列表");
  const scopes =
    input.scopes === undefined ? ["meetings:read"] : [...new Set(input.scopes)];
  if (!scopes.length || scopes.some((s) => !tokenScopes.includes(s)))
    throw new ApiError(400, "INVALID_SCOPES", "请选择有效的授权权限");
  const meetingIds = Array.isArray(input.meetingIds)
    ? [...new Set(input.meetingIds)]
    : [];
  if (
    meetingIds.length > 100 ||
    meetingIds.some((id) => typeof id !== "string" || id.length > 120)
  )
    throw new ApiError(400, "INVALID_MEETINGS", "请选择有效的会议范围");
  for (const id of meetingIds) accessMeeting(store, principal, id);
  const days = Math.max(1, Math.min(90, Number(input.days) || 30));
  const secret = "mos_" + randomBytes(48).toString("base64url");
  const token = store.createToken({
    hash: digest(secret),
    userId: principal.user.id,
    name: input.name,
    scopes,
    meetingIds,
    expiresAt: Date.now() + days * 86400000,
  });
  return { ...token, secret };
}

export function projectMeeting(meeting, principal) {
  if (canPrivateRead(principal)) return meeting;
  const { privateNotes: _private, ...visible } = meeting;
  return visible;
}
