"""Verify native screenshots and build a local, offline review gallery."""
import hashlib
import html
import json
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

root = Path(sys.argv[1] if len(sys.argv) > 1 else "output/playwright/desktop-android-2026-11-15")
font = ImageFont.truetype("C:/Windows/Fonts/msyh.ttc", 16)
results = []
for platform in ("desktop", "android"):
    directory = root / platform
    manifest = json.loads((directory / "manifest.json").read_text(encoding="utf-8-sig"))
    pages = manifest["pages"]
    if platform == "android":
        pages = sorted(pages, key=lambda p: p["id"])
    assert len({p["id"] for p in pages}) == len(pages), "Duplicate screenshot IDs"
    width, height = (360, 270) if platform == "desktop" else (280, 550)
    columns = 4
    sheet = Image.new("RGB", (width * columns, height * ((len(pages) + columns - 1) // columns)), "#e5e5e5")
    draw = ImageDraw.Draw(sheet)
    protected = [p["id"] for p in manifest.get("protectedPages", [])]
    articles = []
    for index, page in enumerate(pages):
        path = Path(page["path"])
        assert hashlib.sha256(path.read_bytes()).hexdigest() == page["sha256"], str(path)
        with Image.open(path) as source:
            source.verify()
        picture = Image.open(path).convert("RGB")
        if platform == "android":
            assert picture.size == (page["width"], page["height"]), str(path)
        if page.get("protectedSurface"):
            protected.append(page["id"])
        picture.thumbnail((width - 12, height - 64))
        x, y = (index % columns) * width + 6, (index // columns) * height + 6
        draw.text((x, y), page["id"][:34], font=font, fill="#111111")
        draw.text((x, y + 23), page["label"][:17], font=font, fill="#333333")
        sheet.paste(picture, (x, y + 49))
        note = '<p class=note>' + html.escape(page.get("note", "")) + '</p>' if page.get("note") else ''
        articles.append('<article id="' + html.escape(page["id"], quote=True) + '"><h2>' + html.escape(page["label"]) + '</h2><p>' + html.escape(page["id"]) + '</p>' + note + '<a href="' + html.escape(page["id"] + '.png', quote=True) + '"><img loading=lazy src="' + html.escape(page["id"] + '.png', quote=True) + '" alt="' + html.escape(page["label"], quote=True) + '"></a></article>')
    for page in manifest.get("protectedPages", []):
        articles.append('<article><h2>' + html.escape(page["label"]) + '</h2><p class=note>' + html.escape(page["reason"]) + '</p><p>未生成占位图，未绕过系统截屏保护。</p><a href="' + html.escape(page["id"] + '.capture.txt', quote=True) + '">截屏限制记录</a> · <a href="' + html.escape(page["id"] + '.xml', quote=True) + '">原生页面结构</a></article>')
    sheet.save(directory / "overview.jpg", quality=90)
    style = 'body{font:16px system-ui;background:#eee;margin:24px}main{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:20px}article{background:white;padding:16px;min-width:0}img{width:100%;height:auto}.note{color:#8b3100}'
    (directory / "index.html").write_text('<!doctype html><meta charset=utf-8><title>Kooyu ' + platform + ' QA</title><style>' + style + '</style><h1>Kooyu ' + platform + ' 截图</h1><p>' + html.escape(manifest["result"]) + ' · ' + str(len(pages)) + ' PNG · SHA-256 校验全部匹配</p><p><a href="../index.html">返回总索引</a> · <a href="overview.jpg">截图总览</a> · <a href="manifest.json">验收记录</a></p><main>' + ''.join(articles) + '</main>', encoding="utf-8")
    results.append({"platform": platform, "result": manifest["result"], "screenshots": len(pages), "hashesVerified": len(pages), "protectedSurfaces": protected})
links = ''.join('<li><a href="' + r["platform"] + '/index.html">' + r["platform"] + ' — ' + str(r["screenshots"]) + ' 张</a> · ' + r["result"] + '</li>' for r in results)
(root / "index.html").write_text('<!doctype html><meta charset=utf-8><title>Kooyu 双端验收</title><style>body{font:18px system-ui;max-width:960px;margin:48px auto;padding:24px;line-height:1.7}</style><h1>Kooyu 桌面端与 Android 验收</h1><p>2026-11-15 · 真实 Electron / BlueStacks Android 13 · 隔离演示数据</p><ul>' + links + '</ul><p>Android 扫码器设置 FLAG_SECURE，保护画面可能显示为黑色；未绕过截屏保护，也不将其计作像素验收。</p>', encoding="utf-8")
(root / "screenshot-verification.json").write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")
import subprocess
subprocess.run(["node", "scripts/build-art-canvas.mjs"], check=True)
print(json.dumps(results, ensure_ascii=False))
