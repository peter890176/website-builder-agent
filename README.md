# website-builder-agent

Full-stack website builder agent project with a Next.js frontend, FastAPI backend, and LangGraph / LangChain / OpenAI agent capabilities.

## Project Overview

`website-builder-agent` helps build and iterate websites with AI agent workflows. It includes a working frontend app, backend API, project workspace persistence, WebContainer live preview, and verification/deployment foundations.

## Architecture

| Layer | Technology |
|------|------|
| Frontend | Next.js App Router, TypeScript, Tailwind CSS |
| Backend | FastAPI, Uvicorn |
| Agent | LangGraph, LangChain, `langchain-openai` with OpenAI API configuration |

## Folder Structure

```
website-builder-agent/
├── README.md           # Project documentation
├── .gitignore
├── workspace/          # Generated Vite projects; do not commit
├── frontend/           # Next.js app
│   ├── app/
│   ├── package.json
│   └── ...
└── backend/
    ├── .gitignore
    ├── .venv/          # Python virtual environment; do not commit
    ├── requirements.txt
    └── app/
        ├── __init__.py
        └── main.py     # FastAPI entry point
```

## Run Frontend

```bash
cd frontend
npm run dev
```

Default dev server: http://localhost:3000

## Run Backend

In Windows PowerShell:

```powershell
cd backend
.\.venv\Scripts\Activate.ps1
uvicorn app.main:app --reload
```

`workspace/` lives at the repository root so `--reload` does not restart repeatedly when `node_modules` changes.

API docs: http://127.0.0.1:8000/docs  
Root route example: `GET /` returns a JSON greeting.

## Environment Variables

Set the following variable for OpenAI-powered features:

- `OPENAI_API_KEY`: OpenAI API key

Recommended location: `backend/.env`. This file is ignored by git and must not be committed. You can also configure the key through system environment variables.

## License and Contributing

Add license and contribution guidelines according to project requirements.
