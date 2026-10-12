import { useEffect, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import {
  AudioOutlined,
  PlusOutlined,
  SearchOutlined,
  FileTextOutlined,
  MessageOutlined,
  RobotOutlined,
  SettingOutlined,
  LogoutOutlined,
  CloseOutlined,
  PauseOutlined,
  SendOutlined,
  PaperClipOutlined,
  LockOutlined,
  CheckOutlined,
  DownloadOutlined,
  EyeOutlined,
  EditOutlined,
  ApiOutlined,
  MenuOutlined,
} from "@ant-design/icons";
import {
  api,
  send,
  meetingPath,
  requestAssistant,
  RequestError,
  announceAuthChange,
} from "./platform/client";
import type {
  User,
  Meeting,
  Entry,
  Assistant,
  Token,
  Material,
} from "./platform/client";
import { useMeeting } from "./platform/useMeeting";
import { TranscriptionController } from "./lib/transcription";
import type { AsrMode } from "./lib/transcription";

const labels: Record<string, string> = {
  speech: "发言",
  note: "笔记",
  decision: "已确认决定",
  action: "行动项",
  advice: "AI 建议",
  summary: "总结",
};
const time = (value: string) =>
  new Date(value).toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Singapore",
  });
const date = (value: string | number) =>
  new Date(value).toLocaleDateString("zh-CN", {
    month: "long",
    day: "numeric",
    timeZone: "Asia/Singapore",
  });
const message = (error: unknown) =>
  error instanceof Error ? error.message : "操作失败，请重试";

function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const focusable = () =>
      Array.from(
        ref.current?.querySelectorAll<HTMLElement>(
          "button,input,textarea,select,a[href]",
        ) || [],
      ).filter((el) => !el.hasAttribute("disabled"));
    focusable()[0]?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") close.current();
      if (event.key === "Tab") {
        const all = focusable(),
          first = all[0],
          last = all.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("keydown", key);
      previous?.focus();
    };
  }, []);
  return (
    <div className="modal-backdrop">
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        ref={ref}
      >
        <header>
          <h2>{title}</h2>
          <button
            className="icon-button"
            aria-label="关闭窗口"
            onClick={onClose}
          >
            <CloseOutlined aria-hidden="true" />
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}

function Text({ text }: { text: string }) {
  return (
    <div className="formatted-text">
      {text
        .split("\n")
        .map((line, i) =>
          line.startsWith("### ") ? (
            <h4 key={i}>{line.slice(4)}</h4>
          ) : line.startsWith("## ") ? (
            <h3 key={i}>{line.slice(3)}</h3>
          ) : line.startsWith("# ") ? (
            <h3 key={i}>{line.slice(2)}</h3>
          ) : (
            <div key={i}>{line || "\u00a0"}</div>
          ),
        )}
    </div>
  );
}

function Login({ onLogin }: { onLogin: (user: User) => void }) {
  const [register, setRegister] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setBusy(true);
    const fields = Object.fromEntries(new FormData(event.currentTarget));
    try {
      const result = await send<{ user: User }>(
        "/auth/" + (register ? "register" : "login"),
        fields,
      );
      onLogin(result.user);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="login-page">
      <div className="login-intro">
        <div className="wordmark">
          <AudioOutlined aria-hidden="true" />
          MeetingOS
        </div>
        <span className="eyebrow">让好建议赶在决定之前</span>
        <h1>
          会议进行中，
          <br />
          智囊就在身边。
        </h1>
        <p>
          内部会议，及时检查计划中的风险。客户会谈，结合已有资料获得回答建议。
        </p>
        <div className="intro-points">
          <span>
            <FileTextOutlined aria-hidden="true" />
            记录与资料留在一起
          </span>
          <span>
            <MessageOutlined aria-hidden="true" />
            随时向 AI 求助
          </span>
          <span>
            <ApiOutlined aria-hidden="true" />
            人和 Agent 共同参与
          </span>
        </div>
      </div>
      <section className="login-card">
        <h2>{register ? "创建内部账号" : "欢迎回来"}</h2>
        <p>登录后恢复你的会议和资料。</p>
        <form onSubmit={submit}>
          <label>
            账号
            <input
              name="login"
              autoComplete="username"
              required
              minLength={3}
              maxLength={100}
              placeholder="邮箱或账号"
            />
          </label>
          {register && (
            <label>
              姓名
              <input name="name" autoComplete="name" required maxLength={80} />
            </label>
          )}
          <label>
            密码
            <input
              name="password"
              type="password"
              autoComplete={register ? "new-password" : "current-password"}
              required
              minLength={register ? 10 : 1}
              maxLength={128}
            />
          </label>
          {register && (
            <label>
              内部邀请码
              <input
                name="inviteCode"
                autoComplete="off"
                placeholder="管理员提供；开发环境可留空"
              />
            </label>
          )}
          {error && (
            <p role="alert" className="error-message">
              {error}
            </p>
          )}
          <button className="primary wide" disabled={busy}>
            {busy ? "正在处理…" : register ? "创建账号" : "登录"}
          </button>
        </form>
        <button
          className="text-button"
          onClick={() => {
            setRegister(!register);
            setError("");
          }}
        >
          {register ? "已有账号，去登录" : "首次使用？创建账号"}
        </button>
        <p className="small muted">个人 Agent 可选，没有 Agent 也能使用。</p>
      </section>
    </main>
  );
}

function MeetingForm({
  initial,
  defaultMode = "internal",
  onSave,
  onClose,
}: {
  initial?: Meeting;
  defaultMode?: "internal" | "customer";
  onSave: (input: Record<string, unknown>) => Promise<void>;
  onClose: () => void;
}) {
  const [mode, setMode] = useState(initial?.mode || defaultMode),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = Object.fromEntries(new FormData(event.currentTarget));
    setBusy(true);
    setError("");
    try {
      await onSave({ ...fields, mode });
      onClose();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title={initial ? "会议简报与设置" : "新建会议"} onClose={onClose}>
      <form onSubmit={submit}>
        <div className="mode-options">
          <button
            type="button"
            className={mode === "internal" ? "selected" : ""}
            aria-pressed={mode === "internal"}
            onClick={() => setMode("internal")}
          >
            <MessageOutlined aria-hidden="true" />
            <strong>内部会议</strong>
            <span>一起检查计划与风险</span>
          </button>
          <button
            type="button"
            className={mode === "customer" ? "selected" : ""}
            aria-pressed={mode === "customer"}
            onClick={() => setMode("customer")}
          >
            <LockOutlined aria-hidden="true" />
            <strong>客户辅助</strong>
            <span>我方私有的会谈智囊</span>
          </button>
        </div>
        <label>
          会议名称
          <input
            name="title"
            required
            maxLength={160}
            defaultValue={initial?.title}
            placeholder="例如：新产品交付计划评审"
          />
        </label>
        <label>
          目标与背景 <span className="field-hint">参与 AI 上下文 · 共享</span>
          <textarea
            aria-label="目标与背景"
            name="brief"
            rows={4}
            maxLength={12000}
            defaultValue={initial?.brief}
            placeholder="要解决什么问题？有哪些已知条件？希望形成什么决定？"
          />
        </label>
        <label>
          内部约束{" "}
          <span className="field-hint">
            <LockOutlined aria-hidden="true" />
            仅我方可见
          </span>
          <textarea
            aria-label="内部约束"
            name="privateNotes"
            rows={3}
            maxLength={12000}
            defaultValue={initial?.privateNotes}
            placeholder={
              mode === "customer"
                ? "报价底线、产品限制、谈判目标；不会出现在客户展示或共享导出中"
                : "预算边界、敏感信息、需要助手留意的问题"
            }
          />
        </label>
        {error && (
          <p className="error-message" role="alert">
            {error}
          </p>
        )}
        <footer>
          <button type="button" onClick={onClose}>
            取消
          </button>
          <button className="primary" disabled={busy}>
            {busy ? "保存中…" : initial ? "保存设置" : "创建会议"}
          </button>
        </footer>
      </form>
    </Modal>
  );
}

const scopeLabels: Record<string, string> = {
  "meetings:read": "读取会议与共享资料",
  "meetings:write": "修改简报、上传资料",
  "events:write": "追加和修订记录",
  "assistant:ask": "调用会议助手",
  "private:read": "读取私有建议和内部约束",
  "private:write": "写入私有建议和约束",
};
function AgentSettings({
  meeting,
  onClose,
}: {
  meeting: Meeting | null;
  onClose: () => void;
}) {
  const [tokens, setTokens] = useState<Token[]>([]),
    [secret, setSecret] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [scopes, setScopes] = useState(["meetings:read", "events:write"]);
  const load = () =>
    api<{ tokens: Token[] }>("/tokens")
      .then((result) => setTokens(result.tokens))
      .catch((e) => setError(message(e)));
  useEffect(() => {
    void load();
  }, []);
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setSecret("");
    const fields = Object.fromEntries(new FormData(event.currentTarget));
    try {
      const result = await send<{ token: Token }>("/tokens", {
        ...fields,
        scopes,
        meetingIds: fields.range === "current" && meeting ? [meeting.id] : [],
      });
      setSecret(result.token.secret || "");
      await load();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  async function revoke(id: string) {
    try {
      await api("/tokens/" + id, { method: "DELETE" });
      await load();
      setSecret("");
    } catch (e) {
      setError(message(e));
    }
  }
  return (
    <Modal title="接入自己的 Agent" onClose={onClose}>
      <p className="muted">
        Hermes 或其他 Agent 通过 Skill
        和授权令牌读取、补充会议；网页会实时看到变化。
      </p>
      <a
        className="button-link"
        href="/api/v1/agent/skill"
        download="meetingos-SKILL.md"
      >
        <DownloadOutlined aria-hidden="true" />
        下载 Hermes Skill
      </a>
      <form onSubmit={create}>
        <label>
          Agent 名称
          <input
            name="name"
            defaultValue="我的 Hermes"
            required
            maxLength={80}
          />
        </label>
        <div className="form-row">
          <label>
            会议范围
            <select name="range" defaultValue={meeting ? "current" : "all"}>
              {meeting && <option value="current">仅当前会议</option>}
              <option value="all">我账号的所有会议</option>
            </select>
          </label>
          <label>
            有效期
            <select name="days" defaultValue="30">
              <option value="1">1 天</option>
              <option value="7">7 天</option>
              <option value="30">30 天</option>
              <option value="90">90 天</option>
            </select>
          </label>
        </div>
        <fieldset>
          <legend>权限</legend>
          {Object.entries(scopeLabels).map(([scope, label]) => (
            <label className="checkbox-label" key={scope}>
              <input
                type="checkbox"
                checked={scopes.includes(scope)}
                onChange={(event) =>
                  setScopes((prev) =>
                    event.target.checked
                      ? [...prev, scope]
                      : prev.filter((s) => s !== scope),
                  )
                }
              />
              {label}
              {scope.startsWith("private:") && (
                <LockOutlined aria-hidden="true" />
              )}
            </label>
          ))}
        </fieldset>
        <p className="small muted">
          作为会谈智囊写入建议，还需勾选私有写入；读取内部约束需要私有读取权限。
        </p>
        <button className="primary" disabled={busy || !scopes.length}>
          {busy ? "创建中…" : "创建授权"}
        </button>
      </form>
      {secret && (
        <div className="secret-box">
          <strong>令牌仅显示这一次</strong>
          <p>
            保存到 Agent 的受保护环境变量 MEETINGOS_AGENT_TOKEN，并设置
            MEETINGOS_URL 为本站地址。
          </p>
          <input
            aria-label="新创建的 Agent 令牌"
            readOnly
            value={secret}
            onFocus={(event) => event.currentTarget.select()}
          />
        </div>
      )}
      {error && (
        <p role="alert" className="error-message">
          {error}
        </p>
      )}
      <h3 className="section-title">现有授权</h3>
      {tokens.length === 0 ? (
        <p className="muted">还没有授权。</p>
      ) : (
        tokens.map((token) => (
          <div className="token-row" key={token.id}>
            <div>
              <strong>{token.name}</strong>
              <p>
                {token.revoked
                  ? "已撤销"
                  : token.expiresAt < Date.now()
                    ? "已到期"
                    : date(token.expiresAt) + "到期"}{" "}
                · {token.meetingIds.length ? "限定会议" : "我的所有会议"}
              </p>
            </div>
            <button
              disabled={token.revoked}
              onClick={() => void revoke(token.id)}
            >
              撤销
            </button>
          </div>
        ))
      )}
    </Modal>
  );
}

function EditEntry({
  entry,
  approve,
  onSave,
  onClose,
}: {
  entry: Entry;
  approve?: boolean;
  onSave: (data: Record<string, unknown>) => Promise<void>;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    const fields = Object.fromEntries(new FormData(event.currentTarget));
    try {
      await onSave({
        ...fields,
        revision: entry.revision,
        data: approve ? { adoptedFrom: entry.id } : entry.data,
      });
      onClose();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title={approve ? "确认并形成决定" : "修订记录"} onClose={onClose}>
      <form onSubmit={submit}>
        {approve ? (
          <>
            <p className="muted">
              检查事实、负责人和期限。保存后进入共享记录，原 AI
              建议仍保留为私有。
            </p>
            <label>
              类型
              <select name="type">
                <option value="decision">已确认决定</option>
                <option value="action">行动项</option>
              </select>
            </label>
          </>
        ) : (
          <label>
            发言人
            <input
              name="speaker"
              required
              maxLength={80}
              defaultValue={entry.speaker}
            />
          </label>
        )}
        <label>
          内容
          <textarea
            aria-label="内容"
            name="text"
            rows={8}
            required
            maxLength={50000}
            defaultValue={entry.text}
          />
        </label>
        {!approve && (
          <>
            <label>
              可见范围
              <select name="visibility" defaultValue={entry.visibility}>
                <option value="shared">共享记录</option>
                <option value="private">仅我方可见</option>
              </select>
            </label>
            <details>
              <summary>最初原文（保留）</summary>
              <Text text={entry.originalText} />
            </details>
          </>
        )}
        {error && (
          <p className="error-message" role="alert">
            {error}
          </p>
        )}
        <footer>
          <button type="button" onClick={onClose}>
            取消
          </button>
          <button className="primary" disabled={busy}>
            {busy ? "保存中…" : approve ? "确认决定并保存" : "保存修订"}
          </button>
        </footer>
      </form>
    </Modal>
  );
}

function CustomerView({ id }: { id: string }) {
  const { meeting, entries, connection, error, loading } = useMeeting(id, true);
  return (
    <main className="customer-page">
      <header>
        <div className="wordmark">
          <AudioOutlined aria-hidden="true" />
          MeetingOS
        </div>
        <span>
          <EyeOutlined aria-hidden="true" />
          会议展示
        </span>
      </header>
      {loading ? (
        <p>正在恢复共享记录…</p>
      ) : meeting ? (
        <>
          <div className="customer-heading">
            <div>
              <span className="eyebrow">共享会议记录</span>
              <h1>{meeting.title}</h1>
              <p>
                {date(meeting.createdAt)} · {connection}
              </p>
            </div>
            <a
              className="button-link"
              href={"/api/v1" + meetingPath(id) + "/export?audience=customer"}
            >
              <DownloadOutlined aria-hidden="true" />
              导出共享记录
            </a>
          </div>
          {meeting.brief && (
            <section className="brief-card">
              <h3>会议目标</h3>
              <Text text={meeting.brief} />
            </section>
          )}
          <section className="customer-records">
            {entries.length ? (
              entries.map((entry) => <Record key={entry.id} entry={entry} />)
            ) : (
              <Empty
                title="等待会议记录"
                text="新的共享发言、笔记和确认决定会自动显示。"
              />
            )}
          </section>
        </>
      ) : (
        <p role="alert">{error || "请登录后重新打开会议展示。"}</p>
      )}
      {meeting && error && (
        <p className="error-message" role="alert">
          {error}
        </p>
      )}
    </main>
  );
}
function Empty({ title, text }: { title: string; text: string }) {
  return (
    <div className="empty-state">
      <FileTextOutlined aria-hidden="true" />
      <h3>{title}</h3>
      <p>{text}</p>
    </div>
  );
}
function Record({ entry, onEdit }: { entry: Entry; onEdit?: () => void }) {
  return (
    <article
      className={
        "record " +
        (entry.type === "decision" || entry.type === "action"
          ? "confirmed"
          : "")
      }
    >
      <div className="record-meta">
        <strong>{entry.speaker}</strong>
        <span>{time(entry.createdAt)}</span>
        <span
          className={
            "tag " +
            (entry.type === "decision" || entry.type === "action"
              ? "green"
              : "")
          }
        >
          {labels[entry.type]}
        </span>
        {entry.source === "agent" && <span className="tag">Agent</span>}
        {entry.visibility === "private" && (
          <span className="private-label">
            <LockOutlined aria-hidden="true" />
            私有
          </span>
        )}
        {entry.revision > 1 && <span>已修订</span>}
        {onEdit && (
          <button
            className="icon-button"
            aria-label={"修订 " + entry.speaker + " 的记录"}
            onClick={onEdit}
          >
            <EditOutlined aria-hidden="true" />
          </button>
        )}
      </div>
      <Text text={entry.text} />
    </article>
  );
}

function Workbench({
  id,
  catalog,
  onListUpdate,
  onAgents,
}: {
  id: string;
  catalog: Assistant[];
  onListUpdate: () => void;
  onAgents: (meeting: Meeting) => void;
}) {
  const {
    meeting,
    entries,
    materials,
    connection,
    error,
    loading,
    refresh,
    setMeeting,
    setMaterials,
    setError,
  } = useMeeting(id);
  const [tab, setTab] = useState("records"),
    [mobilePanel, setMobilePanel] = useState("records"),
    [settings, setSettings] = useState(false),
    [editing, setEditing] = useState<Entry | null>(null),
    [approval, setApproval] = useState<Entry | null>(null);
  const [text, setText] = useState(""),
    [speaker, setSpeaker] = useState("我方"),
    [entryType, setEntryType] = useState("speech"),
    [privateEntry, setPrivateEntry] = useState(false),
    [saving, setSaving] = useState(false),
    [query, setQuery] = useState("");
  const [question, setQuestion] = useState(""),
    [generating, setGenerating] = useState(false),
    [streamText, setStreamText] = useState(""),
    [streamTask, setStreamTask] = useState("advice"),
    [modelGuide, setModelGuide] = useState(false),
    [uploading, setUploading] = useState(false),
    [uploadPrivate, setUploadPrivate] = useState(true),
    [materialBusy, setMaterialBusy] = useState<string | null>(null),
    [deletingMaterial, setDeletingMaterial] = useState<Material | null>(null),
    [ending, setEnding] = useState(false);
  const [listening, setListening] = useState(false),
    [interim, setInterim] = useState(""),
    [asrMode, setAsrMode] = useState<AsrMode>("webspeech"),
    [aliyunAvailable, setAliyunAvailable] = useState(false),
    [autoPending, setAutoPending] = useState(false);
  const abort = useRef<AbortController | null>(null),
    microphone = useRef<TranscriptionController | null>(null),
    bottom = useRef<HTMLDivElement>(null),
    file = useRef<HTMLInputElement>(null);
  const selected = catalog.find((a) => a.id === meeting?.model);
  useEffect(() => {
    void fetch("/api/health")
      .then((r) => r.json())
      .then((data) => setAliyunAvailable(data.asr?.provider === "aliyun"))
      .catch(() => {});
    return () => {
      microphone.current?.stop();
      abort.current?.abort();
    };
  }, []);
  useEffect(() => {
    if (tab === "records" && !query)
      bottom.current?.scrollIntoView({ block: "nearest" });
  }, [entries.length, tab, query]);
  async function patch(input: Record<string, unknown>) {
    try {
      const result = await send<{ meeting: Meeting }>(
        meetingPath(id),
        input,
        "PATCH",
      );
      setMeeting(result.meeting);
      onListUpdate();
    } catch (e) {
      setError(message(e));
      throw e;
    }
  }
  async function add(input: Record<string, unknown>) {
    await send(meetingPath(id) + "/events", {
      id: crypto.randomUUID(),
      ...input,
    });
    onListUpdate();
  }
  async function toggleAuto(enabled: boolean) {
    if (!meeting || autoPending) return;
    const previous = meeting;
    setAutoPending(true);
    setMeeting({ ...previous, autoEnabled: enabled });
    try {
      await patch({ autoEnabled: enabled });
    } catch {
      setMeeting(previous);
    } finally {
      setAutoPending(false);
    }
  }
  async function record(event: FormEvent) {
    event.preventDefault();
    if (!text.trim()) return;
    setSaving(true);
    setError("");
    try {
      await add({
        text,
        speaker,
        type: entryType,
        visibility: privateEntry ? "private" : "shared",
      });
      setText("");
    } catch (e) {
      setError(message(e));
    } finally {
      setSaving(false);
    }
  }
  async function ask(
    kind = "advice",
    prompt = question,
    audience = "internal",
  ) {
    if (!meeting || generating) return;
    setGenerating(true);
    setStreamText("");
    setStreamTask(kind);
    setError("");
    if (kind === "summary") setTab("summary");
    else setMobilePanel("coach");
    const controller = new AbortController();
    abort.current = controller;
    try {
      await requestAssistant(
        id,
        { kind, question: prompt, roleId: meeting.model, audience },
        setStreamText,
        controller.signal,
      );
      setQuestion("");
      onListUpdate();
    } catch (e) {
      if (!controller.signal.aborted) setError(message(e));
    } finally {
      setGenerating(false);
      setStreamText("");
      abort.current = null;
    }
  }
  async function upload(event: React.ChangeEvent<HTMLInputElement>) {
    const input = event.target.files?.[0];
    if (!input) return;
    event.target.value = "";
    if (input.size > 15 * 1024 * 1024) {
      setError("单份资料上限为 15MB");
      return;
    }
    setUploading(true);
    setError("");
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(",")[1]);
        reader.onerror = reject;
        reader.readAsDataURL(input);
      });
      await send(meetingPath(id) + "/materials", {
        fileName: input.name,
        visibility: uploadPrivate ? "private" : "shared",
        mimeType: input.type,
        base64,
      });
      onListUpdate();
    } catch (e) {
      setError(message(e));
    } finally {
      setUploading(false);
    }
  }
  async function changeMaterial(
    material: Material,
    input: Record<string, unknown>,
    method = "PATCH",
  ) {
    if (materialBusy) return;
    setMaterialBusy(material.id);
    setError("");
    if (method === "PATCH")
      setMaterials((prev) =>
        prev.map((m) => (m.id === material.id ? { ...m, ...input } : m)),
      );
    try {
      const result = await send<{ material?: Material }>(
        meetingPath(id) + "/materials/" + material.id,
        { revision: material.revision, ...input },
        method,
      );
      if (method === "DELETE")
        setMaterials((prev) => prev.filter((m) => m.id !== material.id));
      else if (result.material)
        setMaterials((prev) =>
          prev.map((m) =>
            m.id === material.id && m.revision <= result.material!.revision
              ? result.material!
              : m,
          ),
        );
      setDeletingMaterial(null);
      onListUpdate();
    } catch (e) {
      setMaterials((prev) =>
        prev.map((m) =>
          m.id === material.id && m.revision === material.revision
            ? material
            : m,
        ),
      );
      setError(message(e));
    } finally {
      setMaterialBusy(null);
    }
  }
  async function changeStatus() {
    if (!meeting || ending) return;
    setEnding(true);
    try {
      await patch({
        status: meeting.status === "completed" ? "active" : "completed",
      });
      microphone.current?.stop();
      microphone.current = null;
      setListening(false);
    } catch {
      /* patch displays the error */
    } finally {
      setEnding(false);
    }
  }
  async function toggleMicrophone() {
    if (microphone.current) {
      microphone.current.stop();
      microphone.current = null;
      setInterim("");
      return;
    }
    setError("");
    const controller = new TranscriptionController({
      onTranscript: (transcript, final) => {
        if (final) {
          setInterim("");
          if (asrMode === "webspeech")
            void add({
              text: transcript,
              speaker,
              type: "speech",
              visibility: "shared",
            }).catch((e) => {
              setText((prev) => (prev ? prev + "\n" + transcript : transcript));
              setError(
                "转写未保存：" + message(e) + "。内容已留在输入框，请重试。",
              );
            });
        }
      },
      onInterim: setInterim,
      onStatus: setListening,
      onError: (error) => {
        setError(error);
        controller.stop();
        if (microphone.current === controller) microphone.current = null;
      },
    });
    microphone.current = controller;
    try {
      await controller.start(asrMode, {
        speaker,
        wsUrl:
          (location.protocol === "https:" ? "wss://" : "ws://") +
          location.host +
          "/ws/board/transcribe?sessionId=" +
          encodeURIComponent(id),
      });
    } catch (e) {
      controller.stop();
      microphone.current = null;
      setError(message(e));
    }
  }
  if (loading)
    return <div className="workspace-loading">正在恢复会议、记录和资料…</div>;
  if (!meeting)
    return (
      <div className="workspace-loading">
        <p role="alert">{error || "会议暂不可用"}</p>
        <button onClick={refresh}>重新加载</button>
      </div>
    );
  const records = entries.filter(
    (e) =>
      !["advice", "summary"].includes(e.type) &&
      (!query || e.text.includes(query) || e.speaker.includes(query)),
  );
  const advice = entries.filter((e) => e.type === "advice").toReversed(),
    summaries = entries.filter((e) => e.type === "summary").toReversed();
  return (
    <main className="workbench">
      <header className="meeting-header">
        <div>
          <div className="meeting-heading-meta">
            <span className="tag">
              {meeting.mode === "customer" ? "客户辅助" : "内部会议"}
            </span>
            <span>{date(meeting.createdAt)}</span>
            {meeting.status === "completed" && (
              <span className="tag">已结束</span>
            )}
          </div>
          <h1>{meeting.title}</h1>
          <div className="save-status">
            <span
              className={
                connection === "已同步" ? "status-dot" : "status-dot pending"
              }
            />
            {connection === "已同步" ? "记录已保存 · 实时同步" : connection}
            {listening && <span className="recording-label">正在收音</span>}
          </div>
        </div>
        <div className="header-actions">
          <button onClick={() => void changeStatus()} disabled={ending}>
            {meeting.status === "completed" ? "继续会议" : "结束会议"}
          </button>
          <button onClick={() => setSettings(true)} aria-label="会议设置">
            <SettingOutlined aria-hidden="true" />
            <span>设置</span>
          </button>
          <a
            className="button-link"
            href={"?audience=customer&meeting=" + id}
            target="_blank"
            rel="noreferrer"
          >
            <EyeOutlined aria-hidden="true" />
            <span>会议展示</span>
          </a>
          <a
            className="button-link"
            href={"/api/v1" + meetingPath(id) + "/export?audience=internal"}
          >
            <DownloadOutlined aria-hidden="true" />
            <span>导出</span>
          </a>
        </div>
      </header>
      {error && (
        <div className="error-banner" role="alert">
          <span>{error}</span>
          <button
            className="icon-button"
            aria-label="关闭提示"
            onClick={() => setError("")}
          >
            <CloseOutlined aria-hidden="true" />
          </button>
        </div>
      )}
      <div className="mobile-panels" role="tablist" aria-label="工作区">
        <button
          role="tab"
          aria-selected={mobilePanel === "records"}
          onClick={() => setMobilePanel("records")}
        >
          会议记录
        </button>
        <button
          role="tab"
          aria-selected={mobilePanel === "coach"}
          onClick={() => setMobilePanel("coach")}
        >
          AI 智囊{" "}
          {advice.length > 0 && <span className="count">{advice.length}</span>}
        </button>
      </div>
      <div className="meeting-grid">
        <section
          className={
            "record-panel " + (mobilePanel === "coach" ? "mobile-hidden" : "")
          }
        >
          <div className="panel-tabs" role="tablist" aria-label="会议内容">
            {[
              ["records", "会议记录"],
              ["materials", "资料 " + materials.length],
              ["summary", "会议总结"],
            ].map(([key, label]) => (
              <button
                role="tab"
                aria-selected={tab === key}
                className={tab === key ? "active" : ""}
                onClick={() => setTab(key)}
                key={key}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="record-content">
            {tab === "records" ? (
              <>
                {meeting.brief && (
                  <details className="brief-card" open={records.length === 0}>
                    <summary>会议目标与背景</summary>
                    <Text text={meeting.brief} />
                  </details>
                )}
                <div className="records-toolbar">
                  <span>{records.length} 条记录</span>
                  <label className="record-search">
                    <SearchOutlined aria-hidden="true" />
                    <input
                      aria-label="搜索会议记录"
                      placeholder="搜索记录"
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                    />
                  </label>
                </div>
                {records.length ? (
                  records.map((entry) => (
                    <Record
                      key={entry.id}
                      entry={entry}
                      onEdit={() => setEditing(entry)}
                    />
                  ))
                ) : (
                  <Empty
                    title={
                      query ? "没有匹配的记录" : "开始讨论，让记录跟上思路"
                    }
                    text={
                      query
                        ? "换一个关键词试试。"
                        : "开始收音，或在下方输入发言。AI 会结合这些记录和资料提供建议。"
                    }
                  />
                )}
                <div ref={bottom} />
              </>
            ) : tab === "materials" ? (
              <>
                <div className="section-heading">
                  <div>
                    <h2>会议资料</h2>
                    <p>与发言一起进入 AI 上下文，原始文件也会保存。</p>
                  </div>
                  <button
                    onClick={() => file.current?.click()}
                    disabled={uploading}
                  >
                    <PlusOutlined aria-hidden="true" />
                    {uploading ? "上传中…" : "上传资料"}
                  </button>
                </div>
                <p className="small muted">
                  私有资料只供内部智囊使用，客户展示与客户版总结不会读取。支持
                  TXT、MD、PDF、DOCX、PPTX，每份 15MB；扫描件请先转为文本。
                </p>
                <label className="material-option">
                  <input
                    type="checkbox"
                    checked={uploadPrivate}
                    disabled={uploading}
                    onChange={(e) => setUploadPrivate(e.target.checked)}
                  />
                  新上传资料设为私有
                </label>
                <p className="small muted">
                  仅勾选的资料进入下一次 AI
                  分析。取消选择会保留文件，不会删除已有建议中的引用。
                </p>
                {materials.length ? (
                  materials.map((material) => (
                    <article className="material-card" key={material.id}>
                      <header>
                        <FileTextOutlined aria-hidden="true" />
                        <strong>{material.name}</strong>
                        <a
                          className="icon-button"
                          aria-label={"下载 " + material.name}
                          href={
                            "/api/v1" +
                            meetingPath(id) +
                            "/materials/" +
                            material.id +
                            "/file"
                          }
                        >
                          <DownloadOutlined aria-hidden="true" />
                        </a>
                      </header>
                      <p>
                        {Math.ceil(material.bytes / 1024)} KB ·{" "}
                        {material.text.length} 字 ·{" "}
                        {material.visibility === "private" ? "私有" : "共享"} ·{" "}
                        {material.included ? "参与 AI 分析" : "暂不参与分析"}
                      </p>
                      <div className="material-controls">
                        <label className="material-option">
                          <input
                            type="checkbox"
                            aria-label={"分析 " + material.name}
                            checked={material.included}
                            disabled={materialBusy !== null}
                            onChange={(e) =>
                              void changeMaterial(material, {
                                included: e.target.checked,
                              })
                            }
                          />
                          参与 AI 分析
                        </label>
                        <label className="material-option">
                          <input
                            type="checkbox"
                            aria-label={"私有 " + material.name}
                            checked={material.visibility === "private"}
                            disabled={materialBusy !== null}
                            onChange={(e) =>
                              void changeMaterial(material, {
                                visibility: e.target.checked
                                  ? "private"
                                  : "shared",
                              })
                            }
                          />
                          私有资料
                        </label>
                        <button
                          disabled={materialBusy !== null}
                          aria-label={"删除 " + material.name}
                          onClick={() => setDeletingMaterial(material)}
                        >
                          删除
                        </button>
                      </div>
                      <details>
                        <summary>查看提取文字</summary>
                        <Text text={material.text} />
                      </details>
                    </article>
                  ))
                ) : (
                  <Empty
                    title="先给智囊一点背景"
                    text="上传产品资料、客户需求或方案，建议才有事实依据。"
                  />
                )}
              </>
            ) : (
              <>
                <div className="section-heading">
                  <div>
                    <h2>会议总结</h2>
                    <p>保留讨论、确认决定与行动项；修订后重新生成。</p>
                  </div>
                </div>
                <div className="summary-actions">
                  <button
                    className="primary"
                    disabled={generating}
                    onClick={() =>
                      void ask("summary", "整理会议总结", "internal")
                    }
                  >
                    生成内部总结
                  </button>
                  <button
                    disabled={generating}
                    onClick={() =>
                      void ask("summary", "整理共享会议总结", "customer")
                    }
                  >
                    生成共享总结
                  </button>
                </div>
                {generating && streamTask === "summary" && (
                  <article className="summary-card">
                    <span className="tag">正在整理</span>
                    <Text text={streamText || "正在读取会议上下文…"} />
                  </article>
                )}
                {summaries.map((entry) => (
                  <article className="summary-card" key={entry.id}>
                    <div className="record-meta">
                      <strong>
                        {entry.visibility === "private"
                          ? "内部总结"
                          : "共享总结"}
                      </strong>
                      <span>{time(entry.createdAt)}</span>
                      <button
                        className="icon-button"
                        aria-label="修订会议总结"
                        onClick={() => setEditing(entry)}
                      >
                        <EditOutlined aria-hidden="true" />
                      </button>
                    </div>
                    <Text text={entry.text} />
                  </article>
                ))}
                {!summaries.length && !generating && (
                  <Empty
                    title="讨论完成后，整理为可执行的结果"
                    text="先检查左侧的原始发言和确认决定，再生成总结。"
                  />
                )}
              </>
            )}
          </div>
          <form className="composer" onSubmit={record}>
            <div className="composer-controls">
              <button
                type="button"
                className={listening ? "danger" : "primary"}
                onClick={() => void toggleMicrophone()}
              >
                {listening ? (
                  <PauseOutlined aria-hidden="true" />
                ) : (
                  <AudioOutlined aria-hidden="true" />
                )}
                {listening ? "暂停收音" : "开始收音"}
              </button>
              <select
                aria-label="语音转写方式"
                value={asrMode}
                disabled={listening}
                onChange={(event) => setAsrMode(event.target.value as AsrMode)}
              >
                <option value="webspeech">浏览器转写</option>
                {aliyunAvailable && <option value="aliyun">云端转写</option>}
              </select>
              <button
                type="button"
                className="icon-button"
                aria-label="上传会议资料"
                onClick={() => {
                  setTab("materials");
                  file.current?.click();
                }}
                disabled={uploading}
              >
                <PaperClipOutlined aria-hidden="true" />
              </button>
              <span className="small muted">
                {listening ? "转写逐条保存" : "随时可以手动补充"}
              </span>
            </div>
            {interim && (
              <p className="interim">
                {interim} <span>识别中，尚未保存</span>
              </p>
            )}
            <textarea
              aria-label="输入会议记录"
              placeholder="输入发言、问题或决定…"
              rows={2}
              maxLength={50000}
              value={text}
              onChange={(event) => setText(event.target.value)}
            />
            <div className="composer-footer">
              <input
                aria-label="当前发言人"
                disabled={listening}
                value={speaker}
                maxLength={80}
                onChange={(event) => setSpeaker(event.target.value)}
                placeholder="发言人"
                required
              />
              <select
                aria-label="记录类型"
                value={entryType}
                onChange={(event) => setEntryType(event.target.value)}
              >
                <option value="speech">发言</option>
                <option value="note">笔记</option>
                <option value="decision">确认决定</option>
                <option value="action">行动项</option>
              </select>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={privateEntry}
                  onChange={(event) => setPrivateEntry(event.target.checked)}
                />
                <LockOutlined aria-hidden="true" />
                私有
              </label>
              <button
                type="submit"
                className="primary"
                disabled={!text.trim() || saving}
              >
                <SendOutlined aria-hidden="true" />
                {saving ? "保存中" : "保存"}
              </button>
            </div>
          </form>
          <input
            type="file"
            hidden
            ref={file}
            accept=".txt,.md,.pdf,.docx,.pptx"
            onChange={(event) => void upload(event)}
          />
        </section>
        <aside
          className={
            "coach-panel " + (mobilePanel === "records" ? "mobile-hidden" : "")
          }
        >
          <div className="coach-header">
            <div>
              <h2>
                <RobotOutlined aria-hidden="true" />
                AI 智囊
              </h2>
              <span className="private-label">
                <LockOutlined aria-hidden="true" />
                建议仅我方可见
              </span>
            </div>
            <button
              className="icon-button"
              aria-label="Agent 接入"
              onClick={() => onAgents(meeting)}
            >
              <ApiOutlined aria-hidden="true" />
            </button>
          </div>
          <div className="assistant-settings">
            <div className="assistant-selector">
              <select
                aria-label="会议助手"
                value={meeting.model}
                onChange={(event) =>
                  void patch({ model: event.target.value }).catch(() => {})
                }
              >
                {catalog.map((a) => (
                  <option value={a.id} key={a.id}>
                    {a.name}
                    {a.configured ? "" : " · 未连接"}
                  </option>
                ))}
              </select>
              <button
                className={
                  "model-status " + (selected?.configured ? "connected" : "")
                }
                onClick={() => setModelGuide(true)}
              >
                {selected?.configured ? "已配置" : "未配置"}
              </button>
            </div>
            <label className="auto-control">
              <span>
                实时自动建议
                <span className="small muted">根据新发言检查风险与遗漏</span>
              </span>
              <input
                type="checkbox"
                role="switch"
                aria-label="实时自动建议"
                checked={meeting.autoEnabled}
                disabled={autoPending || meeting.status === "completed"}
                onChange={(event) => void toggleAuto(event.target.checked)}
              />
            </label>
          </div>
          <div className="coach-content">
            {generating && streamTask === "advice" && (
              <article className="advice-card streaming">
                <header>
                  <span className="tag">正在分析</span>
                  <strong>{selected?.name}</strong>
                </header>
                <Text text={streamText || "正在结合简报、资料和会议记录…"} />
                <button
                  className="text-button"
                  onClick={() => abort.current?.abort()}
                >
                  停止生成
                </button>
              </article>
            )}
            {advice.length
              ? advice.map((entry) => (
                  <article className="advice-card" key={entry.id}>
                    <header>
                      <span className="tag blue">
                        {meeting.mode === "customer" ? "回答建议" : "计划审查"}
                      </span>
                      <strong>{entry.speaker}</strong>
                      <span>{time(entry.createdAt)}</span>
                    </header>
                    {entry.data.question && (
                      <p className="advice-question">{entry.data.question}</p>
                    )}
                    <Text
                      text={entry.text.replace(
                        /\[([^\]\n]+)\]/g,
                        (full, source) =>
                          entry.data.sources?.some((s) => s.id === source)
                            ? "[依据 " +
                              (entry.data.sources.findIndex(
                                (s) => s.id === source,
                              ) +
                                1) +
                              "]"
                            : full,
                      )}
                    />
                    {entry.data.sources?.length ? (
                      <details className="source-details">
                        <summary>
                          {entry.data.sources.length} 条引用依据
                        </summary>
                        {entry.data.sources.map((source, index) => (
                          <div key={source.id}>
                            <strong>
                              {index + 1}. {source.label}
                            </strong>
                            <p>{source.excerpt}</p>
                          </div>
                        ))}
                      </details>
                    ) : (
                      <p className="small muted">
                        未附可验证引用，请结合原始资料核实。
                      </p>
                    )}
                    {entry.data.contextChangedDuringRequest && (
                      <p className="small warning">
                        分析期间记录已更新，可重新求助获取最新建议。
                      </p>
                    )}
                    <footer>
                      <span>
                        <LockOutlined aria-hidden="true" />
                        私有建议
                      </span>
                      <button onClick={() => setApproval(entry)}>
                        <CheckOutlined aria-hidden="true" />
                        形成决定
                      </button>
                    </footer>
                  </article>
                ))
              : !generating && (
                  <div className="coach-empty">
                    <MessageOutlined aria-hidden="true" />
                    <h3>
                      {meeting.mode === "customer"
                        ? "带上资料，随时回应客户"
                        : "在决定之前，多一个视角"}
                    </h3>
                    <p>
                      {meeting.mode === "customer"
                        ? "记录客户问题，输入“帮我回答”，获得建议、依据和需核实的内容。"
                        : "让 AI 检查当前讨论中的预算、工期与责任，尽早发现遗漏。"}
                    </p>
                    {!selected?.configured && (
                      <button onClick={() => setModelGuide(true)}>
                        连接模型或接入 Agent
                      </button>
                    )}
                  </div>
                )}
          </div>
          <div className="ask-box">
            <div className="quick-actions">
              <button
                disabled={generating}
                onClick={() =>
                  void ask(
                    "advice",
                    meeting.mode === "customer"
                      ? "帮我回答客户刚才的问题"
                      : "检查当前计划的风险",
                  )
                }
              >
                {meeting.mode === "customer" ? "帮我回答" : "检查风险"}
              </button>
              <button
                disabled={generating}
                onClick={() => void ask("advice", "下一步应该追问什么？")}
              >
                建议追问
              </button>
            </div>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void ask();
              }}
            >
              <textarea
                aria-label="向 AI 提问"
                value={question}
                rows={2}
                maxLength={4000}
                onChange={(event) => setQuestion(event.target.value)}
                placeholder={
                  meeting.mode === "customer"
                    ? "客户提问了，帮我组织回答…"
                    : "让 AI 审查计划，或问一个具体问题…"
                }
              />
              <button className="primary" disabled={generating} type="submit">
                <SendOutlined aria-hidden="true" />
                {generating ? "分析中…" : "立即求助"}
              </button>
            </form>
            <p className="small muted">结合简报、资料、会议记录和此前建议</p>
          </div>
        </aside>
      </div>
      {settings && (
        <MeetingForm
          initial={meeting}
          onClose={() => setSettings(false)}
          onSave={patch}
        />
      )}{" "}
      {editing && (
        <EditEntry
          entry={editing}
          onClose={() => setEditing(null)}
          onSave={async (data) => {
            await send(
              meetingPath(id) + "/events/" + editing.id,
              data,
              "PATCH",
            );
            onListUpdate();
          }}
        />
      )}
      {deletingMaterial && (
        <Modal title="删除资料" onClose={() => setDeletingMaterial(null)}>
          <p>
            删除「{deletingMaterial.name}
            」的原文件与提取文字，后续分析不再读取。这不会移除已经保存的建议或其中的引用。
          </p>
          <button
            className="primary"
            disabled={materialBusy !== null}
            onClick={() => void changeMaterial(deletingMaterial, {}, "DELETE")}
          >
            确认删除资料
          </button>
        </Modal>
      )}
      {approval && (
        <EditEntry
          entry={approval}
          approve
          onClose={() => setApproval(null)}
          onSave={async (data) => {
            await add({ ...data, speaker: "我方确认", visibility: "shared" });
          }}
        />
      )}
      {modelGuide && (
        <Modal title="连接会议助手" onClose={() => setModelGuide(false)}>
          <p>
            模型状态由实际服务器配置决定。请在受保护的环境设置中配置模型凭证，再重启本项目。
          </p>
          <div className="connection-guide">
            <strong>海外模型</strong>
            <p>
              LINKHARBOR_API_KEY、LINKHARBOR_BASE_URL
              <br />
              可指定
              MEETINGOS_GPT_MODEL、MEETINGOS_CLAUDE_MODEL、MEETINGOS_GEMINI_MODEL
            </p>
            <strong>DeepSeek Flash 与思维视角 · wei.run</strong>
            <p>
              WEI_LLM_API_KEY、WEI_LLM_BASE_URL
              <br />
              可指定 MEETINGOS_DEEPSEEK_MODEL
            </p>
          </div>
          <p className="muted">
            也可以让已有的 Hermes
            使用自己的模型，通过授权写入会议建议。缺少连接时，记录与资料仍可继续保存。
          </p>
          <button
            className="primary"
            onClick={() => {
              setModelGuide(false);
              onAgents(meeting);
            }}
          >
            接入自己的 Agent
          </button>
        </Modal>
      )}
    </main>
  );
}

function MainApp() {
  const [user, setUser] = useState<User | null>(null),
    [initializing, setInitializing] = useState(true),
    [meetings, setMeetings] = useState<Meeting[]>([]),
    [catalog, setCatalog] = useState<Assistant[]>([]),
    [active, setActive] = useState(
      new URLSearchParams(location.search).get("meeting") || "",
    ),
    [search, setSearch] = useState(""),
    [create, setCreate] = useState(false),
    [createMode, setCreateMode] = useState<"internal" | "customer">("internal"),
    [agent, setAgent] = useState(false),
    [agentMeeting, setAgentMeeting] = useState<Meeting | null>(null),
    [sidebar, setSidebar] = useState(false),
    [error, setError] = useState("");
  const identity = useRef<User | null>(null),
    authRequest = useRef(0);
  function applyIdentity(next: User | null) {
    if (identity.current && identity.current.id !== next?.id) {
      setMeetings([]);
      setActive("");
      setSearch("");
      setAgent(false);
      setAgentMeeting(null);
      setCreate(false);
      setSidebar(false);
      setError("");
      history.replaceState(null, "", location.pathname);
    }
    identity.current = next;
    setUser(next);
  }
  const load = () => {
    const expected = identity.current?.id;
    if (!expected) return;
    void api<{ meetings: Meeting[] }>("/meetings")
      .then((result) => {
        if (identity.current?.id === expected) setMeetings(result.meetings);
      })
      .catch((e) => {
        if (identity.current?.id === expected) setError(message(e));
      });
  };
  useEffect(() => {
    let alive = true;
    const check = () => {
      const ticket = ++authRequest.current;
      void api<{ user: User }>("/auth/me")
        .then((result) => {
          if (alive && ticket === authRequest.current)
            applyIdentity(result.user);
        })
        .catch((error) => {
          if (
            alive &&
            ticket === authRequest.current &&
            error instanceof RequestError &&
            error.status === 401
          )
            applyIdentity(null);
        })
        .finally(() => {
          if (alive && ticket === authRequest.current) setInitializing(false);
        });
    };
    check();
    const channel =
      typeof BroadcastChannel !== "undefined"
        ? new BroadcastChannel("meetingos-auth")
        : null;
    const changed = () => {
      applyIdentity(null);
      check();
    };
    if (channel) channel.onmessage = changed;
    window.addEventListener("focus", check);
    window.addEventListener("meetingos-auth-changed", changed);
    return () => {
      alive = false;
      authRequest.current++;
      channel?.close();
      window.removeEventListener("focus", check);
      window.removeEventListener("meetingos-auth-changed", changed);
    };
  }, []);
  useEffect(() => {
    if (!user) return;
    load();
    void api<{ assistants: Assistant[] }>("/assistants")
      .then((result) => setCatalog(result.assistants))
      .catch((e) => setError(message(e)));
  }, [user]);
  function select(id: string) {
    setActive(id);
    setSidebar(false);
    history.replaceState(null, "", "?meeting=" + encodeURIComponent(id));
  }
  async function logout() {
    try {
      await send("/auth/logout", {});
      authRequest.current++;
      applyIdentity(null);
      announceAuthChange(false);
    } catch (e) {
      setError(message(e));
    }
  }
  if (initializing)
    return <main className="workspace-loading">正在加载 MeetingOS…</main>;
  if (!user)
    return (
      <Login
        onLogin={(next) => {
          authRequest.current++;
          applyIdentity(next);
          setInitializing(false);
          announceAuthChange(false);
        }}
      />
    );
  return (
    <div className="app-shell">
      <button
        className="mobile-menu icon-button"
        aria-label="打开会议导航"
        onClick={() => setSidebar(!sidebar)}
      >
        <MenuOutlined aria-hidden="true" />
      </button>
      {sidebar && (
        <button
          className="sidebar-scrim"
          aria-label="关闭会议导航"
          onClick={() => setSidebar(false)}
        />
      )}
      <aside className={"sidebar " + (sidebar ? "open" : "")}>
        <a
          href="/"
          className="wordmark"
          onClick={(event) => {
            event.preventDefault();
            select("");
          }}
        >
          <AudioOutlined aria-hidden="true" />
          MeetingOS
        </a>
        <button
          className="primary new-meeting"
          onClick={() => {
            setCreateMode("internal");
            setCreate(true);
            setSidebar(false);
          }}
        >
          <PlusOutlined aria-hidden="true" />
          新建会议
        </button>
        <label className="sidebar-search">
          <SearchOutlined aria-hidden="true" />
          <input
            aria-label="搜索历史会议"
            placeholder="搜索会议"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <div className="sidebar-heading">
          我的会议<span>{meetings.length}</span>
        </div>
        <nav aria-label="会议列表">
          {meetings
            .filter((m) => !search || m.title.includes(search))
            .map((meeting) => (
              <button
                className={
                  "meeting-link " + (active === meeting.id ? "active" : "")
                }
                onClick={() => select(meeting.id)}
                key={meeting.id}
              >
                <FileTextOutlined aria-hidden="true" />
                <span>
                  <strong>{meeting.title}</strong>
                  <small>
                    {date(meeting.createdAt)} ·{" "}
                    {meeting.mode === "customer" ? "客户辅助" : "内部会议"}
                  </small>
                </span>
              </button>
            ))}
          {!meetings.length && (
            <p className="sidebar-empty">
              创建第一场会议
              <br />
              记录、资料和建议会保存在这里。
            </p>
          )}
        </nav>
        <div className="sidebar-bottom">
          <button
            onClick={() => {
              setAgentMeeting(meetings.find((m) => m.id === active) || null);
              setAgent(true);
            }}
          >
            <ApiOutlined aria-hidden="true" />
            Agent 接入
          </button>
          <div className="user-row">
            <div>
              <strong>{user.name}</strong>
              <span>个人工作空间</span>
            </div>
            <button
              className="icon-button"
              aria-label="退出登录"
              onClick={() => void logout()}
            >
              <LogoutOutlined aria-hidden="true" />
            </button>
          </div>
        </div>
      </aside>
      {active ? (
        <Workbench
          key={active}
          id={active}
          catalog={catalog}
          onListUpdate={load}
          onAgents={(meeting) => {
            setAgentMeeting(meeting);
            setAgent(true);
          }}
        />
      ) : (
        <main className="welcome-page">
          <span className="eyebrow">你的会议工作空间</span>
          <h1>
            从讨论到决定，
            <br />让 AI 及时参与。
          </h1>
          <p>
            准备背景资料，记录实时讨论，获得可核实的建议。
            <br />
            所有会议按账号保存，随时回来继续。
          </p>
          <div className="welcome-options">
            <button
              onClick={() => {
                setCreateMode("internal");
                setCreate(true);
              }}
            >
              <MessageOutlined aria-hidden="true" />
              <h2>内部会议</h2>
              <p>在工作安排之前，检查风险与遗漏。</p>
              <span>
                新建会议 <PlusOutlined aria-hidden="true" />
              </span>
            </button>
            <button
              onClick={() => {
                setCreateMode("customer");
                setCreate(true);
              }}
            >
              <LockOutlined aria-hidden="true" />
              <h2>客户辅助</h2>
              <p>准备资料，把会谈智囊带到现场。</p>
              <span>
                新建会议 <PlusOutlined aria-hidden="true" />
              </span>
            </button>
          </div>
          {error && (
            <p className="error-message" role="alert">
              {error}
            </p>
          )}
        </main>
      )}
      {create && (
        <MeetingForm
          defaultMode={createMode}
          onClose={() => setCreate(false)}
          onSave={async (input) => {
            const result = await send<{ meeting: Meeting }>("/meetings", input);
            load();
            select(result.meeting.id);
          }}
        />
      )}
      {agent && (
        <AgentSettings meeting={agentMeeting} onClose={() => setAgent(false)} />
      )}
    </div>
  );
}
export default function App() {
  const params = new URLSearchParams(location.search);
  return params.get("audience") === "customer" ? (
    <CustomerView id={params.get("meeting") || ""} />
  ) : (
    <MainApp />
  );
}
