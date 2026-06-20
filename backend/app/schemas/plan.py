from typing import Literal

from pydantic import BaseModel, Field


class FilePlanItem(BaseModel):
    path: str = Field(
        description="Relative path under src/ or public/, e.g. src/App.tsx, src/data/site.json",
    )
    description: str = Field(description="What this file should contain")
    file_type: Literal["tsx", "ts", "css", "json", "svg"]


class ProjectPlan(BaseModel):
    summary: str
    files: list[FilePlanItem] = Field(min_length=1, max_length=40)
    npm_dependencies: list[str] = Field(
        default_factory=list,
        description="Extra npm packages to install, e.g. react-simple-maps",
    )
