export type User = { id: string; name: string; login: string };
export type Meeting = {
  id: string;
  title: string;
  mode: "internal" | "customer";
  brief: string;
  privateNotes?: string;
  model: string;
  roleIds: string[];
  autoEnabled: boolean;
  status: string;
  version: number;
  createdAt: string;
  updatedAt: string;
};
export type Source = {
  id: string;
  label: string;
  type: string;
  excerpt: string;
};
export type Entry = {
  id: string;
  seq: number;
  type: "speech" | "note" | "decision" | "action" | "advice" | "summary";
  text: string;
  originalText: string;
  speaker: string;
  source: string;
  visibility: "shared" | "private";
  revision: number;
  createdAt: string;
  data: {
    question?: string;
    model?: string;
    sources?: Source[];
    contextChangedDuringRequest?: boolean;
    uncited?: boolean;
  };
};
export type Material = {
  id: string;
  name: string;
  text: string;
  bytes: number;
  createdAt: string;
};
export type Assistant = {
  id: string;
  name: string;
  title: string;
  provider: string;
  model: string;
  configured: boolean;
};
export type Token = {
  id: string;
  name: string;
  scopes: string[];
  meetingIds: string[];
  expiresAt: number;
  revoked: boolean;
  secret?: string;
};
export type Change = {
  cursor: number;
  kind: string;
  payload: Entry | Meeting | Material | { id: string };
};
export class RequestError extends Error {
  code: string;
  status: number;
  constructor(message: string, code: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export async function api<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch("/api/v1" + path, {
    ...options,
    headers: { "Content-Type": "application/json", ...options.headers },
    credentials: "same-origin",
  });
  const value = await response.json();
  if (!response.ok)
    throw new RequestError(
      value.message || "请求失败，请重试",
      value.code,
      response.status,
    );
  return value as T;
}
export const send = <T>(path: string, value: unknown, method = "POST") =>
  api<T>(path, { method, body: JSON.stringify(value) });
export const meetingPath = (id: string) =>
  "/meetings/" + encodeURIComponent(id);

export async function requestAssistant(
  id: string,
  input: unknown,
  onToken: (text: string) => void,
  signal: AbortSignal,
): Promise<Entry> {
  const response = await fetch("/api/v1" + meetingPath(id) + "/assistant", {
    method: "POST",
    credentials: "same-origin",
    signal,
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    const value = await response.json();
    throw new RequestError(value.message, value.code, response.status);
  }
  if (!response.body) throw new Error("助手连接中断，请重试");
  const reader = response.body.getReader(),
    decoder = new TextDecoder();
  let buffer = "",
    text = "",
    result: Entry | undefined;
  const frame = (block: string) => {
    const kind = block
      .split("\n")
      .find((line) => line.startsWith("event:"))
      ?.slice(6)
      .trim();
    const raw = block
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim())
      .join("\n");
    if (!raw) return;
    const data = JSON.parse(raw);
    if (kind === "token") {
      text += data.delta;
      onToken(text);
    }
    if (kind === "error") throw new RequestError(data.message, data.code, 502);
    if (kind === "end") result = data.event;
  };
  try {
    while (true) {
      const chunk = await reader.read();
      buffer += decoder.decode(chunk.value, { stream: !chunk.done });
      const blocks = buffer.split("\n\n");
      buffer = blocks.pop() || "";
      blocks.forEach(frame);
      if (chunk.done) {
        if (buffer.trim()) frame(buffer);
        break;
      }
    }
  } finally {
    reader.releaseLock();
  }
  if (!result) throw new Error("助手未完成回复，请重试");
  return result;
}
