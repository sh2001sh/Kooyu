import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const pkg = JSON.parse(await readFile("package.json", "utf8"));
const version = pkg.version;
if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error("Expected a numeric release version.");
const android = await readFile("apps/android/app/build.gradle.kts", "utf8");
const ios = await readFile("apps/ios/project.yml", "utf8");
if (
  !android.includes('versionName = "' + version + '"') ||
  !ios.includes("MARKETING_VERSION: " + version)
)
  throw new Error("Desktop, Android and iOS release versions must agree.");

if (process.argv[2] === "metadata") {
  const stable = process.env.GITHUB_REF_TYPE === "tag";
  const tag = stable
    ? process.env.GITHUB_REF_NAME
    : `preview-${version}-${process.env.GITHUB_RUN_NUMBER}`;
  if (stable && tag !== `v${version}`) throw new Error("The release tag must match package.json.");
  if (!stable && !/^\d+$/.test(process.env.GITHUB_RUN_NUMBER ?? ""))
    throw new Error("Missing run number.");
  console.log(`tag=${tag}\nversion=${version}\nprerelease=${!stable}`);
} else if (process.argv[2] === "publish") {
  const dir = "release-assets";
  const assets = (await readdir(dir))
    .filter((name) => /\.(exe|dmg|zip|AppImage|deb|apk)$/.test(name))
    .sort();
  const required = [
    /\.exe$/,
    /arm64.*\.dmg$/,
    /(?<!arm64)\.dmg$/,
    /\.AppImage$/,
    /\.deb$/,
    /android-debug\.apk$/,
    /ios-simulator\.zip$/,
  ];
  for (const pattern of required)
    if (!assets.some((name) => pattern.test(name)))
      throw new Error(`Missing release artifact: ${pattern}`);
  const checksums = await Promise.all(
    assets.map(
      async (name) =>
        createHash("sha256")
          .update(await readFile(join(dir, name)))
          .digest("hex") +
        "  " +
        name,
    ),
  );
  await writeFile(join(dir, "SHA256SUMS.txt"), checksums.join("\n") + "\n");
  const prerelease = process.env.RELEASE_PRERELEASE === "true";
  const tag = process.env.RELEASE_TAG;
  if (!tag || !/^(v\d+\.\d+\.\d+|preview-\d+\.\d+\.\d+-\d+)$/.test(tag))
    throw new Error("Invalid release tag.");
  const repo = process.env.GITHUB_REPOSITORY;
  const sha = process.env.GITHUB_SHA;
  if (!repo || !sha) throw new Error("Missing repository or commit metadata.");
  const gh = (...args) =>
    execFileSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
  let changelogSection = "";
  if (!prerelease) {
    try {
      const changelog = (await readFile("CHANGELOG.md", "utf8")).replace(/\r\n/g, "\n");
      const found = changelog
        .split(/^## /m)
        .find((s) => s.startsWith(`v${version} `) || s.startsWith(`v${version}\n`));
      if (found) {
        const nl = found.indexOf("\n");
        if (nl >= 0) changelogSection = found.slice(nl + 1).trim();
      }
    } catch {}
  }
  const body = [
    `Kooyu ${version} — ${prerelease ? "自动构建预览版" : "正式版本"}`,
    "",
    `Source commit: ${sha}`,
    ...(changelogSection ? ["", changelogSection] : []),
    "",
    "### Downloads & Checksums / 安装包与校验",
    "",
    "- Windows: EXE 安装程序（x64）。",
    "- macOS: DMG / ZIP（Intel x64、Apple Silicon arm64）。",
    "- Linux: AppImage / DEB（x64）。",
    "- Android: 保持既有调试签名的 APK，可覆盖同签名版本。",
    "- iOS: 仅供 Apple Silicon Mac 的 iOS 模拟器运行，不能直接安装到 iPhone；真机 IPA 需要 Apple 签名。",
    "- npm CLI / Web Host: `npx kooyu@latest` 或 `npm install -g kooyu@latest`。",
    "- 桌面安装包暂未配置代码签名或 Apple 公证。",
    "",
    "下载后可使用 SHA256SUMS.txt 校验文件。",
  ].join("\n");
  const notes = join(process.env.RUNNER_TEMP ?? dir, "kooyu-release-notes.md");
  await writeFile(notes, body);
  let exists = false;
  try {
    gh("release", "view", tag, "--repo", repo, "--json", "tagName");
    exists = true;
  } catch (error) {
    if (error.status !== 1) throw error;
  }
  if (!exists)
    gh(
      "release",
      "create",
      tag,
      "--repo",
      repo,
      "--target",
      sha,
      "--title",
      `Kooyu ${version}${prerelease ? " · " + tag : ""}`,
      "--notes-file",
      notes,
      "--draft",
      ...(prerelease ? ["--prerelease"] : []),
    );
  gh(
    "release",
    "upload",
    tag,
    "--repo",
    repo,
    ...[...assets, "SHA256SUMS.txt"].map((name) => join(dir, name)),
    "--clobber",
  );
  gh(
    "release",
    "edit",
    tag,
    "--repo",
    repo,
    "--draft=false",
    ...(prerelease ? [] : ["--latest"]),
  );
  console.log(gh("release", "view", tag, "--repo", repo, "--json", "url", "--jq", ".url"));
} else throw new Error("Use metadata or publish.");
