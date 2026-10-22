# 参考项目与取舍

研究日期：2026-10-21。下列仓库是参考资料，不是运行依赖。

| 项目 | 实际阅读内容 | 采用的判断 | 不继承 |
| --- | --- | --- | --- |
| [verso. / jianbai](https://github.com/kanshao2077/jianbai) | 本地现有 README、`src/index.css`、`WriterPage.tsx`、浅色界面截图 | 克制顶栏、少量强调色、安静的文字层级、菜单收纳、系统外观 | 四栏结构、写作编辑器功能 |
| [Bookmark Dashboard](https://github.com/songshiqiang/bookmark-dashboard) | README；`src/hooks/useBookmarks.js`；`src/lib/bookmarks.js`；`src/lib/boardLayout.js`；仓库文件树 | 书签与展示状态分离，独立标签页，原生 API 事件订阅 | 大卡片、拖拽依赖、写入后的 1.8 秒刷新抑制、缺少错误传播的回调封装 |
| [linkding](https://github.com/sissbruecker/linkding) | README 与功能边界 | 可读文字、标签辅助检索、批量动作、Netscape 导出 | Django 服务、数据库、账号、归档、Read later、站点抓取 |
| [Bonjourr](https://github.com/victrme/Bonjourr) | README、仓库文件树、`src/styles/_responsive.css` | 窄屏重新排布、触摸目标、响应式留白 | 替换新标签页、天气时钟、动态背景、图片快捷入口 |
| [Skill Atlas](https://github.com/kanshao2077/skill-atlas) | README | 展示别名与原始来源分离，操作前可核对的边界 | 扫描与安装管理服务 |
| [Afterglow Index](https://github.com/kanshao2077/afterglow-index) | README | 机器提供候选、用户作最终选择，明确事实与推断 | 动态信息源、抓取、作品聚合、资讯业务 |

Bookmark Dashboard 研究时 HEAD：`64d89bfcfc2ee84d65c34bf7f9f06b8c1e8e1691`。Bonjourr：`5f7abcad916671b7495270adb6be97ba0a5c848d`。

Bookmark Dashboard README 声明 MIT，但研究时仓库树没有独立 LICENSE 文件；因此没有逐段复制其实现。Bonjourr 带 GPL 许可，本项目只参考其行为和响应式思路，不复制代码、CSS 或资源。其他参考项目同样没有直接拷贝源文件。

实际复用的是 React / React DOM / Scheduler（MIT）、Zod（MIT），以及构建/测试开发依赖。构建脚本从实际安装包读取许可并输出 `dist/THIRD_PARTY_LICENSES.txt`。图标使用项目作者提供的原图，保存在 `docs/icon-source.png`，确定性裁边缩放生成扩展所需 PNG。页面品牌句点为橙色，主体配色为中性黑白灰。字体仅系统回退，不附带受限字体文件。

## Chrome API 依据

- [Bookmarks API](https://developer.chrome.com/docs/extensions/reference/api/bookmarks)：原生树、Promise API、事件、系统目录保护、`folderType` / `unmodifiable`。
- [Action API](https://developer.chrome.com/docs/extensions/reference/api/action)：无 popup 的工具栏点击、原生图标格式。
- [DevTools Extensions domain](https://chromedevtools.github.io/devtools-protocol/tot/Extensions/)：仅自动测试使用的临时资料扩展加载与工具栏动作触发。

事件刷新在本产品中不按固定时间忽略本地事件；通过短合并窗口减少刷新，并在导入结束和窗口重新聚焦时补读。读取序号防止较早请求覆盖较新结果。
