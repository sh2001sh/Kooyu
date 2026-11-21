import { app, BrowserWindow, clipboard, dialog, nativeTheme, safeStorage, session } from "electron";
import { readFileSync, writeFileSync, renameSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicKey, randomUUID, type KeyObject } from "node:crypto";
import { desktopChannel, desktopInvitation, verifyDesktopHost } from "./secure-channel.js";
import { sealMailboxMessage } from "@kodo/protocol/mailbox";

import { DesktopAccount, type DeviceCredential } from "./account-device.js";
const appIconPath = fileURLToPath(new URL("../assets/app.png", import.meta.url));

type RemoteConnection = {
  base: string;
  credential: DeviceCredential;
  host: string;
  key: string;
  token: string;
  expiresAt: string;
  mailbox?: { deviceId: string; encryptionKey: string; privateKey: string };
};

function connectionFile() {
  return join(app.getPath("userData"), "paired-desktop.bin");
}

function trackRenewal(account: DesktopAccount) {
  if (!protectedStorage()) return;
  account.persistRenewal = (updated) => {
    const path = connectionFile();
    const current: RemoteConnection = JSON.parse(safeStorage.decryptString(readFileSync(path)));
    if (current.credential.key !== updated.key) return;
    current.credential = updated;
    const temp = path + "." + randomUUID();
    writeFileSync(temp, safeStorage.encryptString(JSON.stringify(current)), { mode: 0o600 });
    renameSync(temp, path);
  };
}

function protectedStorage() {
  return (
    safeStorage.isEncryptionAvailable() &&
    (process.platform !== "linux" || safeStorage.getSelectedStorageBackend() !== "basic_text")
  );
}

export async function forgetPairedDesktop() {
  const path = connectionFile();
  const load = (): RemoteConnection => JSON.parse(safeStorage.decryptString(readFileSync(path)));
  const current = load();
  await new DesktopAccount(new URL(current.base), current.credential).logout();
  if (load().credential.key === current.credential.key) unlinkSync(path);
}

export async function reopenPairedDesktop(localHost: string) {
  if (!protectedStorage()) throw new Error("系统凭据库不可用，请重新登录 Kooyu 账号连接远程电脑。");
  let connection: RemoteConnection;
  try {
    connection = JSON.parse(safeStorage.decryptString(readFileSync(connectionFile())));
  } catch {
    throw new Error("尚未连接过远程电脑，请先在菜单中「登录 Kooyu 账号连接我的电脑」。");
  }
  if (!(Date.parse(connection.expiresAt) > Date.now()))
    throw new Error("设备授权已过期，请重新配对。");
  const key = createPublicKey({
    key: Buffer.from(connection.key, "base64"),
    format: "der",
    type: "spki",
  });
  const base = new URL(connection.base);
  if (!connection.credential) throw Error("请使用已绑定账号的电脑重新配对。");
  const account = new DesktopAccount(base, connection.credential);
  trackRenewal(account);
  const response = await desktopChannel(
    base,
    key,
    {
      method: "GET",
      path: "/api/health",
      token: connection.token,
    },
    undefined,
    await account.headers(new URL("api/secure/channel", base), "POST"),
  );
  await response.body?.cancel();
  if (!response.ok) throw new Error("无法重新连接设备，请检查设备状态和配对授权。");
  await openRemoteWindow(
    localHost,
    base,
    connection.host,
    key,
    connection.token,
    account,
    connection.mailbox,
  );
}

/** Only the main process sees the pairing secret and device bearer. */
export async function openPairedDesktop(localHost: string, invitationText = clipboard.readText()) {
  const { base, host, code, invitation } = desktopInvitation(invitationText);
  const confirm = await dialog.showMessageBox({
    type: "question",
    message: "连接远程 Kooyu 设备？",
    detail: base.origin + "\n" + host,
    buttons: ["连接", "取消"],
    cancelId: 1,
    defaultId: 0,
  });
  if (confirm.response !== 0) return;
  const account = await DesktopAccount.start(base, invitation);
  const peer = await verifyDesktopHost(
    base,
    host,
    await account.headers(new URL("api/secure/key", base), "GET"),
  );
  const signing = (await crypto.subtle.generateKey("Ed25519", true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
  const mailboxVerifyPubKey = Buffer.from(
    await crypto.subtle.exportKey("spki", signing.publicKey),
  ).toString("base64");
  const paired = await desktopChannel(
    base,
    peer,
    {
      method: "POST",
      path: "/api/pair/native",
      body: Buffer.from(
        JSON.stringify({ code, name: "Kooyu Desktop", mailboxVerifyPubKey }),
      ).toString("base64"),
      contentType: "application/json",
    },
    undefined,
    await account.headers(new URL("api/secure/channel", base), "POST"),
  );
  if (paired.status !== 201) throw new Error("配对失败，请在远程设备上重新生成邀请。");
  const { token, device, mailboxEncryptionKey } = await paired.json();
  if (typeof token !== "string" || !token) throw new Error("配对响应缺少设备凭据。");
  await account.finish();
  const mailbox = mailboxEncryptionKey
    ? {
        deviceId: device.id,
        encryptionKey: mailboxEncryptionKey,
        privateKey: Buffer.from(
          await crypto.subtle.exportKey("pkcs8", signing.privateKey),
        ).toString("base64"),
      }
    : undefined;
  if (protectedStorage()) {
    const value: RemoteConnection = {
      base: base.href,
      credential: account.credential,
      host,
      token,
      mailbox,
      expiresAt: device.expiresAt,
      key: peer.export({ type: "spki", format: "der" }).toString("base64"),
    };
    const file = connectionFile(),
      temporary = file + "." + randomUUID();
    writeFileSync(temporary, safeStorage.encryptString(JSON.stringify(value)), { mode: 0o600 });
    renameSync(temporary, file);
    trackRenewal(account);
  }
  await openRemoteWindow(localHost, base, host, peer, token, account, mailbox);
}

async function openRemoteWindow(
  localHost: string,
  base: URL,
  host: string,
  peer: KeyObject,
  token: string,
  account: DesktopAccount,
  mailbox?: RemoteConnection["mailbox"],
) {
  const partition = session.fromPartition("remote-" + randomUUID());
  const origin = "https://device.kooyu.invalid",
    prefix = "/h/" + host;
  const lifetime = new AbortController();
  const csp =
    "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";
  partition.protocol.handle("https", async (req) => {
    const url = new URL(req.url);
    if (url.origin !== origin) return new Response(null, { status: 403 });
    try {
      if (url.pathname === "/desktop/mailbox") {
        if (!mailbox) return new Response(null, { status: 404 });
        if (req.method === "GET") return new Response(null, { status: 204 });
        if (req.method !== "POST") return new Response(null, { status: 405 });
        const { sessionId, text } = await req.json();
        if (
          typeof sessionId !== "string" ||
          sessionId.length > 128 ||
          typeof text !== "string" ||
          !text.trim() ||
          text.length > 16000
        )
          return new Response(null, { status: 400 });
        const signingKey = await crypto.subtle.importKey(
          "pkcs8",
          Buffer.from(mailbox.privateKey, "base64"),
          "Ed25519",
          false,
          ["sign"],
        );
        return Response.json(
          await sealMailboxMessage(host, { ...mailbox, signingKey }, sessionId, text),
        );
      }
      if (url.pathname === "/v2/mailbox/" + host && req.method === "POST" && mailbox) {
        const body = await req.arrayBuffer();
        if (body.byteLength > 32768) return new Response(null, { status: 413 });
        const delivered = await fetch(new URL(url.pathname, base), {
          method: "POST",
          body,
          redirect: "error",
          signal: AbortSignal.any([lifetime.signal, req.signal, AbortSignal.timeout(15000)]),
          headers: {
            "content-type": "application/json",
            ...(await account.headers(new URL(url.pathname, base), "POST")),
          },
        });
        await delivered.body?.cancel();
        return new Response(null, { status: delivered.status });
      }
      if (url.pathname.startsWith(prefix + "/api/")) {
        const body = req.body && Buffer.from(await req.arrayBuffer());
        if (body && body.length > 540 * 1024)
          return Response.json({ error: { message: "请求超过加密分片上限。" } }, { status: 413 });
        const result = await desktopChannel(
          base,
          peer,
          {
            method: req.method,
            path: url.pathname.slice(prefix.length) + url.search,
            token,
            protocol: "2",
            ...(body
              ? {
                  body: body.toString("base64"),
                  contentType: req.headers.get("content-type")?.split(";")[0],
                }
              : {}),
          },
          AbortSignal.any([req.signal, lifetime.signal]),
          await account.headers(new URL("api/secure/channel", base), "POST"),
        );
        // A remote response may contain untrusted artifact bytes. Only bundled UI routes may execute scripts.
        result.headers.set("content-security-policy", "sandbox; default-src 'none'");
        result.headers.set("x-content-type-options", "nosniff");
        return result;
      }
      if (req.method !== "GET") return new Response(null, { status: 405 });
      const path = url.pathname === prefix + "/" ? "/" : url.pathname;
      if (path !== "/" && !/^\/(?:assets\/|art\/|icon\.svg$|manifest\.webmanifest$)/.test(path))
        return new Response(null, { status: 404 });
      const asset = await fetch(new URL(path, localHost), {
        redirect: "error",
        signal: lifetime.signal,
      });
      return new Response(asset.body, {
        status: asset.status,
        headers: {
          "content-type": asset.headers.get("content-type") ?? "application/octet-stream",
          "content-security-policy": csp,
          "x-content-type-options": "nosniff",
          "cache-control": "no-store",
        },
      });
    } catch {
      return Response.json(
        { error: { message: "远程设备连接中断，请核对操作结果。" } },
        { status: 502 },
      );
    }
  });
  partition.setPermissionRequestHandler((_wc, _permission, cb) => cb(false));
  const dark = nativeTheme.shouldUseDarkColors;
  const isHexDark = (hex: string): boolean => {
    const clean = hex.replace(/^#/, "");
    if (!/^[0-9a-fA-F]{6}$/.test(clean)) return nativeTheme.shouldUseDarkColors;
    const r = parseInt(clean.slice(0, 2), 16);
    const g = parseInt(clean.slice(2, 4), 16);
    const b = parseInt(clean.slice(4, 6), 16);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b < 128;
  };
  const win = new BrowserWindow({
    title: "Kooyu · 远程设备",
    icon: appIconPath,
    width: 1180,
    height: 820,
    minWidth: 760,
    minHeight: 580,
    backgroundColor: dark ? "#0b0c0e" : "#f5f5f7",
    titleBarStyle: "hidden",
    ...(process.platform === "darwin" ? { trafficLightPosition: { x: 14, y: 17 } } : {}),
    titleBarOverlay:
      process.platform === "win32"
        ? {
            color: "#00000000",
            symbolColor: dark ? "#a6aab3" : "#52555c",
            height: 38,
          }
        : undefined,
    webPreferences: {
      session: partition,
      sandbox: true,
      nodeIntegration: false,
      contextIsolation: true,
    },
  });
  if (process.platform !== "darwin") win.setMenuBarVisibility(false);
  const applyChrome = (isDark: boolean, bgHex?: string) => {
    if (win.isDestroyed()) return;
    try {
      win.setBackgroundColor(bgHex ?? (isDark ? "#0b0c0e" : "#f5f5f7"));
    } catch {}
    if (process.platform === "win32") {
      try {
        win.setTitleBarOverlay({
          color: "#00000000",
          symbolColor: isDark ? "#a6aab3" : "#52555c",
          height: 38,
        });
      } catch {}
    }
  };
  const onThemeUpdated = () => applyChrome(nativeTheme.shouldUseDarkColors);
  nativeTheme.on("updated", onThemeUpdated);
  win.webContents.on("did-change-theme-color", (_event, color) => {
    if (color) applyChrome(isHexDark(color), color);
  });
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (event, url) => {
    if (url !== origin + prefix + "/") event.preventDefault();
  });
  win.once("closed", () => {
    nativeTheme.off("updated", onThemeUpdated);
    lifetime.abort();
    partition.protocol.unhandle("https");
  });
  try {
    await win.loadURL(origin + prefix + "/");
  } catch (error) {
    win.destroy();
    throw error;
  }
}
