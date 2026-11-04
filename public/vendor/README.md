# 本地界面组件

以下浏览器构建来自 npm 官方 registry，下载时已按包元数据的 SHA-512 integrity 校验，文件未经修改。无需联网或安装依赖。

- Cytoscape.js **3.34.4**：`cytoscape.min.js`，MIT，https://github.com/cytoscape/cytoscape.js
- cytoscape-dagre **4.0.1**：`cytoscape-dagre.js`，MIT，https://github.com/cytoscape/cytoscape.js-dagre
- 后者内嵌 Dagre **3.0.0** 与 Graphlib **4.0.1**；两者许可证一并保留。包版本以 npm 元数据为准（扩展构建头仍标记 4.0.0）。
- Tom Select **2.4.3**：`tom-select.complete.min.js`、`tom-select.css`，Apache-2.0，https://github.com/orchidjs/tom-select 。用于正式应用全部下拉框，完整构建内含 Sifter 与 Unicode Variants；许可证一并保留。

API 参考：通过 Context7 MCP 查询 `/cytoscape/cytoscape.js`、`/dagrejs/dagre`，并核对扩展官方 README。
下拉组件参考：通过 Context7 MCP 查询 `/orchidjs/tom-select`，保留原始 select 的表单值和 change 事件；账号字段支持搜索，其余字段直接选择。

## SHA-256

- `cytoscape.min.js`: `081591ab735b2b6a3b31a3c60f8f3a3e2fee8c92939e0c7820ad1208571b6cd8`
- `cytoscape-dagre.js`: `d7ce98b7addb74a53df03b58c743266b6abd3d85b0e428d255e9285cde3de8c0`
- `tom-select.complete.min.js`: `b797005cf23378fb38448b80dc57a33313a5c577b841765743bb1f289c4d53e6`
- `tom-select.css`: `7b29f39e2916acfb3d050e00df8fcdfca89279ead2d8e654afec307ca63b10f9`
