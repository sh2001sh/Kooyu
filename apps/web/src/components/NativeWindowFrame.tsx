import type { ReactNode } from "react";
import { remoteClient } from "../lib/host-client";
import { KooyuBrandMark } from "./KooyuBrand";
import "../styles/window-chrome.css";

const nativeWindows = /Electron\//.test(navigator.userAgent) && /Windows/.test(navigator.userAgent);
if (nativeWindows) document.documentElement.dataset.platform = "win32";

/** Native caption controls occupy their own row on every screen, including onboarding. */
export function NativeWindowFrame({ children }: { children: ReactNode }) {
  return (
    <>
      {nativeWindows && (
        <div className="native-windowbar" aria-hidden="true">
          <KooyuBrandMark size={14} className="native-windowbar__mark" />
          <span className="native-windowbar__title">
            {remoteClient ? "Kooyu · 远程设备" : "Kooyu"}
          </span>
        </div>
      )}
      {children}
    </>
  );
}
