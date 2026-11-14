# Kooyu · 日落珊瑚标识素材

已确认的品牌方向：A「灵动回环」造型，日落珊瑚配色。此目录为软件和官网接入时的正式素材入口。`brand/logos` 与 `brand/icons` 中提供相同素材的便捷取用副本。

## 常用文件

| 场景 | 素材 |
| --- | --- |
| 独立彩色标志 | [svg/kooyu-mark.svg](svg/kooyu-mark.svg) |
| 浅色背景横版组合 | [svg/kooyu-logo.svg](svg/kooyu-logo.svg) |
| 深色背景横版组合 | [svg/kooyu-logo-dark.svg](svg/kooyu-logo-dark.svg) |
| 单色墨黑 / 反白 | [svg/kooyu-mark-ink.svg](svg/kooyu-mark-ink.svg) / [svg/kooyu-mark-white.svg](svg/kooyu-mark-white.svg) |
| 单色珊瑚 | [svg/kooyu-mark-coral.svg](svg/kooyu-mark-coral.svg) |
| 随文字颜色变化的内联图形 | [svg/kooyu-mark-currentcolor.svg](svg/kooyu-mark-currentcolor.svg) |
| 独立字标 | [svg/kooyu-wordmark.svg](svg/kooyu-wordmark.svg) |
| React 组件 | [components/KooyuMark.tsx](components/KooyuMark.tsx) |
| 继承文字颜色的字标组件 | [components/KooyuWordmark.tsx](components/KooyuWordmark.tsx) |
| 应用图标 SVG | [icons/kooyu-app.svg](icons/kooyu-app.svg) |
| Windows 图标 | [icons/kooyu-app.ico](icons/kooyu-app.ico) |
| macOS 图标 | [icons/kooyu-app.icns](icons/kooyu-app.icns) |
| PWA 清单示例 | [icons/site.webmanifest](icons/site.webmanifest) |

SVG 的图形和字标均由真正的路径组成，不包含内嵌图片、外部图片或外部字体依赖。彩色版采用可编辑的线性渐变；单色版保留相同轮廓。2026-11-13 用户正式确认品牌名 Kooyu；当前字标为小写 kooyu，沿用 B「微倾流线」：基于 Quicksand 590，采用圆润收笔、更轻的字重、逐对调整的字距与约 3.7° 的轻微前倾，呼应丝带图形的动势，已转为路径。三版对照见 [字标探索](../wordmark-studies/README.md)。

当前字体文件为 [quicksand-latin.woff2](fonts/quicksand-latin.woff2)，许可为 [OFL-Quicksand.txt](fonts/OFL-Quicksand.txt)。目录中的 Manrope 字体与许可保留作历史来源；使用 SVG 时无需加载任何字体。

透明 PNG 在 `png/` 中：标志提供 1024 / 2048 px 宽度，横版组合与字标提供 2000 px 宽度。应用图标在 `icons/` 中提供 16、24、32、48、64、128、180、192、256、512、1024 px；另有适合 maskable 用法的实底安全区版本。

## 官网与软件使用

将本目录保留结构复制到目标应用的 `public/brand/` 后：

```html
<img src="/brand/svg/kooyu-logo.svg" width="180" alt="Kooyu" />
<link rel="icon" href="/brand/icons/kooyu-app.ico" />
<link rel="apple-touch-icon" href="/brand/icons/kooyu-app-180.png" />
```

深色表面使用 `kooyu-logo-dark.svg`。工具栏和单色上下文使用墨黑、反白或 currentColor 版本。`currentColor` 随外层文字颜色变化的行为适用于内联 SVG；外部 `<img>` 推荐选用已固定颜色的对应文件。

React 可直接复制 `components/KooyuMark.tsx`：

```tsx
<KooyuMark width={32} height={27} />
<KooyuMark monochrome width={24} height={20} style={{ color: "#F17561" }} />
```

组件用 `useId` 为渐变和裁切路径生成独立 ID，可在同一页面重复渲染。已通过项目当前 React 类型环境的 TypeScript 检查。

## 尺寸与色彩

常规 UI 标志建议宽度至少 24 px；16–20 px 的托盘、favicon 等优先使用单色轮廓或已导出的应用图标。保留标志四周约为高度 1/6 的空白，不拉伸比例。彩色标志的渐变不应用来表达运行成功、失败或托管状态。

| 用途 | 色值 |
| --- | --- |
| 品牌主色 | `#F17561` |
| 带面高光 | `#FFD0B3` |
| 深色折面 | `#A03259` |
| 暖纸背景 | `#FAF8F4` |
| 深墨文字 | `#28232A` |
| 实心操作色 | `#BE4C42` |

变量同时提供为 [tokens.json](tokens.json) 和 [tokens.css](tokens.css)。软件界面仍应使用独立的语义状态色；此处定义的是品牌色。

## 制作与验证

源图为已选定的 [日落珊瑚 A 标识](../mobius-k/colors/coral.png)。轮廓通过周期三次样条拟合，并转换成 67 段三次贝塞尔曲线；1024 px 二值轮廓对照 IoU 为 0.996887。渐变折面经过矢量化整理，与原始生图的像素着色有细微差异，适合继续编辑和缩放。

已检查 SVG 可解析、无内嵌位图、PNG 可解码、透明背景、ICO/ICNS 导出及 React 类型。结果记录在 [validation.json](validation.json)。本目录为可使用素材；软件显示名称、主 agent 自我介绍与 PWA 名称已同步为 Kooyu，尚未发布官网。

重建：`python scripts/build-coral-brand.py`，或 `python scripts/build-brand.py`。预览：[brand-assets-preview.png](brand-assets-preview.png)。

## 更名兼容

kooyu-* 为正式取用文件名。kodo-* 文件保留为兼容副本，内容已更新为 Kooyu；React 旧入口 KodoMark.tsx 转发到 KooyuMark.tsx。CSS 提供 --kooyu-* 变量并保留旧变量别名。已有会话、系统凭据服务名、协议 harness ID 和 npm 工作区名称不做破坏性迁移。

历史产品生图保留原始 Kodo 字样，不能作为新版字标来源。正式接入请使用本目录 SVG。域名尚未选择或注册。
