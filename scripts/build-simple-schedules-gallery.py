"""Build an offline gallery and verify all scheduling QA screenshots."""
import hashlib
import html
import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

root = Path("output/playwright/simple-schedules-2026-11-16")
labels = {
    "desktop": ["时间与频率编辑", "一次执行：日期和时间", "每周多天", "每月日期", "间隔与执行预览", "保存后保持暂停", "深色主题", "390px 窄屏", "对话创建审批明细", "手机审批后桌面收到结果", "桌面读取手机修改", "日期选择与默认不限额"],
    "android": ["定时任务列表", "原生编辑器", "原生时间选择器", "频率选项", "原生日期选择器", "固定间隔设置", "手机审批任务明细", "手机审批后创建成功", "每隔两小时", "预览执行时间", "手机保存成功", "手机暂停成功", "添加设备置顶", "托管上限默认 0", "截止日期选择器", "截止时间选择器"],
}
style = "body{font:16px system-ui;background:#f4f4f6;margin:24px;color:#19191c}main{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:20px}article{background:white;padding:16px;min-width:0}img{width:100%;height:auto}p{line-height:1.6}"
font = ImageFont.truetype("C:/Windows/Fonts/msyh.ttc", 16)
apk = root / "kooyu-schedule-debug.apk"
results = []
for platform, names in labels.items():
    folder = root / platform
    files = sorted(folder.glob("*.png"))
    assert len(files) == len(names), (platform, len(files), len(names))
    width, height = (380, 330) if platform == "desktop" else (280, 570)
    sheet = Image.new("RGB", (width * 4, height * ((len(files) + 3) // 4)), "#e8e8e8")
    draw = ImageDraw.Draw(sheet)
    pages, articles = [], []
    captures = {}
    if platform == "android":
        for record in folder.glob("*-manifest.json"):
            for page in json.loads(record.read_text(encoding="utf-8")).get("pages", []):
                captures[(page["id"], page["sha256"])] = page
    for i, (file, label) in enumerate(zip(files, names)):
        with Image.open(file) as source:
            source.verify()
        picture = Image.open(file).convert("RGB")
        pages.append({"id": file.stem, "label": label, "path": str(file.resolve()), "width": picture.width, "height": picture.height, "sha256": hashlib.sha256(file.read_bytes()).hexdigest()})
        if platform == "android":
            capture = captures.get((file.stem, pages[-1]["sha256"]))
            assert capture, f"No matching capture metadata: {file}"
            pages[-1]["apkSha256"] = capture["apkSha256"]
            pages[-1]["capturedAt"] = capture["capturedAt"]
        picture.thumbnail((width - 12, height - 64))
        x, y = i % 4 * width + 6, i // 4 * height + 6
        draw.text((x, y), file.stem[:32], font=font, fill="#19191c")
        draw.text((x, y + 23), label, font=font, fill="#444444")
        sheet.paste(picture, (x, y + 49))
        articles.append(f'<article><h2>{html.escape(label)}</h2><a href="{file.name}"><img loading="lazy" src="{file.name}" alt="{html.escape(label)}"></a></article>')
    sheet.save(folder / "overview.jpg", quality=92)
    manifest = {"result": "passed", "platform": platform, "fixture": True, "modelInference": False, "pages": pages}
    if platform == "android":
        manifest["apkSha256"] = hashlib.sha256(apk.read_bytes()).hexdigest()
        manifest["apkPath"] = str(apk.resolve())
        manifest["captureApkSha256s"] = sorted({page["apkSha256"] for page in pages})
    (folder / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    (folder / "index.html").write_text(f'<!doctype html><meta charset="utf-8"><title>Kooyu 定时任务 {platform}</title><style>{style}</style><h1>Kooyu 定时任务 · {platform}</h1><p>2026-11-16 · 隔离测试，未调用真实模型。{len(pages)} 张 PNG 已验证。</p><p><a href="../index.html">返回索引</a> · <a href="overview.jpg">截图总览</a> · <a href="manifest.json">截图清单与 SHA-256</a></p><main>{"".join(articles)}</main>', encoding="utf-8")
    results.append({"platform": platform, "screenshots": len(pages), "hashesVerified": len(pages)})
links = "".join(f'<li><a href="{r["platform"]}/index.html">{r["platform"]} · {r["screenshots"]} 张</a></li>' for r in results)
(root / "index.html").write_text(f'<!doctype html><meta charset="utf-8"><title>Kooyu 定时任务验收</title><style>{style}</style><h1>Kooyu 定时任务简化验收</h1><p>2026-11-16 · Chromium 桌面界面 / BlueStacks Android 原生客户端。所有演示任务最后保持暂停。</p><p>通过合成适配器验证工具与审批链路，未调用真实模型。桌面未重新验证 Electron 壳层；iOS 仅检查源文件语法。</p><ul>{links}</ul>', encoding="utf-8")
(root / "screenshot-verification.json").write_text(json.dumps(results, indent=2), encoding="utf-8")
print(json.dumps(results))
