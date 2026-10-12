import { useEffect, useState, useCallback } from "react";
import { api, meetingPath, RequestError } from "./client";
import type { Meeting, Entry, Material, Change } from "./client";

export function useMeeting(id: string, customer = false) {
  const [meeting, setMeeting] = useState<Meeting | null>(null),
    [entries, setEntries] = useState<Entry[]>([]),
    [materials, setMaterials] = useState<Material[]>([]);
  const [connection, setConnection] = useState("正在恢复"),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(false),
    [reload, setReload] = useState(0);
  const refresh = useCallback(() => setReload((v) => v + 1), []);
  useEffect(() => {
    let alive = true,
      stream: EventSource | undefined;
    const controller = new AbortController(),
      path = meetingPath(id),
      query = customer ? "?audience=customer" : "";
    setMeeting(null);
    setEntries([]);
    setMaterials([]);
    setError("");
    if (!id) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setConnection("正在恢复");
    const change = (data: Change) => {
      if (data.kind === "event.removed") {
        setEntries((prev) => prev.filter((e) => e.id !== data.payload.id));
        return;
      }
      if (data.kind.startsWith("event.")) {
        const event = data.payload as Entry;
        setEntries((prev) =>
          [...prev.filter((e) => e.id !== event.id), event].sort(
            (a, b) => a.seq - b.seq,
          ),
        );
      }
      if (data.kind === "meeting.updated") setMeeting(data.payload as Meeting);
      if (data.kind === "material.created") {
        const material = data.payload as Material;
        setMaterials((prev) => [
          ...prev.filter((m) => m.id !== material.id),
          material,
        ]);
      }
    };
    void (async () => {
      try {
        const detail = await api<{ meeting: Meeting; cursor: number }>(
          path + query,
          { signal: controller.signal },
        );
        const all: Entry[] = [];
        let after = 0;
        while (true) {
          const page = await api<{
            events: Entry[];
            nextAfter: number;
            hasMore: boolean;
          }>(
            path +
              "/events?limit=500&after=" +
              after +
              (customer ? "&audience=customer" : ""),
            { signal: controller.signal },
          );
          all.push(...page.events);
          after = page.nextAfter;
          if (!page.hasMore) break;
        }
        const resources = customer
          ? { materials: [] }
          : await api<{ materials: Material[] }>(path + "/materials", {
              signal: controller.signal,
            });
        if (!alive) return;
        setMeeting(detail.meeting);
        setEntries(all);
        setMaterials(resources.materials);
        setLoading(false);
        stream = new EventSource(
          "/api/v1" +
            path +
            "/stream?after=" +
            detail.cursor +
            (customer ? "&audience=customer" : ""),
        );
        stream.addEventListener("change", (event) => {
          if (alive) change(JSON.parse((event as MessageEvent).data));
        });
        stream.addEventListener("ready", (event) => {
          const data = JSON.parse((event as MessageEvent).data);
          if (data.reload) {
            refresh();
            return;
          }
          if (alive) setConnection("已同步");
        });
        stream.addEventListener("assistant-error", (event) => {
          if (alive) setError(JSON.parse((event as MessageEvent).data).message);
        });
        stream.onerror = () => {
          if (alive) setConnection("连接中断，正在重连");
          void api("/auth/me").catch((error) => {
            if (
              alive &&
              error instanceof RequestError &&
              error.status === 401
            ) {
              stream?.close();
              setConnection("需要重新登录");
              setError(
                "登录已到期，请刷新页面重新登录；已保存的记录不会丢失。",
              );
            }
          });
        };
      } catch (e) {
        if (alive && !controller.signal.aborted) {
          setError(e instanceof Error ? e.message : "无法恢复会议");
          setLoading(false);
          setConnection("同步失败");
        }
      }
    })();
    return () => {
      alive = false;
      controller.abort();
      stream?.close();
    };
  }, [id, customer, reload, refresh]);
  return {
    meeting,
    entries,
    materials,
    connection,
    error,
    loading,
    refresh,
    setMeeting,
    setError,
  };
}
