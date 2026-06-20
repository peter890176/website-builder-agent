from pydantic import BaseModel, Field





class FilePatch(BaseModel):

    path: str = Field(

        description="Relative path under src/ or public/, e.g. src/components/Map.tsx",

    )

    content: str = Field(description="Full updated file contents")





class ErrorFixClaim(BaseModel):

    error_signature: str = Field(
        default="",
        description="Exact TypeScript error signature from Build progress diagnostics, if available",
    )

    file: str = Field(description="TypeScript error file this claim addresses")

    line: int = Field(description="TypeScript error line this claim addresses")

    code: str = Field(description="TypeScript error code without TS prefix, e.g. 2322")

    diagnosis: str = Field(description="Specific diagnosis based on build/debug evidence")

    evidence_used: str = Field(description="Concrete evidence used: failing line/import/package type/data/etc.")

    change_summary: str = Field(description="What changed to resolve this specific error")

    patch_path: str = Field(
        default="",
        description="Path of the patch that resolves this error, or package/shared source path",
    )



class BuildFixResult(BaseModel):

    error_fixes: list[ErrorFixClaim] = Field(
        default_factory=list,
        description=(
            "One claim for each current TypeScript error. Required for build-stage fixes; "
            "each claim must map an error to evidence and the patch/package change that resolves it."
        ),
    )

    patches: list[FilePatch] = Field(

        default_factory=list,

        description="Files that must change; empty if only npm specs need updating",

    )

    npm_dependencies: list[str] = Field(

        default_factory=list,

        description=(

            "npm package specs to install or replace (include versions when needed, "

            "e.g. react-leaflet@^4.2.1)"

        ),

    )

    dev_dependencies: list[str] = Field(

        default_factory=list,

        description=(
            "dev-only npm package specs needed for type-check/build tooling, "
            "e.g. @types/package-name"
        ),

    )

    use_legacy_peer_deps: bool = Field(

        default=False,

        description="Set true when npm ERESOLVE peer-dependency conflicts should use --legacy-peer-deps",

    )

    notes: str = Field(default="", description="Short summary of what was fixed")


