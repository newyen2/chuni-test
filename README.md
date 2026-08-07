# CHUNITHM 成績檢視器

## 版本更新規則

目前版本由 `index.html` 與 `music.html` 根元素的 `data-app-version` 管理。每次修改網頁功能、介面或修正錯誤時，都必須同步遞增版本號，並在交付說明中明確寫出新版本。

- 修正錯誤或小幅調整：遞增修訂號，例如 `v1.0.0` → `v1.0.1`
- 新增向下相容功能：遞增次版本，例如 `v1.0.1` → `v1.1.0`
- 不相容的大型改版：遞增主版本，例如 `v1.1.0` → `v2.0.0`

頁面會自動將此版本顯示在頂部，並分別用於 `viewer.js`、`music.js` 的快取版本參數。

## 頁面結構

- `index.html` + `viewer.js`：成績查詢與 CHUNITHM-NET bridge 流程
- `music.html` + `music.js`：chunirec 歌曲資料、快取、搜尋與分頁
- `bridge.js`：安裝於 CHUNITHM-NET 頁面的資料橋接腳本

歌曲 API Token 目前位於前端 `music.js`。由於 GitHub Pages 是公開靜態網站，部署後 Token 也會出現在公開的前端資源中；若需要保密，應改由後端或 Serverless API 代理保存 Token。
