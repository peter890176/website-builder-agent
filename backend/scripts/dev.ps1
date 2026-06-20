# Run backend without reload restarts from workspace/node_modules changes.
Set-Location $PSScriptRoot\..

.\.venv\Scripts\Activate.ps1
uvicorn app.main:app --reload --reload-exclude "workspace/*"
