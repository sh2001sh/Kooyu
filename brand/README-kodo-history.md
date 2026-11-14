# Kodo 品牌标识提案

## 当前交付：日落珊瑚品牌与产品设计

用户已确认 **A「灵动回环」造型 + 日落珊瑚配色**。正式可用的 SVG / PNG / 应用图标与 React 组件见 [标识素材](assets/README.md)；六张生图模型生成的产品定位、官网、桌面明暗主题、手机端与品牌应用图见 [产品设计概念](product-design/README.md)。

- [产品设计总览](product-design/overview.png)
- [标识素材包](kodo-brand-assets.zip)
- [产品设计图包](kodo-product-designs.zip)
- [正式 SVG 标志](assets/svg/kodo-mark.svg) / [横版组合](assets/svg/kodo-logo.svg)

以下为之前的探索记录；正式取用以上述素材目录为准。

## 字标修订

针对原英文字标偏粗、与丝带图形不够协调的问题，制作了三版 [字标对照](wordmark-studies/README.md)。当前 SVG、透明 PNG 与素材包已更新为推荐版 B「微倾流线」：Quicksand 590、光学字距、约 3.7° 轻微前倾。此为推荐修订，尚未收到用户对 B 的最终选择。标志图形与日落珊瑚配色保持原样。

六张生图产品概念图保留原字样，仍用于布局与视觉方向参考；后续软件和官网接入请使用最新 SVG。

## 当前方向：生图模型生成的莫比乌斯 K

造型方向为：用莫比乌斯带的回转、半扭转与连续曲面暗示 k，放松标准字形，以不对称的曲线和轻盈动势增加活泼感，同时保持简洁大方。源图最初采用钴蓝，后经配色探索选定日落珊瑚。生成模型为 `gpt-image-2`，接口与凭据读取自用户指定的 `image.txt`。

用户已选定 A「灵动回环」造型和日落珊瑚配色。历史对照图：[四种配色](mobius-k/colors/comparison.png)。原造型对照图：[灵动回环与自由笔势](mobius-k/playful-comparison.png)。

原始生成图与说明位于 [mobius-k](mobius-k/README.md)，标识提示词保存在 [prompts](prompts)。原图为 PNG，现已另外完成真正的贝塞尔路径 SVG，见 [正式标识素材](assets/README.md)。本轮提供设计图与可用素材，尚未接入产品界面。

## 第一轮：几何标识探索

下列三个几何方向保留作历史探索，不再作为当前推荐方向。三个方向均采用钴蓝、墨黑和暖白。

打开 [标识对照图](kodo-logo-proposals.png) 可同时查看大图、横版组合、反白、应用图标和 16 / 24 / 32 px 效果。

### A · 接续 K

以可识别的 K 为骨架。独立竖线代表稳定的工作位置，向内折返的线条表达不同工具的工作在同一位置接续。圆端与折角兼顾亲近感和工具的精确感。

这一方案的特点：符号与 Kodo 名称有直接关联；黑白版本保留相同轮廓；图标缩小后仍能辨认。

- 独立标志：[proposals/a/mark.svg](proposals/a/mark.svg)
- 横版组合：[proposals/a/logo.svg](proposals/a/logo.svg)
- 应用图标：[proposals/a/app.svg](proposals/a/app.svg)
- 其余单色版本与透明 PNG 在同目录。

## B · 会话相扣

两个独立的圆角窗口相连，表达多个原生会话进入同一工作台，仍保留各自的身份。更强调连接与工作空间；缩小时细节多于 A。

素材位于 [proposals/b](proposals/b)。

## C · 工作流

三条横向轨迹沿折线相连，表达多个任务之间的接续与推进。符号更抽象，有明显的横向节奏；与名称的关联弱于 A。

素材位于 [proposals/c](proposals/c)。

## 颜色与字标

| 角色 | 色值 |
| --- | --- |
| 主色 · 钴蓝 | `#3659E3` |
| 单色 · 墨黑 | `#20232D` |
| 画布 · 暖白 | `#F5F4F0` |
| 反白 | `#FFFFFF` |

字标采用小写 `kodo`，以 Manrope 750 字重和调整后的字距构建。交付 SVG 的文字已转为路径，不依赖接收方安装字体。字体及 SIL Open Font License 位于 [fonts](fonts)。

## 素材说明

- `proposals/a`、`proposals/b`、`proposals/c`：三个方案的彩色、墨黑、反白 SVG，以及透明标志 PNG 和图标 PNG。
- `logos`：推荐方案 A 的便捷取用副本，不代表已经确认最终方案。
- `icons`：A 的 16–1024 px PNG、SVG、ICO 与 ICNS 图标。
- `kodo-logo-proposals.png`：1800 × 1320 标识对照图。
- `design-tokens.json` / `design-tokens.css`：本轮标识配色。

独立标志四周至少保留标志画布宽度 1/6 的空间。A / C 最小展示为 16 px，B 建议至少 24 px；正式界面中的常用尺寸建议 24 px 以上。避免非等比缩放、添加阴影轮廓或用颜色区分会话运行状态。

第一轮几何标识为直接绘制的矢量图形。首次生图调用的 URL 返回格式不兼容已通过图片生成技能中的 URL 下载流程解决；最新一轮已实际生成并保存模型图片。

正式素材重建：`python scripts/build-coral-brand.py`（`build-brand.py` 入口也已转向正式版本）。概览与下载包重建：`python scripts/package-brand.py`。上述脚本只写入 `brand/`，不修改应用源码。
