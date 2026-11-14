export interface NativeLaunch {
  command: string;
  args: string[];
  env?: Record<string, string>;
  source?: "sdk" | "cli" | "desktop-bundled" | "configured";
  unavailableReason?: string;
}

export interface DesktopInstallation {
  name: string;
  path: string;
  version: string | null;
}
