import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MeetingStore } from "../platform/store.mjs";
import {
  passwordHash,
  verifyPassword,
  issueToken,
  authenticate,
  accessMeeting,
} from "../platform/auth.mjs";
import { meetingContext, exportMeeting } from "../platform/assistant.mjs";

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), "meetingos-store-"));
  const store = new MeetingStore(join(dir, "db.sqlite"));
  const owner = store.createUser({
    login: "owner",
    name: "内部同事",
    passwordHash: passwordHash("fixture-password-only"),
  });
  const principal = {
    kind: "human",
    id: owner.id,
    name: owner.name,
    user: owner,
    scopes: [
      "meetings:read",
      "meetings:write",
      "events:write",
      "assistant:ask",
      "private:read",
      "private:write",
    ],
    meetingIds: [],
  };
  t.after(() => {
    if (store.db.isOpen) store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return { store, dir, owner, principal };
}

test("完整保存超过 200 条记录，同 ID 重试幂等并拒绝不同内容复用", (t) => {
  const { store, owner, principal } = fixture(t);
  const meeting = store.createMeeting(owner.id, { title: "长会" });
  for (let i = 0; i < 251; i++)
    store.addEvent(
      meeting.id,
      { id: "event-" + i, type: "speech", text: "发言 " + i, speaker: "客户" },
      principal,
    );
  assert.equal(store.countEvents(meeting.id), 251);
  assert.equal(store.events(meeting.id, { after: 200, limit: 100 }).length, 51);
  assert.equal(
    store.addEvent(
      meeting.id,
      { id: "event-0", type: "speech", text: "发言 0", speaker: "客户" },
      principal,
    ).duplicate,
    true,
  );
  assert.throws(
    () =>
      store.addEvent(
        meeting.id,
        { id: "event-0", text: "不同内容" },
        principal,
      ),
    { code: "EVENT_ID_CONFLICT" },
  );
  assert.throws(() => store.addEvent(meeting.id, { text: "   " }, principal), {
    code: "EMPTY_TEXT",
  });
});

test("纯转写立即落盘；重新打开数据库仍保留原稿、类型和说话人", (t) => {
  const { store, dir, owner, principal } = fixture(t);
  const meeting = store.createMeeting(owner.id);
  const entry = store.addEvent(
    meeting.id,
    { type: "speech", text: "部署至少三周", speaker: "我方" },
    principal,
  ).event;
  const reader = new MeetingStore(join(dir, "db.sqlite"));
  assert.equal(reader.event(meeting.id, entry.id).text, "部署至少三周");
  assert.equal(reader.event(meeting.id, entry.id).type, "speech");
  assert.equal(reader.event(meeting.id, entry.id).speaker, "我方");
  reader.close();
});

test("修订采用并发版本校验，下游导出和上下文使用新版本并保留原文", (t) => {
  const { store, owner, principal } = fixture(t);
  const meeting = store.createMeeting(owner.id, { brief: "预算不超过12万元" });
  const original = store.addEvent(
    meeting.id,
    { text: "一周交付" },
    principal,
  ).event;
  const updated = store.editEvent(
    meeting.id,
    original.id,
    { revision: 1, text: "三周交付" },
    principal,
  );
  assert.equal(updated.revision, 2);
  assert.equal(updated.originalText, "一周交付");
  assert.throws(
    () =>
      store.editEvent(
        meeting.id,
        original.id,
        { revision: 1, text: "错误覆盖" },
        principal,
      ),
    { code: "REVISION_CONFLICT" },
  );
  assert.ok(
    exportMeeting(store, store.meeting(meeting.id)).includes("三周交付"),
  );
  const context = meetingContext(store, store.meeting(meeting.id));
  assert.ok(context.content.includes("预算不超过12万元"));
  assert.ok(context.content.includes("三周交付"));
  assert.ok(!context.content.includes("一周交付"));
});

test("客户投影不包含私有底线和建议，内部投影可以读取", (t) => {
  const { store, owner, principal } = fixture(t);
  const meeting = store.createMeeting(owner.id, {
    brief: "产品部署说明",
    privateNotes: "PRIVATE_ONLY_FLOOR_88",
  });
  store.addEvent(
    meeting.id,
    { text: "客户的问题", visibility: "shared" },
    principal,
  );
  store.addEvent(
    meeting.id,
    { type: "advice", text: "PRIVATE_ONLY_STRATEGY", visibility: "private" },
    principal,
  );
  assert.ok(exportMeeting(store, meeting).includes("客户的问题"));
  assert.ok(!exportMeeting(store, meeting).includes("PRIVATE_ONLY"));
  assert.ok(
    exportMeeting(store, meeting, { audience: "internal" }).includes(
      "PRIVATE_ONLY_FLOOR_88",
    ),
  );
  assert.ok(
    !meetingContext(store, meeting, { audience: "customer" }).content.includes(
      "PRIVATE_ONLY",
    ),
  );
});

test("作用域令牌绑定账号和会议，撤销后立即拒绝；密码仅保存哈希", (t) => {
  const { store, owner, principal } = fixture(t);
  const one = store.createMeeting(owner.id),
    two = store.createMeeting(owner.id);
  const other = store.createUser({
    login: "other",
    name: "其他同事",
    passwordHash: passwordHash("fixture-second-password"),
  });
  const foreign = store.createMeeting(other.id);
  const token = issueToken(store, principal, {
    name: "Hermes",
    scopes: ["meetings:read"],
    meetingIds: [one.id],
  });
  const req = { headers: { authorization: "Bearer " + token.secret } };
  const agent = authenticate(store, req);
  assert.equal(accessMeeting(store, agent, one.id).id, one.id);
  assert.throws(() => accessMeeting(store, agent, two.id), {
    code: "MEETING_OUT_OF_SCOPE",
  });
  assert.throws(() => accessMeeting(store, agent, foreign.id), {
    code: "MEETING_NOT_FOUND",
  });
  assert.throws(() => accessMeeting(store, agent, one.id, "events:write"), {
    code: "INSUFFICIENT_SCOPE",
  });
  store.revokeToken(owner.id, token.id);
  assert.throws(() => authenticate(store, req), { code: "INVALID_TOKEN" });
  assert.ok(
    verifyPassword(
      "fixture-password-only",
      store.findUser("owner").password_hash,
    ),
  );
  assert.ok(
    !verifyPassword("wrong-password", store.findUser("owner").password_hash),
  );
  assert.ok(
    !store.findUser("owner").password_hash.includes("fixture-password-only"),
  );
});

test("资料 schema 可从第一版升级并持久化私有/选择/修订状态", (t) => {
  const { store, dir, owner } = fixture(t);
  const meeting = store.createMeeting(owner.id, { title: "升级验收" });
  // Recreate exactly the original eight-column material table, retaining a real row.
  store.db.exec(
    "DROP TABLE materials; CREATE TABLE materials (id TEXT PRIMARY KEY,meeting_id TEXT,name TEXT,text TEXT,bytes INTEGER,created_at TEXT,raw BLOB,digest TEXT)",
  );
  store.db
    .prepare("INSERT INTO materials VALUES (?,?,?,?,?,?,?,?)")
    .run(
      "legacy-material",
      meeting.id,
      "历史资料.txt",
      "历史文字",
      12,
      new Date().toISOString(),
      Buffer.from("历史文字"),
      null,
    );
  store.close();
  const restored = new MeetingStore(join(dir, "db.sqlite"));
  const legacy = restored.material(meeting.id, "legacy-material");
  assert.equal(legacy.visibility, "shared");
  assert.equal(legacy.included, true);
  const edited = restored.updateMaterial(meeting.id, legacy.id, {
    revision: 1,
    visibility: "private",
    included: false,
  });
  assert.equal(edited.revision, 2);
  assert.ok(
    !meetingContext(restored, restored.meeting(meeting.id)).content.includes(
      "历史文字",
    ),
  );
  assert.ok(restored.materialFile(meeting.id, legacy.id).raw);
  restored.close();
  const reopened = new MeetingStore(join(dir, "db.sqlite"));
  assert.equal(reopened.material(meeting.id, legacy.id).visibility, "private");
  assert.equal(reopened.material(meeting.id, legacy.id).revision, 2);
  reopened.close();
});
