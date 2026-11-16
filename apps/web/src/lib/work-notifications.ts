import { useEffect, useRef } from "react";
import type { NotificationItem, NotificationPage, NotificationDelivery } from "@kodo/protocol";
import { api, hostPath } from "./host-client";
/** Foreground delivery confirmation is tied to the exact visible conversation. */
export function useWorkNotifications(
  sessionId: string | null,
  onOpen: (sessionId: string) => void,
) {
  const current = useRef(sessionId),
    open = useRef(onOpen);
  current.current = sessionId;
  open.current = onOpen;
  useEffect(() => {
    let stopped = false,
      busy = false,
      cursor = 0;
    const visible = () => document.visibilityState === "visible";
    const query = new URLSearchParams(location.search);
    let linkedNotification = query.get("notificationId");
    const poll = async () => {
      if (busy || stopped) return;
      busy = true;
      try {
        if (linkedNotification) {
          try {
            const id = linkedNotification;
            const item = await api<NotificationItem>("/notifications/" + encodeURIComponent(id));
            if (stopped) return;
            if (item.link.hostId === query.get("hostId") && item.sessionId) {
              open.current(item.sessionId);
              await api("/notifications/" + encodeURIComponent(id) + "/read", "POST", {});
              const url = new URL(location.href);
              url.searchParams.delete("notificationId");
              url.searchParams.delete("hostId");
              history.replaceState(null, "", url);
            }
            linkedNotification = null;
          } catch {
            /* An expired deep link must not block current notifications. */
          }
        }
        const page = await api<NotificationPage>("/notifications?after=" + cursor + "&limit=100");
        if (stopped) return;
        cursor = page.cursor;
        for (const item of page.items)
          if (visible() && item.sessionId && item.sessionId === current.current)
            await api("/notifications/" + encodeURIComponent(item.id) + "/ack", "POST", {
              sessionId: current.current,
            });
        if (!("Notification" in window) || Notification.permission !== "granted") return;
        const pending = await api<NotificationDelivery[]>("/notification-deliveries");
        for (const delivery of pending) {
          if (stopped) break;
          const item = await api<NotificationItem>(
            "/notifications/" + encodeURIComponent(delivery.notificationId),
          );
          if (visible() && item.sessionId === current.current) {
            await api("/notifications/" + encodeURIComponent(item.id) + "/ack", "POST", {
              sessionId: current.current,
            });
            continue;
          }
          const notification = new Notification(item.title, {
            body: "请打开 Kooyu 查看",
            tag: "kooyu:" + hostPath + ":" + item.id,
          });
          notification.onclick = () => {
            window.focus();
            if (item.sessionId) open.current(item.sessionId);
            notification.close();
            void api("/notifications/" + encodeURIComponent(item.id) + "/read", "POST", {}).catch(
              () => {},
            );
          };
          await api("/notification-deliveries/accept", "POST", { id: delivery.id });
        }
      } catch {
        /* Reconnection re-reads durable facts; no request is auto-resubmitted. */
      } finally {
        busy = false;
      }
    };
    void poll();
    const timer = setInterval(() => void poll(), 5000);
    document.addEventListener("visibilitychange", poll);
    return () => {
      stopped = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", poll);
    };
  }, []);
}
