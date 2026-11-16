import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";

const sdk = resolve(process.env.ANDROID_HOME ?? ".local/android-sdk");
const jdk =
  process.env.JAVA_HOME ??
  join(resolve(".local/native-tools/jdk"), readdirSync(".local/native-tools/jdk")[0]);
const buildTools = join(sdk, "build-tools", "36.0.0");
const androidJar = join(sdk, "platforms/android-36/android.jar");
const root = resolve(".local/verification/android-ui-probe");
const classes = join(root, "classes"),
  dex = join(root, "dex");
for (const path of [root, classes, dex]) mkdirSync(path, { recursive: true });
const run = (file, args) => execFileSync(file, args, { stdio: "inherit", windowsHide: true });
const java = join(jdk, "bin/java.exe");
run(join(jdk, "bin/javac.exe"), [
  "--release",
  "8",
  "-classpath",
  androidJar,
  "-d",
  classes,
  resolve("scripts/android-ui-probe/UiDumpInstrumentation.java"),
  resolve("scripts/android-ui-probe/VaultCheckInstrumentation.java"),
]);
run(java, [
  "-cp",
  join(buildTools, "lib/d8.jar"),
  "com.android.tools.r8.D8",
  "--lib",
  androidJar,
  "--min-api",
  "26",
  "--output",
  dex,
  join(classes, "app/kooyu/qaprobe/UiDumpInstrumentation.class"),
  join(classes, "app/kooyu/qaprobe/VaultCheckInstrumentation.class"),
]);
const unsigned = join(root, "probe-unsigned.apk"),
  aligned = join(root, "probe-aligned.apk"),
  apk = join(root, "probe.apk");
run(join(buildTools, "aapt2.exe"), [
  "link",
  "-o",
  unsigned,
  "--manifest",
  resolve("scripts/android-ui-probe/AndroidManifest.xml"),
  "-I",
  androidJar,
]);
run(join(jdk, "bin/jar.exe"), ["uf", unsigned, "-C", dex, "classes.dex"]);
run(join(buildTools, "zipalign.exe"), ["-f", "4", unsigned, aligned]);
const keystore = resolve(
  process.env.KOOYU_ANDROID_DEBUG_KEYSTORE ?? ".local/android-user/debug.keystore",
);
if (!existsSync(keystore))
  throw new Error("Build the Android debug app first to create a development keystore.");
run(java, [
  "-jar",
  join(buildTools, "lib/apksigner.jar"),
  "sign",
  "--ks",
  keystore,
  "--ks-pass",
  "pass:android",
  "--key-pass",
  "pass:android",
  "--out",
  apk,
  aligned,
]);
console.log(apk);
