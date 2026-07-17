# 📝 网课笔记助手

> 网课截图+笔记一键搞定。支持 B站 / 腾讯会议 / ClassIn，导出 Markdown & PDF。

## ✨ 功能

- 🎬 **一键截图** — 视频页面自动出现浮动按钮，点击或 Alt+S 截取当前画面
- 📝 **快速笔记** — 截图后弹出编辑窗，支持拖拽、缩放、自动存草稿
- 🏷 **标签归类** — 为笔记打标签（重点、公式、必考…）
- 📂 **自动分组** — 同一视频的笔记自动归到一起
- 🔍 **搜索** — 搜笔记内容、标签、视频标题
- 📥 **导出 Markdown** — 图文嵌入，Typora/VS Code 直接打开
- 📄 **导出 PDF** — 适合打印、交作业
- ⌨️ **键盘快捷键** — Alt+S 截图，Ctrl+Enter 保存，Esc 关闭

## 📦 安装

### 方式一：Chrome 商店（即将上架）

> 尚未上架，敬请期待。

### 方式二：开发者模式加载

1. 下载本项目到本地
2. 打开 Chrome，地址栏输入 `chrome://extensions/`
3. 打开右上角「开发者模式」
4. 点击「加载已解压的扩展程序」
5. 选择 `bilibili-note-taker` 文件夹

## 🎯 支持的平台

| 平台 | 状态 | 说明 |
|------|------|------|
| B站 (Bilibili) | ✅ 完整支持 | 自动识别播放器，按钮避开控制栏 |
| 腾讯会议网页版 | ✅ 支持 | meeting.tencent.com |
| ClassIn 网页版 | ✅ 支持 | classin.com / eeo.cn |
| 其他视频网站 | ✅ 通用支持 | 任何有 `<video>` 标签的页面 |

## ⌨️ 快捷键

| 快捷键 | 功能 |
|--------|------|
| `Alt + S` | 截取当前视频画面 |
| `Ctrl + Enter` | 保存笔记 |
| `Esc` | 关闭面板 |

## 🏗 项目结构

```
bilibili-note-taker/
├── manifest.json              # Chrome MV3 配置
├── background/
│   └── service-worker.js      # 后台服务
├── content/
│   ├── content.js             # 视频检测、截图、按钮 UI
│   └── overlay.css            # 页面注入样式
├── popup/
│   ├── popup.html             # 弹出窗口界面
│   ├── popup.css              # 弹出窗口样式
│   └── popup.js               # 笔记列表、搜索、导出
├── lib/
│   └── storage.js             # IndexedDB 存储层
├── icons/
│   ├── icon.svg
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
└── README.md
```

## 🔧 技术栈

- 纯原生 JavaScript，零依赖
- Chrome Extension Manifest V3
- IndexedDB 存储（大容量，存几百张截图无压力）
- Canvas API 视频截帧
- Chrome Storage API（笔记索引）

## 📄 许可

MIT License
