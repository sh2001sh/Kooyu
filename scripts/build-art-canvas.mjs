import fs from "node:fs";
import path from "node:path";

const root = path.resolve("output/playwright/desktop-android-2026-11-15");
const androidManifest = JSON.parse(
  fs.readFileSync(path.join(root, "android/manifest.json"), "utf8"),
);
const desktopManifest = JSON.parse(
  fs.readFileSync(path.join(root, "desktop/manifest.json"), "utf8"),
);

// Classify Android pages
function classifyAndroid(id) {
  if (id.startsWith("01-") || id.startsWith("02-")) return "PAIRING";
  if (id.startsWith("03-") || id.startsWith("04-") || id.startsWith("29-")) return "SESSIONS";
  if (id.startsWith("14-")) return "CONVERSATION";
  if (
    id.startsWith("15-") ||
    id.startsWith("16-") ||
    id.startsWith("17-") ||
    id.startsWith("18-") ||
    id.startsWith("19-") ||
    id.startsWith("20-") ||
    id.startsWith("21-")
  )
    return "INSPECTOR";
  if (
    id.startsWith("05-") ||
    id.startsWith("06-") ||
    id.startsWith("22-") ||
    id.startsWith("23-") ||
    id.startsWith("24-") ||
    id.startsWith("25-")
  )
    return "PROJECTS";
  if (id.startsWith("26-") || id.startsWith("27-") || id.startsWith("28-") || id.startsWith("30-"))
    return "ACTIONS";
  return "SYSTEM";
}

function classifyDesktop(id) {
  if (id.startsWith("01-") || id.startsWith("02-") || id.startsWith("03-")) return "ONBOARDING";
  if (
    id.startsWith("04-") ||
    id.startsWith("05-") ||
    id.startsWith("06-") ||
    id.includes("conversation")
  )
    return "WORKBENCH";
  if (id.startsWith("inspector")) return "INSPECTOR";
  if (id.startsWith("settings") || id.startsWith("engine")) return "SETTINGS";
  return "WORK_CENTER";
}

const androidPages = androidManifest.pages.map((p) => ({
  id: p.id,
  label: p.label,
  file: p.id + ".png",
  width: p.width || 1080,
  height: p.height || 1920,
  sha: (p.sha256 || "").slice(0, 8).toUpperCase(),
  cat: classifyAndroid(p.id),
}));

const desktopPages = desktopManifest.pages.map((p) => ({
  id: p.id,
  label: p.label,
  file: p.id + ".png",
  width: 1440,
  height: 900,
  sha: (p.sha256 || "").slice(0, 8).toUpperCase(),
  cat: classifyDesktop(p.id),
}));

function renderPage(mode = "root") {
  // mode: 'root' (in output/playwright/desktop-android-2026-11-15/index.html)
  // mode: 'android' (in android/index.html)
  // mode: 'desktop' (in desktop/index.html)

  const androidPrefix = mode === "android" ? "" : mode === "desktop" ? "../android/" : "android/";
  const desktopPrefix = mode === "desktop" ? "" : mode === "android" ? "../desktop/" : "desktop/";
  const initialPlatform = mode === "desktop" ? "desktop" : "android";

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
<title>KOOYU // ARCHITECTURAL CANVAS</title>
<style>
@import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;700&family=Space+Grotesk:wght@500;700;800;900&display=swap');

:root {
  --bg: #050608;
  --surface: #0a0d14;
  --surface-card: rgba(14, 18, 28, 0.72);
  --border: rgba(255, 255, 255, 0.08);
  --border-bright: rgba(255, 255, 255, 0.22);
  --accent: #00f59b;
  --accent-rgb: 0, 245, 155;
  --accent-purple: #7928ca;
  --accent-coral: #ff4757;
  --text-main: #f3f4f6;
  --text-dim: #717684;
  --mono: 'JetBrains Mono', monospace;
  --sans: 'Space Grotesk', system-ui, sans-serif;
  --ease: cubic-bezier(0.16, 1, 0.3, 1);
}

* { box-sizing: border-box; margin: 0; padding: 0; }

body {
  background: var(--bg);
  color: var(--text-main);
  font-family: var(--sans);
  overflow-x: hidden;
  min-height: 100vh;
  position: relative;
  user-select: none;
  -webkit-font-smoothing: antialiased;
}

/* Background Shader Canvas */
#bg-canvas {
  position: fixed;
  inset: 0;
  width: 100vw;
  height: 100vh;
  z-index: 0;
  pointer-events: none;
  opacity: 0.85;
}

/* Subtle Grid Texture */
.grid-overlay {
  position: fixed;
  inset: 0;
  background-image:
    linear-gradient(rgba(255,255,255,0.02) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255,255,255,0.02) 1px, transparent 1px);
  background-size: 40px 40px;
  pointer-events: none;
  z-index: 1;
}

/* Scanline / Grain Overlay */
.vignette {
  position: fixed;
  inset: 0;
  background: radial-gradient(circle at 50% 50%, transparent 40%, rgba(5,6,8,0.85) 100%);
  pointer-events: none;
  z-index: 2;
}

/* App Shell */
.app-container {
  position: relative;
  z-index: 10;
  display: flex;
  flex-direction: column;
  min-height: 100vh;
}

/* Header */
header {
  position: sticky;
  top: 0;
  height: 64px;
  border-bottom: 1px solid var(--border);
  background: rgba(5, 6, 8, 0.82);
  backdrop-filter: blur(20px);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 24px;
  z-index: 100;
}

.brand-row {
  display: flex;
  align-items: center;
  gap: 16px;
}

.brand-mark {
  font-weight: 900;
  font-size: 19px;
  letter-spacing: -0.04em;
  display: flex;
  align-items: center;
  gap: 8px;
}

.brand-mark .monogram {
  width: 26px;
  height: 26px;
  background: var(--text-main);
  color: var(--bg);
  border-radius: 6px;
  display: grid;
  place-items: center;
  font-size: 13px;
  font-weight: 900;
}

.brand-tag {
  font-family: var(--mono);
  font-size: 11px;
  padding: 3px 8px;
  border: 1px solid var(--border);
  border-radius: 4px;
  color: var(--accent);
  background: rgba(var(--accent-rgb), 0.08);
  letter-spacing: 0.06em;
}

.platform-switch {
  display: flex;
  background: rgba(255, 255, 255, 0.04);
  padding: 3px;
  border-radius: 8px;
  border: 1px solid var(--border);
}

.platform-btn {
  background: transparent;
  border: none;
  color: var(--text-dim);
  font-family: var(--mono);
  font-size: 12px;
  font-weight: 700;
  padding: 6px 14px;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.25s var(--ease);
  display: flex;
  align-items: center;
  gap: 6px;
}

.platform-btn.active {
  background: var(--text-main);
  color: var(--bg);
  box-shadow: 0 0 16px rgba(255,255,255,0.2);
}

.header-controls {
  display: flex;
  align-items: center;
  gap: 10px;
}

.btn-ctrl {
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid var(--border);
  color: var(--text-main);
  font-family: var(--mono);
  font-size: 11px;
  font-weight: 700;
  height: 32px;
  padding: 0 12px;
  border-radius: 6px;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 6px;
  transition: all 0.2s var(--ease);
}

.btn-ctrl:hover {
  background: rgba(255, 255, 255, 0.08);
  border-color: var(--border-bright);
}

.btn-ctrl.active {
  border-color: var(--accent);
  color: var(--accent);
  background: rgba(var(--accent-rgb), 0.1);
}

/* Sound wave icon */
.sound-bars {
  display: flex;
  align-items: center;
  gap: 2px;
  height: 12px;
}
.sound-bars span {
  width: 2px;
  height: 100%;
  background: currentColor;
  border-radius: 1px;
}
.sound-active .sound-bars span:nth-child(1) { animation: wave 0.6s infinite ease-in-out; }
.sound-active .sound-bars span:nth-child(2) { animation: wave 0.8s infinite ease-in-out 0.1s; }
.sound-active .sound-bars span:nth-child(3) { animation: wave 0.5s infinite ease-in-out 0.2s; }
@keyframes wave { 0%, 100% { transform: scaleY(0.3); } 50% { transform: scaleY(1); } }

/* Kinetic Marquee Ribbon */
.marquee-ribbon {
  border-bottom: 1px solid var(--border);
  background: rgba(10, 13, 20, 0.6);
  padding: 8px 0;
  overflow: hidden;
  white-space: nowrap;
  font-family: var(--mono);
  font-size: 11px;
  letter-spacing: 0.12em;
  color: var(--text-dim);
  display: flex;
}

.marquee-content {
  display: inline-flex;
  gap: 32px;
  animation: marquee 24s linear infinite;
}

@keyframes marquee { 0% { transform: translateX(0); } 100% { transform: translateX(-50%); } }

.marquee-item {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}
.marquee-item b { color: var(--text-main); font-weight: 700; }
.dot-live { width: 6px; height: 6px; border-radius: 50%; background: var(--accent); box-shadow: 0 0 8px var(--accent); }

/* Main Stage */
main {
  flex: 1;
  display: flex;
  flex-direction: column;
}

/* Canvas Mode Switcher */
.stage-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 24px;
  border-bottom: 1px solid var(--border);
}

.categories-track {
  display: flex;
  gap: 6px;
  overflow-x: auto;
  scrollbar-width: none;
}
.categories-track::-webkit-scrollbar { display: none; }

.chip-cat {
  background: transparent;
  border: 1px solid var(--border);
  color: var(--text-dim);
  font-family: var(--mono);
  font-size: 11px;
  font-weight: 700;
  padding: 5px 12px;
  border-radius: 20px;
  cursor: pointer;
  transition: all 0.2s var(--ease);
  white-space: nowrap;
}
.chip-cat:hover {
  border-color: var(--border-bright);
  color: var(--text-main);
}
.chip-cat.active {
  background: rgba(255, 255, 255, 0.1);
  border-color: var(--text-main);
  color: var(--text-main);
}

.view-mode-toggle {
  display: flex;
  gap: 6px;
}

/* HERO EXPERIMENTAL SECTION */
.hero-stage {
  padding: 32px 24px;
  display: flex;
  flex-direction: column;
  align-items: center;
  position: relative;
  min-height: 720px;
  justify-content: center;
}

/* 3D Spatial Canvas Stage */
.viewport-3d-scene {
  perspective: 1600px;
  perspective-origin: 50% 50%;
  width: 100%;
  max-width: 900px;
  height: 640px;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
}

.device-rig {
  position: relative;
  width: 320px;
  height: 600px;
  transform-style: preserve-3d;
  transition: transform 0.8s cubic-bezier(0.16, 1, 0.3, 1);
  cursor: grab;
}

.device-rig.is-dragging { cursor: grabbing; transition: none; }

/* 3D Exploded Spatial State */
.device-rig.spatial-active {
  transform: rotateX(46deg) rotateY(-20deg) rotateZ(-12deg);
}

/* Mobile Frame */
.phone-chassis {
  position: absolute;
  inset: 0;
  border-radius: 46px;
  background: #11141c;
  box-shadow:
    0 30px 90px rgba(0,0,0,0.85),
    0 0 0 1px rgba(255,255,255,0.14),
    inset 0 0 0 2px rgba(255,255,255,0.06);
  overflow: hidden;
  transform-style: preserve-3d;
}

/* Dynamic Island */
.phone-island {
  position: absolute;
  top: 14px;
  left: 50%;
  transform: translateX(-50%);
  width: 96px;
  height: 24px;
  background: #000;
  border-radius: 12px;
  z-index: 50;
  box-shadow: 0 0 0 1px rgba(255,255,255,0.08);
}

/* Phone Screen Surface */
.phone-screen {
  position: absolute;
  inset: 6px;
  border-radius: 40px;
  background: #000;
  overflow: hidden;
}

.phone-screen img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

/* SPATIAL 3D FLOATING LAYERS */
.spatial-layer {
  position: absolute;
  inset: 0;
  pointer-events: none;
  opacity: 0;
  transform: translateZ(0);
  transition: all 0.8s var(--ease);
  display: flex;
  flex-direction: column;
}

.spatial-active .spatial-layer {
  opacity: 1;
  pointer-events: auto;
}

/* L01: Base System Substrate */
.spatial-active .layer-l01 {
  transform: translateZ(0px);
}

/* L02: Detached Bottom Nav Shell (Visualizes resolution of hierarchy!) */
.spatial-active .layer-l02 {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 72px;
  transform: translateZ(45px) translateY(70px);
  background: rgba(18, 22, 34, 0.94);
  border: 2px dashed rgba(var(--accent-rgb), 0.7);
  border-radius: 20px;
  box-shadow: 0 15px 40px rgba(0,0,0,0.7), 0 0 24px rgba(var(--accent-rgb), 0.2);
  display: flex;
  align-items: center;
  justify-content: space-around;
  padding: 0 16px;
}

/* L03: Conversation Stage */
.spatial-active .layer-l03 {
  position: absolute;
  top: 56px;
  bottom: 80px;
  left: 0;
  right: 0;
  transform: translateZ(90px);
  border: 2px solid var(--accent);
  background: rgba(10, 14, 22, 0.88);
  border-radius: 16px;
  box-shadow: 0 20px 50px rgba(0,0,0,0.8), 0 0 35px rgba(var(--accent-rgb), 0.35);
  backdrop-filter: blur(12px);
  overflow: hidden;
}

/* L04: Elevated App Bar */
.spatial-active .layer-l04 {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 52px;
  transform: translateZ(140px);
  background: rgba(22, 28, 42, 0.96);
  border: 2px solid #3b82f6;
  border-radius: 16px;
  box-shadow: 0 15px 35px rgba(0,0,0,0.8), 0 0 25px rgba(59, 130, 246, 0.3);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 16px;
}

/* L05: Input Composer Deck */
.spatial-active .layer-l05 {
  position: absolute;
  bottom: 12px;
  left: 8px;
  right: 8px;
  height: 60px;
  transform: translateZ(185px);
  background: rgba(26, 32, 48, 0.96);
  border: 2px solid #a855f7;
  border-radius: 16px;
  box-shadow: 0 20px 45px rgba(0,0,0,0.8), 0 0 25px rgba(168, 85, 247, 0.35);
  display: flex;
  align-items: center;
  padding: 0 16px;
}

/* Layer Callout Badges */
.layer-badge {
  font-family: var(--mono);
  font-size: 10px;
  font-weight: 700;
  padding: 3px 8px;
  border-radius: 4px;
  letter-spacing: 0.08em;
  white-space: nowrap;
}
.badge-l02 { background: rgba(var(--accent-rgb), 0.2); color: var(--accent); border: 1px solid var(--accent); }
.badge-l03 { background: rgba(var(--accent-rgb), 0.2); color: var(--accent); border: 1px solid var(--accent); }
.badge-l04 { background: rgba(59, 130, 246, 0.2); color: #60a5fa; border: 1px solid #3b82f6; }
.badge-l05 { background: rgba(168, 85, 247, 0.2); color: #c084fc; border: 1px solid #a855f7; }

/* Desktop Frame */
.desktop-chassis {
  position: absolute;
  width: 820px;
  height: 520px;
  border-radius: 12px;
  background: #11141c;
  border: 1px solid rgba(255,255,255,0.12);
  box-shadow: 0 40px 120px rgba(0,0,0,0.85);
  display: none;
  flex-direction: column;
  overflow: hidden;
}

.desktop-titlebar {
  height: 34px;
  background: #181d28;
  border-bottom: 1px solid var(--border);
  display: flex;
  align-items: center;
  padding: 0 14px;
  gap: 12px;
}

.traffic-dots { display: flex; gap: 6px; }
.traffic-dots span { width: 10px; height: 10px; border-radius: 50%; }
.traffic-dots span:nth-child(1) { background: #ff5f56; }
.traffic-dots span:nth-child(2) { background: #ffbd2e; }
.traffic-dots span:nth-child(3) { background: #27c93f; }

.desktop-url {
  font-family: var(--mono);
  font-size: 11px;
  color: var(--text-dim);
  background: rgba(0,0,0,0.25);
  padding: 2px 14px;
  border-radius: 4px;
  border: 1px solid var(--border);
}

.desktop-screen {
  flex: 1;
  background: #000;
  overflow: hidden;
  position: relative;
}

.desktop-screen img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  display: block;
}

/* Stage Interactive Nav Step Pills */
.stage-hierarchy-nav {
  display: flex;
  gap: 8px;
  margin-top: 24px;
  flex-wrap: wrap;
  justify-content: center;
  z-index: 20;
}

.step-pill {
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid var(--border);
  color: var(--text-dim);
  font-family: var(--mono);
  font-size: 11px;
  font-weight: 700;
  padding: 6px 14px;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s var(--ease);
  display: flex;
  align-items: center;
  gap: 8px;
}
.step-pill:hover {
  border-color: var(--border-bright);
  color: var(--text-main);
  transform: translateY(-1px);
}
.step-pill.active {
  border-color: var(--accent);
  color: var(--text-main);
  background: rgba(var(--accent-rgb), 0.12);
  box-shadow: 0 0 16px rgba(var(--accent-rgb), 0.2);
}

/* Current Frame Metadata HUD */
.stage-meta-hud {
  display: flex;
  gap: 20px;
  margin-top: 14px;
  font-family: var(--mono);
  font-size: 11px;
  color: var(--text-dim);
  letter-spacing: 0.06em;
}
.meta-tag b { color: var(--text-main); font-weight: 700; }

/* MATRIX LIGHTTABLE GRID */
.matrix-section {
  padding: 32px 24px;
  border-top: 1px solid var(--border);
}

.matrix-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 24px;
}

.matrix-title {
  font-size: 20px;
  font-weight: 800;
  letter-spacing: -0.02em;
  display: flex;
  align-items: center;
  gap: 12px;
}

.matrix-count {
  font-family: var(--mono);
  font-size: 12px;
  color: var(--accent);
}

.matrix-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 20px;
}

.matrix-grid.desktop-mode {
  grid-template-columns: repeat(auto-fill, minmax(360px, 1fr));
}

.matrix-card {
  background: var(--surface-card);
  border: 1px solid var(--border);
  border-radius: 12px;
  overflow: hidden;
  transition: all 0.3s var(--ease);
  cursor: pointer;
  position: relative;
  display: flex;
  flex-direction: column;
}

.matrix-card:hover {
  border-color: var(--border-bright);
  transform: translateY(-4px);
  box-shadow: 0 20px 40px rgba(0,0,0,0.6);
}

.matrix-card.active-card {
  border-color: var(--accent);
  box-shadow: 0 0 24px rgba(var(--accent-rgb), 0.25);
}

.card-preview {
  position: relative;
  width: 100%;
  aspect-ratio: 9 / 16;
  background: #000;
  overflow: hidden;
}

.matrix-grid.desktop-mode .card-preview {
  aspect-ratio: 16 / 10;
}

.card-preview img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  display: block;
}

.card-info {
  padding: 12px 14px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-top: 1px solid var(--border);
  background: rgba(10, 13, 20, 0.9);
}

.card-name {
  font-family: var(--mono);
  font-size: 12px;
  font-weight: 700;
  color: var(--text-main);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.card-badge {
  font-family: var(--mono);
  font-size: 10px;
  color: var(--text-dim);
  border: 1px solid var(--border);
  padding: 2px 6px;
  border-radius: 4px;
}

/* OPTICAL LOUPE (MAGNIFIER) */
#optical-loupe {
  position: fixed;
  width: 170px;
  height: 170px;
  border-radius: 50%;
  border: 2px solid var(--accent);
  box-shadow: 0 0 30px rgba(0,0,0,0.8), 0 0 15px rgba(var(--accent-rgb), 0.4);
  pointer-events: none;
  z-index: 999;
  overflow: hidden;
  display: none;
  background-repeat: no-repeat;
  background-color: #000;
  transform: translate(-50%, -50%);
}

#optical-loupe::after {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: 50%;
  box-shadow: inset 0 0 20px rgba(0,0,0,0.7);
}

/* FULLSCREEN CINEMATIC LIGHTBOX */
.lightbox-modal {
  position: fixed;
  inset: 0;
  background: rgba(5, 6, 8, 0.95);
  backdrop-filter: blur(24px);
  z-index: 1000;
  display: none;
  align-items: center;
  justify-content: center;
  flex-direction: column;
}

.lightbox-modal.open { display: flex; }

.lightbox-topbar {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 60px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 24px;
  border-bottom: 1px solid var(--border);
}

.lightbox-title {
  font-family: var(--mono);
  font-size: 14px;
  font-weight: 700;
}

.lightbox-actions {
  display: flex;
  gap: 12px;
}

.lightbox-canvas {
  max-width: 90vw;
  max-height: 80vh;
  display: flex;
  align-items: center;
  justify-content: center;
}

.lightbox-canvas img {
  max-width: 100%;
  max-height: 80vh;
  object-fit: contain;
  box-shadow: 0 30px 100px rgba(0,0,0,0.9);
  border-radius: 8px;
  border: 1px solid var(--border);
}

.lightbox-nav-btn {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  background: rgba(255,255,255,0.06);
  border: 1px solid var(--border);
  color: var(--text-main);
  width: 48px;
  height: 48px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  cursor: pointer;
  font-size: 18px;
  font-family: var(--mono);
  transition: all 0.2s var(--ease);
}
.lightbox-nav-btn:hover {
  background: rgba(255,255,255,0.15);
  border-color: var(--text-main);
}
.lightbox-prev { left: 24px; }
.lightbox-next { right: 24px; }

/* Telemetry Footer */
footer {
  border-top: 1px solid var(--border);
  background: rgba(5, 6, 8, 0.9);
  padding: 16px 24px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-family: var(--mono);
  font-size: 11px;
  color: var(--text-dim);
  z-index: 50;
}

.telemetry-row {
  display: flex;
  gap: 20px;
}

.telemetry-item b {
  color: var(--text-main);
}

@media (max-width: 768px) {
  header { padding: 0 16px; }
  .viewport-3d-scene { height: 480px; }
  .device-rig { width: 240px; height: 450px; }
  .desktop-chassis { width: 92vw; height: 320px; }
  .matrix-grid { grid-template-columns: 1fr 1fr; gap: 12px; }
  .matrix-grid.desktop-mode { grid-template-columns: 1fr; }
  footer { flex-direction: column; gap: 10px; align-items: flex-start; }
}
</style>
</head>
<body>

<canvas id="bg-canvas"></canvas>
<div class="grid-overlay"></div>
<div class="vignette"></div>

<div class="app-container">
  <!-- Header -->
  <header>
    <div class="brand-row">
      <div class="brand-mark">
        <div class="monogram">K</div>
        <span>KOOYU</span>
      </div>
      <div class="brand-tag">SPATIAL // HIERARCHY</div>
    </div>

    <!-- Platform Universe Switch -->
    <div class="platform-switch">
      <button class="platform-btn ${initialPlatform === "android" ? "active" : ""}" id="btn-platform-android">
        <span>ANDROID</span>
        <span class="count">[38]</span>
      </button>
      <button class="platform-btn ${initialPlatform === "desktop" ? "active" : ""}" id="btn-platform-desktop">
        <span>DESKTOP</span>
        <span class="count">[93]</span>
      </button>
    </div>

    <div class="header-controls">
      <button class="btn-ctrl" id="btn-toggle-3d">
        <span>SPATIAL 3D</span>
      </button>
      <button class="btn-ctrl" id="btn-sound-toggle">
        <div class="sound-bars"><span></span><span></span><span></span></div>
        <span>SOUND</span>
      </button>
    </div>
  </header>

  <!-- Kinetic Marquee Ribbon -->
  <div class="marquee-ribbon">
    <div class="marquee-content">
      <span class="marquee-item"><span class="dot-live"></span><b>DUAL ARCHITECTURE</b></span>
      <span class="marquee-item">ANDROID // 38 VERIFIED</span>
      <span class="marquee-item">DESKTOP // 93 CAPTURES</span>
      <span class="marquee-item"><b>SPATIAL DISSECTION</b></span>
      <span class="marquee-item">DETACHED NAV SHELL // ELEVATED STAGE</span>
      <span class="marquee-item">ZERO BOTTOM-BAR COLLISION</span>
      <span class="marquee-item">INDEPENDENT BACK ROUTE</span>
      <span class="marquee-item"><b>KOOYU WORKBENCH</b></span>
      <span class="marquee-item"><span class="dot-live"></span><b>DUAL ARCHITECTURE</b></span>
      <span class="marquee-item">ANDROID // 38 VERIFIED</span>
      <span class="marquee-item">DESKTOP // 93 CAPTURES</span>
      <span class="marquee-item"><b>SPATIAL DISSECTION</b></span>
      <span class="marquee-item">DETACHED NAV SHELL // ELEVATED STAGE</span>
      <span class="marquee-item">ZERO BOTTOM-BAR COLLISION</span>
      <span class="marquee-item">INDEPENDENT BACK ROUTE</span>
    </div>
  </div>

  <main>
    <!-- Stage Toolbar -->
    <div class="stage-toolbar">
      <div class="categories-track" id="category-track">
        <!-- Rendered via JS -->
      </div>
      <div class="view-mode-toggle">
        <button class="btn-ctrl active" id="btn-view-stage">STAGE</button>
        <button class="btn-ctrl" id="btn-view-matrix">MATRIX</button>
      </div>
    </div>

    <!-- HERO SPATIAL STAGE -->
    <section class="hero-stage" id="hero-stage">
      <div class="viewport-3d-scene">
        <!-- Mobile Chassis -->
        <div class="device-rig" id="mobile-rig">
          <div class="phone-chassis">
            <div class="phone-island"></div>
            <div class="phone-screen">
              <img id="mobile-screen-img" src="${androidPrefix}14-conversation.png" alt="14-conversation">
            </div>

            <!-- 3D Spatial Decomposition Layers -->
            <div class="spatial-layer layer-l01"></div>

            <div class="spatial-layer layer-l02">
              <span class="layer-badge badge-l02">L02 // DETACHED NAV SHELL</span>
            </div>

            <div class="spatial-layer layer-l03">
              <span class="layer-badge badge-l03" style="position: absolute; top: 12px; left: 12px;">L03 // ELEVATED CONVERSATION STAGE</span>
            </div>

            <div class="spatial-layer layer-l04">
              <span class="layer-badge badge-l04">L04 // ELEVATED APP BAR</span>
              <span class="layer-badge badge-l04">BACK NAV</span>
            </div>

            <div class="spatial-layer layer-l05">
              <span class="layer-badge badge-l05">L05 // FLOATING COMPOSER DECK</span>
            </div>
          </div>
        </div>

        <!-- Desktop Chassis -->
        <div class="desktop-chassis" id="desktop-rig">
          <div class="desktop-titlebar">
            <div class="traffic-dots"><span></span><span></span><span></span></div>
            <div class="desktop-url">KOOYU // DESKTOP RUNTIME</div>
          </div>
          <div class="desktop-screen">
            <img id="desktop-screen-img" src="${desktopPrefix}conversation-main.png" alt="conversation-main">
          </div>
        </div>
      </div>

      <!-- Mobile Hierarchy Step Simulator -->
      <div class="stage-hierarchy-nav" id="hierarchy-nav">
        <!-- Injected via JS -->
      </div>

      <!-- Live Metadata HUD -->
      <div class="stage-meta-hud" id="stage-meta-hud">
        <span class="meta-tag">ID: <b id="meta-id">14-conversation</b></span>
        <span class="meta-tag">RES: <b id="meta-res">1080×1920</b></span>
        <span class="meta-tag">SHA: <b id="meta-sha">4E5ACB85</b></span>
        <span class="meta-tag">INDEX: <b id="meta-index">14 / 38</b></span>
      </div>
    </section>

    <!-- MATRIX LIGHTTABLE GRID -->
    <section class="matrix-section" id="matrix-section">
      <div class="matrix-header">
        <div class="matrix-title">
          <span>CATALOG MATRIX</span>
          <span class="matrix-count" id="matrix-counter">[38 FRAMES]</span>
        </div>
      </div>

      <div class="matrix-grid" id="matrix-grid">
        <!-- Rendered via JS -->
      </div>
    </section>
  </main>

  <!-- Footer Telemetry -->
  <footer>
    <div class="telemetry-row">
      <span class="telemetry-item">CURSOR: <b id="telemetry-cursor">[0000, 0000]</b></span>
      <span class="telemetry-item">FPS: <b>60</b></span>
      <span class="telemetry-item">STATUS: <b style="color: var(--accent);">PASSED</b></span>
    </div>
    <div class="telemetry-row">
      <span class="telemetry-item">ENGINE: <b>WEBGL / COMPOSITE</b></span>
      <span class="telemetry-item">BUILD: <b>2026.11.15</b></span>
    </div>
  </footer>
</div>

<!-- Optical Loupe -->
<div id="optical-loupe"></div>

<!-- Lightbox Modal -->
<div class="lightbox-modal" id="lightbox-modal">
  <div class="lightbox-topbar">
    <div class="lightbox-title" id="lightbox-title">FRAME // 14-CONVERSATION</div>
    <div class="lightbox-actions">
      <button class="btn-ctrl" id="lightbox-close">CLOSE</button>
    </div>
  </div>
  <button class="lightbox-nav-btn lightbox-prev" id="lightbox-prev">&#x2190;</button>
  <button class="lightbox-nav-btn lightbox-next" id="lightbox-next">&#x2192;</button>
  <div class="lightbox-canvas">
    <img id="lightbox-img" src="" alt="">
  </div>
</div>

<script>
const DATA = {
  android: ${JSON.stringify(androidPages)},
  desktop: ${JSON.stringify(desktopPages)}
};

const PATHS = {
  android: '${androidPrefix}',
  desktop: '${desktopPrefix}'
};

// State
let currentPlatform = '${initialPlatform}';
let currentCategory = 'ALL';
let currentFrameIndex = currentPlatform === 'android' ? 13 : 84; // 14-conversation or conversation-main
let is3DActive = false;
let isSoundActive = false;
let rotX = 46;
let rotY = -20;
let isDragging = false;
let startMouseX = 0;
let startMouseY = 0;

// Web Audio API Sound Generator
class SoundFX {
  constructor() {
    this.ctx = null;
  }
  init() {
    if (!this.ctx) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AudioContext();
    }
  }
  tick() {
    if (!isSoundActive || !this.ctx) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(1400, this.ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(320, this.ctx.currentTime + 0.035);
    gain.gain.setValueAtTime(0.06, this.ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.001, this.ctx.currentTime + 0.035);
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start();
    osc.stop(this.ctx.currentTime + 0.035);
  }
  thud() {
    if (!isSoundActive || !this.ctx) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(160, this.ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(45, this.ctx.currentTime + 0.12);
    gain.gain.setValueAtTime(0.12, this.ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.001, this.ctx.currentTime + 0.12);
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start();
    osc.stop(this.ctx.currentTime + 0.12);
  }
  layer() {
    if (!isSoundActive || !this.ctx) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(480, this.ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(880, this.ctx.currentTime + 0.07);
    gain.gain.setValueAtTime(0.05, this.ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.001, this.ctx.currentTime + 0.07);
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start();
    osc.stop(this.ctx.currentTime + 0.07);
  }
}
const sfx = new SoundFX();

// Interactive Fluid/Quantum Aura Canvas
const canvas = document.getElementById('bg-canvas');
const ctx = canvas.getContext('2d');
let width, height;
let particles = [];
let mouse = { x: window.innerWidth / 2, y: window.innerHeight / 2, vx: 0, vy: 0 };
let lastMouse = { x: mouse.x, y: mouse.y };

function resizeCanvas() {
  width = canvas.width = window.innerWidth;
  height = canvas.height = window.innerHeight;
  particles = [];
  const count = Math.min(Math.floor((width * height) / 18000), 75);
  for (let i = 0; i < count; i++) {
    particles.push({
      x: Math.random() * width,
      y: Math.random() * height,
      vx: (Math.random() - 0.5) * 0.4,
      vy: (Math.random() - 0.5) * 0.4,
      size: Math.random() * 2 + 1,
      baseAlpha: Math.random() * 0.4 + 0.1
    });
  }
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

window.addEventListener('mousemove', (e) => {
  mouse.vx = e.clientX - lastMouse.x;
  mouse.vy = e.clientY - lastMouse.y;
  mouse.x = e.clientX;
  mouse.y = e.clientY;
  lastMouse.x = e.clientX;
  lastMouse.y = e.clientY;
  document.getElementById('telemetry-cursor').textContent =
    '[' + String(e.clientX).padStart(4, '0') + ', ' + String(e.clientY).padStart(4, '0') + ']';
});

function drawBackground() {
  ctx.clearRect(0, 0, width, height);

  // Radial interactive cursor glow
  const gradient = ctx.createRadialGradient(mouse.x, mouse.y, 10, mouse.x, mouse.y, 500);
  gradient.addColorStop(0, 'rgba(0, 245, 155, 0.08)');
  gradient.addColorStop(0.5, 'rgba(121, 40, 202, 0.03)');
  gradient.addColorStop(1, 'transparent');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  // Particles
  for (let i = 0; i < particles.length; i++) {
    const p = particles[i];
    p.x += p.vx;
    p.y += p.vy;
    if (p.x < 0) p.x = width;
    if (p.x > width) p.x = 0;
    if (p.y < 0) p.y = height;
    if (p.y > height) p.y = 0;

    const dx = mouse.x - p.x;
    const dy = mouse.y - p.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < 180) {
      const force = (180 - dist) / 180;
      p.x -= (dx / dist) * force * 1.5;
      p.y -= (dy / dist) * force * 1.5;
    }

    ctx.fillStyle = 'rgba(255, 255, 255, ' + p.baseAlpha + ')';
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
    ctx.fill();
  }

  requestAnimationFrame(drawBackground);
}
requestAnimationFrame(drawBackground);

// DOM Elements
const mobileRig = document.getElementById('mobile-rig');
const desktopRig = document.getElementById('desktop-rig');
const mobileScreenImg = document.getElementById('mobile-screen-img');
const desktopScreenImg = document.getElementById('desktop-screen-img');
const btnPlatformAndroid = document.getElementById('btn-platform-android');
const btnPlatformDesktop = document.getElementById('btn-platform-desktop');
const btnToggle3D = document.getElementById('btn-toggle-3d');
const btnSoundToggle = document.getElementById('btn-sound-toggle');
const categoryTrack = document.getElementById('category-track');
const hierarchyNav = document.getElementById('hierarchy-nav');
const matrixGrid = document.getElementById('matrix-grid');
const matrixCounter = document.getElementById('matrix-counter');
const opticalLoupe = document.getElementById('optical-loupe');

// Sound Toggle
btnSoundToggle.addEventListener('click', () => {
  sfx.init();
  isSoundActive = !isSoundActive;
  btnSoundToggle.classList.toggle('sound-active', isSoundActive);
  btnSoundToggle.classList.toggle('active', isSoundActive);
  if (isSoundActive) sfx.thud();
});

// 3D Toggle
btnToggle3D.addEventListener('click', () => {
  sfx.init();
  is3DActive = !is3DActive;
  btnToggle3D.classList.toggle('active', is3DActive);
  mobileRig.classList.toggle('spatial-active', is3DActive);
  if (is3DActive) {
    rotX = 46;
    rotY = -20;
    mobileRig.style.transform = 'rotateX(' + rotX + 'deg) rotateY(' + rotY + 'deg) rotateZ(-12deg)';
    sfx.layer();
  } else {
    mobileRig.style.transform = 'none';
    sfx.tick();
  }
});

// Dragging 3D Device Rig
mobileRig.addEventListener('mousedown', (e) => {
  if (!is3DActive) return;
  isDragging = true;
  startMouseX = e.clientX;
  startMouseY = e.clientY;
  mobileRig.classList.add('is-dragging');
});

window.addEventListener('mousemove', (e) => {
  if (!isDragging || !is3DActive) return;
  const dx = e.clientX - startMouseX;
  const dy = e.clientY - startMouseY;
  rotY += dx * 0.4;
  rotX -= dy * 0.4;
  rotX = Math.max(10, Math.min(80, rotX));
  startMouseX = e.clientX;
  startMouseY = e.clientY;
  mobileRig.style.transform = 'rotateX(' + rotX + 'deg) rotateY(' + rotY + 'deg) rotateZ(-12deg)';
});

window.addEventListener('mouseup', () => {
  if (isDragging) {
    isDragging = false;
    mobileRig.classList.remove('is-dragging');
  }
});

// Platform Switching
function setPlatform(platform) {
  sfx.thud();
  currentPlatform = platform;
  btnPlatformAndroid.classList.toggle('active', platform === 'android');
  btnPlatformDesktop.classList.toggle('active', platform === 'desktop');

  if (platform === 'android') {
    mobileRig.style.display = 'block';
    desktopRig.style.display = 'none';
    btnToggle3D.style.display = 'flex';
    hierarchyNav.style.display = 'flex';
    matrixGrid.classList.remove('desktop-mode');
    currentFrameIndex = 13; // 14-conversation
  } else {
    mobileRig.style.display = 'none';
    desktopRig.style.display = 'flex';
    btnToggle3D.style.display = 'none';
    hierarchyNav.style.display = 'none';
    matrixGrid.classList.add('desktop-mode');
    currentFrameIndex = 84; // conversation-main
  }

  currentCategory = 'ALL';
  renderCategories();
  renderHierarchySteps();
  renderMatrixGrid();
  updateStageFrame(currentFrameIndex);
}

btnPlatformAndroid.addEventListener('click', () => setPlatform('android'));
btnPlatformDesktop.addEventListener('click', () => setPlatform('desktop'));

// Categories Track
function renderCategories() {
  const pages = DATA[currentPlatform];
  const cats = ['ALL', ...new Set(pages.map(p => p.cat))];
  categoryTrack.innerHTML = '';
  cats.forEach(cat => {
    const chip = document.createElement('button');
    chip.className = 'chip-cat' + (cat === currentCategory ? ' active' : '');
    chip.textContent = cat;
    chip.addEventListener('click', () => {
      sfx.tick();
      currentCategory = cat;
      renderCategories();
      renderMatrixGrid();
    });
    categoryTrack.appendChild(chip);
  });
}

// Mobile Hierarchy Step Navigator
// Specifically solves the hierarchy & bottom bar transition critique!
const ANDROID_HIERARCHY_STEPS = [
  { id: '03-sessions', label: '03 // ROOT SESSIONS', note: 'SHELL' },
  { id: '14-conversation', label: '14 // CONVERSATION ELEVATED', note: 'DETACHED NAV' },
  { id: '15-session-usage', label: '15 // USAGE OVERLAY', note: 'MODAL' },
  { id: '16-session-settings', label: '16 // CONFIG SHEET', note: 'SHEET' },
  { id: '19-workspace-files', label: '19 // WORKSPACE DECK', note: 'FILES' },
  { id: '26-conversation-menu', label: '26 // ACTION MODAL', note: 'MENU' }
];

function renderHierarchySteps() {
  hierarchyNav.innerHTML = '';
  if (currentPlatform !== 'android') return;
  ANDROID_HIERARCHY_STEPS.forEach(step => {
    const pill = document.createElement('button');
    const pageIndex = DATA.android.findIndex(p => p.id === step.id);
    const isActive = pageIndex === currentFrameIndex;
    pill.className = 'step-pill' + (isActive ? ' active' : '');
    pill.innerHTML = '<span>' + step.label + '</span>';
    pill.addEventListener('click', () => {
      sfx.layer();
      if (pageIndex !== -1) {
        updateStageFrame(pageIndex);
        renderHierarchySteps();
      }
    });
    hierarchyNav.appendChild(pill);
  });
}

// Update Stage Frame
function updateStageFrame(index) {
  const pages = DATA[currentPlatform];
  if (index < 0 || index >= pages.length) return;
  currentFrameIndex = index;
  const page = pages[index];
  const prefix = PATHS[currentPlatform];

  if (currentPlatform === 'android') {
    mobileScreenImg.src = prefix + page.file;
    mobileScreenImg.alt = page.id;
  } else {
    desktopScreenImg.src = prefix + page.file;
    desktopScreenImg.alt = page.id;
  }

  document.getElementById('meta-id').textContent = page.id;
  document.getElementById('meta-res').textContent = page.width + '×' + page.height;
  document.getElementById('meta-sha').textContent = page.sha;
  document.getElementById('meta-index').textContent = (index + 1) + ' / ' + pages.length;

  // Sync active card in grid
  document.querySelectorAll('.matrix-card').forEach((card, i) => {
    card.classList.toggle('active-card', card.dataset.id === page.id);
  });

  renderHierarchySteps();
}

// Matrix Lighttable Grid
function renderMatrixGrid() {
  const pages = DATA[currentPlatform];
  const filtered = currentCategory === 'ALL' ? pages : pages.filter(p => p.cat === currentCategory);
  matrixCounter.textContent = '[' + filtered.length + ' FRAMES]';
  matrixGrid.innerHTML = '';

  const prefix = PATHS[currentPlatform];

  filtered.forEach(page => {
    const card = document.createElement('div');
    card.className = 'matrix-card' + (page.id === pages[currentFrameIndex].id ? ' active-card' : '');
    card.dataset.id = page.id;

    card.innerHTML =
      '<div class="card-preview">' +
        '<img loading="lazy" src="' + prefix + page.file + '" alt="' + page.id + '">' +
      '</div>' +
      '<div class="card-info">' +
        '<div class="card-name">' + page.id + '</div>' +
        '<div class="card-badge">' + page.cat + '</div>' +
      '</div>';

    // Click updates stage & opens lightbox on double click
    card.addEventListener('click', () => {
      sfx.tick();
      const idx = pages.findIndex(p => p.id === page.id);
      updateStageFrame(idx);
      // Smooth scroll to hero stage if needed
      document.getElementById('hero-stage').scrollIntoView({ behavior: 'smooth' });
    });

    // Optical Loupe Magnifier on Hover
    const preview = card.querySelector('.card-preview');
    preview.addEventListener('mouseenter', () => {
      opticalLoupe.style.display = 'block';
      opticalLoupe.style.backgroundImage = 'url(' + prefix + page.file + ')';
      opticalLoupe.style.backgroundSize = (page.width * 0.45) + 'px auto';
    });

    preview.addEventListener('mousemove', (e) => {
      const rect = preview.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      opticalLoupe.style.left = e.clientX + 'px';
      opticalLoupe.style.top = e.clientY + 'px';
      const bgX = (x / rect.width) * 100;
      const bgY = (y / rect.height) * 100;
      opticalLoupe.style.backgroundPosition = bgX + '% ' + bgY + '%';
    });

    preview.addEventListener('mouseleave', () => {
      opticalLoupe.style.display = 'none';
    });

    matrixGrid.appendChild(card);
  });
}

// Lightbox Modal
const lightboxModal = document.getElementById('lightbox-modal');
const lightboxImg = document.getElementById('lightbox-img');
const lightboxTitle = document.getElementById('lightbox-title');
const lightboxClose = document.getElementById('lightbox-close');
const lightboxPrev = document.getElementById('lightbox-prev');
const lightboxNext = document.getElementById('lightbox-next');

function openLightbox(index) {
  sfx.layer();
  const pages = DATA[currentPlatform];
  currentFrameIndex = index;
  const page = pages[currentFrameIndex];
  const prefix = PATHS[currentPlatform];
  lightboxImg.src = prefix + page.file;
  lightboxTitle.textContent = 'FRAME // ' + page.id.toUpperCase();
  lightboxModal.classList.add('open');
}

function closeLightbox() {
  sfx.tick();
  lightboxModal.classList.remove('open');
}

lightboxClose.addEventListener('click', closeLightbox);
lightboxPrev.addEventListener('click', () => {
  sfx.tick();
  const pages = DATA[currentPlatform];
  currentFrameIndex = (currentFrameIndex - 1 + pages.length) % pages.length;
  openLightbox(currentFrameIndex);
  updateStageFrame(currentFrameIndex);
});
lightboxNext.addEventListener('click', () => {
  sfx.tick();
  const pages = DATA[currentPlatform];
  currentFrameIndex = (currentFrameIndex + 1) % pages.length;
  openLightbox(currentFrameIndex);
  updateStageFrame(currentFrameIndex);
});

// View Mode Toggles
document.getElementById('btn-view-stage').addEventListener('click', () => {
  sfx.tick();
  document.getElementById('btn-view-stage').classList.add('active');
  document.getElementById('btn-view-matrix').classList.remove('active');
  document.getElementById('hero-stage').scrollIntoView({ behavior: 'smooth' });
});
document.getElementById('btn-view-matrix').addEventListener('click', () => {
  sfx.tick();
  document.getElementById('btn-view-matrix').classList.add('active');
  document.getElementById('btn-view-stage').classList.remove('active');
  document.getElementById('matrix-section').scrollIntoView({ behavior: 'smooth' });
});

// Keyboard Navigation
window.addEventListener('keydown', (e) => {
  const pages = DATA[currentPlatform];
  if (e.key === 'ArrowRight') {
    sfx.tick();
    currentFrameIndex = (currentFrameIndex + 1) % pages.length;
    updateStageFrame(currentFrameIndex);
    if (lightboxModal.classList.contains('open')) openLightbox(currentFrameIndex);
  } else if (e.key === 'ArrowLeft') {
    sfx.tick();
    currentFrameIndex = (currentFrameIndex - 1 + pages.length) % pages.length;
    updateStageFrame(currentFrameIndex);
    if (lightboxModal.classList.contains('open')) openLightbox(currentFrameIndex);
  } else if (e.key === 'Escape') {
    closeLightbox();
  }
});

// Initialize
setPlatform(currentPlatform);
</script>
</body>
</html>`;
}

// Generate files
const rootHtml = renderPage("root");
fs.writeFileSync(path.join(root, "index.html"), rootHtml, "utf8");

const androidHtml = renderPage("android");
fs.writeFileSync(path.join(root, "android/index.html"), androidHtml, "utf8");

const desktopHtml = renderPage("desktop");
fs.writeFileSync(path.join(root, "desktop/index.html"), desktopHtml, "utf8");

console.log("Artifacts successfully generated!");
