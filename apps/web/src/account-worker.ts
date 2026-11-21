import { browserFetch } from "./lib/cloud-browser";
type FetchEvent = Event & { request: Request; respondWith: (response: Promise<Response>) => void };
self.addEventListener("fetch", (event) => {
  const e = event as FetchEvent,
    url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return;
  const id = /^\/(?:h\/([a-f0-9]{64})\/api(?:\/|$)|v2\/mailbox\/([a-f0-9]{64})$)/.exec(
    url.pathname,
  );
  if (id)
    e.respondWith(
      browserFetch(e.request, id[1] ?? id[2]!).catch(() =>
        Response.json(
          {
            error: {
              code: "DEVICE_APPROVAL_REQUIRED",
              message: "设备授权暂时不可用，请检查网络或重新配对。",
            },
          },
          { status: 403 },
        ),
      ),
    );
});
