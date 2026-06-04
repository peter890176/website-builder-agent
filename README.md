# website-builder-agent

全端網站建置代理專案：以 Next.js 前端搭配 FastAPI 後端，並預留 LangGraph / LangChain / OpenAI 代理能力。

## 專案概覽

`website-builder-agent` 旨在協助以 AI 代理流程建置與迭代網站。目前包含可運行的前端樣板與最小後端 API，後續可在後端整合 LangGraph 工作流與 LangChain 工具鏈。

## 架構

| 層級 | 技術 |
|------|------|
| 前端 | Next.js（App Router）、TypeScript、Tailwind CSS |
| 後端 | FastAPI、Uvicorn |
| 代理 | LangGraph、LangChain、`langchain-openai`（需設定 OpenAI API） |

## 資料夾結構

```
website-builder-agent/
├── README.md           # 本說明
├── .gitignore
├── frontend/           # Next.js 應用
│   ├── app/
│   ├── package.json
│   └── ...
└── backend/
    ├── .gitignore
    ├── .venv/          # Python 虛擬環境（勿提交）
    ├── requirements.txt
    └── app/
        ├── __init__.py
        └── main.py     # FastAPI 進入點
```

## 執行前端

```bash
cd frontend
npm run dev
```

預設開發伺服器：http://localhost:3000

## 執行後端

在 Windows PowerShell：

```powershell
cd backend
.\.venv\Scripts\Activate.ps1
uvicorn app.main:app --reload
```

API 文件：http://127.0.0.1:8000/docs  
根路徑範例：`GET /` 回傳 JSON 問候訊息。

## 環境變數

使用 OpenAI 相關功能時，請設定：

- `OPENAI_API_KEY`：OpenAI API 金鑰

建議在 `backend/.env` 中設定（此檔已列入 `.gitignore`，請勿提交至版本庫）。亦可於系統環境變數中設定。

## 授權與貢獻

依專案需求自行補充授權與貢獻指南。
