const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:8000";
const CHAT_TIMEOUT_MS = 6 * 60 * 1000;

export type ProjectCreateResponse = {
  project_id: string;
  workspace_path: string;
};

export type ChatMode = "auto" | "generate" | "edit";

export type ProjectWarning = {
  kind: string;
  message: string;
  path?: string;
  url?: string;
  referenced_by?: string[];
  fallback?: string;
};

export type ChatResponse = {
  message: string;
  reply: string;
  project_id: string;
  workspace_path: string;
  files: string[];
  preview_url: string | null;
  build_attempts: number;
  fix_attempts: number;
  build_log: string;
  warnings: ProjectWarning[];
  changed_files: ChangedProjectFile[];
};

export type ChangedProjectFile = {
  path: string;
  content: string;
};

export type ProjectFileListResponse = {
  files: string[];
};

export type ProjectFileContentResponse = {
  path: string;
  content: string;
};

export type TypeScriptDiagnostic = {
  file: string;
  line: number;
  col: number;
  code: string;
  message: string;
};

export type ProjectDiagnosticsResponse = {
  project_id: string;
  status: "idle" | "drafting" | "live_unverified" | "verifying" | "passed" | "failed";
  build_log: string;
  typescript_errors: TypeScriptDiagnostic[];
  runtime_errors: string[];
  warnings: ProjectWarning[];
  changed_files: ChangedProjectFile[];
  notes: string[];
  preview_url: string | null;
  updated_at: string | null;
};

export type ProjectEditPatchPreview = {
  path: string;
  content: string;
  previous_content: string;
  diff: string;
  change_type: "added" | "modified";
  diff_lines: number;
};

export type ProjectEditPreviewResponse = {
  notes: string;
  patches: ProjectEditPatchPreview[];
  npm_dependencies: string[];
  dev_dependencies: string[];
  warnings: ProjectWarning[];
  change_size: "small" | "large";
  requires_confirmation: boolean;
  total_diff_lines: number;
};

export type ProjectEditPreviewContext = {
  context_files?: string[];
  current_file?: string | null;
  selected_text?: string;
  selected_range?: string;
  diagnostics_summary?: string;
};

export type ProjectEditApplyResponse = {
  message: string;
  changed_files: ChangedProjectFile[];
};

export type TerminalHistoryEntry = {
  id: string;
  session_id: string;
  cwd: string;
  command: string;
  args: string[];
  exit_code: number | null;
  output: string;
  created_at: string;
};

export type ProjectSnapshot = {
  id: string;
  label: string;
  kind: string;
  prompt: string;
  notes: string;
  file_count: number;
  created_at: string;
  verified: boolean;
};

export type HistoryEvent = {
  id: string;
  type: string;
  message: string;
  metadata: Record<string, unknown>;
  created_at: string;
};

export type SnapshotCompareFile = {
  path: string;
  change_type: "added" | "removed" | "modified";
};

export type SnapshotCompareResponse = {
  from_snapshot: ProjectSnapshot;
  to_snapshot: ProjectSnapshot;
  files: SnapshotCompareFile[];
};

export type DeploymentRecord = {
  id: string;
  provider: "github" | "vercel" | "netlify" | "cloudflare";
  status: "queued" | "running" | "ready" | "failed";
  url: string | null;
  message: string;
  created_at: string;
  updated_at: string;
};

export type QualityIssue = {
  category: "seo" | "accessibility" | "responsive" | "runtime" | "design";
  severity: "info" | "warning" | "error";
  message: string;
  path: string;
};

export type QualityReviewResponse = {
  id: string;
  project_id: string;
  score: number;
  issues: QualityIssue[];
  screenshots: string[];
  notes: string[];
  created_at: string;
};

export type VariantSummary = {
  id: string;
  title: string;
  description: string;
  preview_notes: string;
};

export type ProjectVariant = {
  id: string;
  title: string;
  description: string;
  status: "queued" | "building" | "ready" | "failed";
  patches: ChangedProjectFile[];
  diff_summary: string;
  quality_score: number;
  issues: QualityIssue[];
  screenshots: string[];
  build_log: string;
  job_id: string;
  created_at: string;
};

export type JobArtifact = {
  id: string;
  type: string;
  name: string;
  path: string;
  url: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
};

export type JobLogEntry = {
  level: "info" | "warning" | "error";
  message: string;
  created_at: string;
};

export type ProjectJob = {
  id: string;
  project_id: string;
  type: "variant_generation" | "quality_review" | "terminal_command" | "dependency_install" | "deployment" | "snapshot_restore";
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  progress: number;
  title: string;
  logs: JobLogEntry[];
  artifacts: JobArtifact[];
  error: string;
  cancel_requested: boolean;
  created_at: string;
  updated_at: string;
};

async function parseError(response: Response): Promise<string> {
  try {
    const data = (await response.json()) as { detail?: string | { msg: string }[] };
    if (typeof data.detail === "string") {
      return data.detail;
    }
    if (Array.isArray(data.detail) && data.detail[0]?.msg) {
      return data.detail[0].msg;
    }
  } catch {
    // ignore JSON parse errors
  }
  return `Request failed (${response.status})`;
}

async function fetchWithTimeout(
  input: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("Request timed out. First generation can take 1-3 minutes. Check whether the backend terminal is still running npm or build tasks.");
    }
    throw error;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

export async function createProject(): Promise<ProjectCreateResponse> {
  const response = await fetch(`${API_URL}/api/projects`, {
    method: "POST",
  });

  if (!response.ok) {
    throw new Error(await parseError(response));
  }

  return response.json() as Promise<ProjectCreateResponse>;
}

export async function sendChat(
  projectId: string,
  message: string,
  mode: ChatMode = "auto",
): Promise<ChatResponse> {
  const response = await fetchWithTimeout(
    `${API_URL}/api/projects/${projectId}/chat`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, mode }),
    },
    CHAT_TIMEOUT_MS,
  );

  if (!response.ok) {
    throw new Error(await parseError(response));
  }

  return response.json() as Promise<ChatResponse>;
}

export async function sendChatDraft(
  projectId: string,
  message: string,
  mode: ChatMode = "auto",
): Promise<ChatResponse> {
  const response = await fetchWithTimeout(
    `${API_URL}/api/projects/${projectId}/chat/draft`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, mode }),
    },
    CHAT_TIMEOUT_MS,
  );

  if (!response.ok) {
    throw new Error(await parseError(response));
  }

  return response.json() as Promise<ChatResponse>;
}

export async function listProjectFiles(projectId: string): Promise<string[]> {
  const response = await fetch(`${API_URL}/api/projects/${projectId}/files`);

  if (!response.ok) {
    throw new Error(await parseError(response));
  }

  const data = (await response.json()) as ProjectFileListResponse;
  return data.files;
}

export async function readProjectFile(
  projectId: string,
  path: string,
): Promise<ProjectFileContentResponse> {
  const response = await fetch(
    `${API_URL}/api/projects/${projectId}/files/content?path=${encodeURIComponent(path)}`,
  );

  if (!response.ok) {
    throw new Error(await parseError(response));
  }

  return response.json() as Promise<ProjectFileContentResponse>;
}

export async function saveProjectFile(
  projectId: string,
  path: string,
  content: string,
): Promise<void> {
  const response = await fetch(`${API_URL}/api/projects/${projectId}/files/content`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path, content }),
  });

  if (!response.ok) {
    throw new Error(await parseError(response));
  }
}

export async function createProjectFile(
  projectId: string,
  path: string,
  content: string = "",
): Promise<void> {
  const response = await fetch(`${API_URL}/api/projects/${projectId}/files/content`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path, content }),
  });

  if (!response.ok) {
    throw new Error(await parseError(response));
  }
}

export async function renameProjectFile(
  projectId: string,
  oldPath: string,
  newPath: string,
): Promise<void> {
  const response = await fetch(`${API_URL}/api/projects/${projectId}/files/content`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ old_path: oldPath, new_path: newPath }),
  });

  if (!response.ok) {
    throw new Error(await parseError(response));
  }
}

export async function deleteProjectFile(projectId: string, path: string): Promise<void> {
  const response = await fetch(
    `${API_URL}/api/projects/${projectId}/files/content?path=${encodeURIComponent(path)}`,
    {
      method: "DELETE",
    },
  );

  if (!response.ok) {
    throw new Error(await parseError(response));
  }
}

export async function getProjectDiagnostics(projectId: string): Promise<ProjectDiagnosticsResponse> {
  const response = await fetch(`${API_URL}/api/projects/${projectId}/diagnostics`);

  if (!response.ok) {
    throw new Error(await parseError(response));
  }

  return response.json() as Promise<ProjectDiagnosticsResponse>;
}

export async function runProjectBuild(projectId: string): Promise<ProjectDiagnosticsResponse> {
  const response = await fetchWithTimeout(
    `${API_URL}/api/projects/${projectId}/build`,
    {
      method: "POST",
    },
    CHAT_TIMEOUT_MS,
  );

  if (!response.ok) {
    throw new Error(await parseError(response));
  }

  return response.json() as Promise<ProjectDiagnosticsResponse>;
}

export async function runProjectVerify(projectId: string): Promise<ProjectDiagnosticsResponse> {
  const response = await fetchWithTimeout(
    `${API_URL}/api/projects/${projectId}/verify`,
    {
      method: "POST",
    },
    CHAT_TIMEOUT_MS,
  );

  if (!response.ok) {
    throw new Error(await parseError(response));
  }

  return response.json() as Promise<ProjectDiagnosticsResponse>;
}

export async function previewProjectEdit(
  projectId: string,
  message: string,
  context: ProjectEditPreviewContext = {},
): Promise<ProjectEditPreviewResponse> {
  const response = await fetchWithTimeout(
    `${API_URL}/api/projects/${projectId}/edit/preview`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, ...context }),
    },
    CHAT_TIMEOUT_MS,
  );

  if (!response.ok) {
    throw new Error(await parseError(response));
  }

  return response.json() as Promise<ProjectEditPreviewResponse>;
}

export async function applyProjectEdit(
  projectId: string,
  patches: ChangedProjectFile[],
): Promise<ProjectEditApplyResponse> {
  const response = await fetch(`${API_URL}/api/projects/${projectId}/edit/apply`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ patches }),
  });

  if (!response.ok) {
    throw new Error(await parseError(response));
  }

  return response.json() as Promise<ProjectEditApplyResponse>;
}

export async function getTerminalHistory(projectId: string): Promise<TerminalHistoryEntry[]> {
  const response = await fetch(`${API_URL}/api/projects/${projectId}/terminal/history`);
  if (!response.ok) {
    throw new Error(await parseError(response));
  }
  const data = await response.json() as { entries: TerminalHistoryEntry[] };
  return data.entries;
}

export async function createJob(
  projectId: string,
  body: { type: ProjectJob["type"]; title?: string },
): Promise<ProjectJob> {
  const response = await fetch(`${API_URL}/api/projects/${projectId}/jobs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(await parseError(response));
  }
  return response.json() as Promise<ProjectJob>;
}

export async function listJobs(projectId: string): Promise<ProjectJob[]> {
  const response = await fetch(`${API_URL}/api/projects/${projectId}/jobs`);
  if (!response.ok) {
    throw new Error(await parseError(response));
  }
  const data = await response.json() as { jobs: ProjectJob[] };
  return data.jobs;
}

export async function getJob(projectId: string, jobId: string): Promise<ProjectJob> {
  const response = await fetch(`${API_URL}/api/projects/${projectId}/jobs/${jobId}`);
  if (!response.ok) {
    throw new Error(await parseError(response));
  }
  return response.json() as Promise<ProjectJob>;
}

export async function cancelJob(projectId: string, jobId: string): Promise<ProjectJob> {
  const response = await fetch(`${API_URL}/api/projects/${projectId}/jobs/${jobId}/cancel`, {
    method: "POST",
  });
  if (!response.ok) {
    throw new Error(await parseError(response));
  }
  return response.json() as Promise<ProjectJob>;
}

export async function recordTerminalHistory(
  projectId: string,
  entry: { command: string; args?: string[]; session_id?: string; cwd?: string; exit_code?: number | null; output?: string },
): Promise<TerminalHistoryEntry[]> {
  const response = await fetch(`${API_URL}/api/projects/${projectId}/terminal/history`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(entry),
  });
  if (!response.ok) {
    throw new Error(await parseError(response));
  }
  const data = await response.json() as { entries: TerminalHistoryEntry[] };
  return data.entries;
}

export async function installBackendPackages(
  projectId: string,
  packages: string[],
  dev = false,
): Promise<TerminalHistoryEntry> {
  const response = await fetchWithTimeout(
    `${API_URL}/api/projects/${projectId}/terminal/install`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ packages, dev }),
    },
    CHAT_TIMEOUT_MS,
  );
  if (!response.ok) {
    throw new Error(await parseError(response));
  }
  const data = await response.json() as { entry: TerminalHistoryEntry };
  return data.entry;
}

export async function createSnapshot(
  projectId: string,
  body: { label: string; kind?: string; prompt?: string; notes?: string },
): Promise<ProjectSnapshot> {
  const response = await fetch(`${API_URL}/api/projects/${projectId}/snapshots`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(await parseError(response));
  }
  const data = await response.json() as { snapshot: ProjectSnapshot };
  return data.snapshot;
}

export async function listSnapshots(projectId: string): Promise<ProjectSnapshot[]> {
  const response = await fetch(`${API_URL}/api/projects/${projectId}/snapshots`);
  if (!response.ok) {
    throw new Error(await parseError(response));
  }
  const data = await response.json() as { snapshots: ProjectSnapshot[] };
  return data.snapshots;
}

export async function restoreSnapshot(projectId: string, snapshotId: string): Promise<ProjectEditApplyResponse> {
  const response = await fetch(`${API_URL}/api/projects/${projectId}/snapshots/${snapshotId}/restore`, {
    method: "POST",
  });
  if (!response.ok) {
    throw new Error(await parseError(response));
  }
  return response.json() as Promise<ProjectEditApplyResponse>;
}

export async function deleteSnapshot(projectId: string, snapshotId: string): Promise<ProjectSnapshot> {
  const response = await fetch(`${API_URL}/api/projects/${projectId}/snapshots/${snapshotId}`, {
    method: "DELETE",
  });
  if (!response.ok) {
    throw new Error(await parseError(response));
  }
  const data = await response.json() as { snapshot: ProjectSnapshot };
  return data.snapshot;
}

export async function getProjectHistory(projectId: string): Promise<HistoryEvent[]> {
  const response = await fetch(`${API_URL}/api/projects/${projectId}/history`);
  if (!response.ok) {
    throw new Error(await parseError(response));
  }
  const data = await response.json() as { events: HistoryEvent[] };
  return data.events;
}

export async function compareSnapshots(
  projectId: string,
  fromSnapshotId: string,
  toSnapshotId: string,
): Promise<SnapshotCompareResponse> {
  const response = await fetch(`${API_URL}/api/projects/${projectId}/snapshots/${fromSnapshotId}/compare/${toSnapshotId}`);
  if (!response.ok) {
    throw new Error(await parseError(response));
  }
  return response.json() as Promise<SnapshotCompareResponse>;
}

export function exportZipUrl(projectId: string, buildOutput = false): string {
  return `${API_URL}/api/projects/${projectId}/export/zip?build_output=${buildOutput ? "true" : "false"}`;
}

export async function exportToGitHub(
  projectId: string,
  body: { owner: string; repo: string; branch?: string; commit_message?: string; create_repo?: boolean; private?: boolean },
): Promise<DeploymentRecord> {
  const response = await fetchWithTimeout(
    `${API_URL}/api/projects/${projectId}/export/github`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
    CHAT_TIMEOUT_MS,
  );
  if (!response.ok) {
    throw new Error(await parseError(response));
  }
  const data = await response.json() as { deployment: DeploymentRecord };
  return data.deployment;
}

export async function deployProject(
  projectId: string,
  body: { provider: "vercel" | "netlify" | "cloudflare"; site_name?: string; project_name?: string },
): Promise<DeploymentRecord> {
  const response = await fetchWithTimeout(
    `${API_URL}/api/projects/${projectId}/deploy`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
    CHAT_TIMEOUT_MS,
  );
  if (!response.ok) {
    throw new Error(await parseError(response));
  }
  return response.json() as Promise<DeploymentRecord>;
}

export async function listDeployments(projectId: string): Promise<DeploymentRecord[]> {
  const response = await fetch(`${API_URL}/api/projects/${projectId}/deployments`);
  if (!response.ok) {
    throw new Error(await parseError(response));
  }
  const data = await response.json() as { deployments: DeploymentRecord[] };
  return data.deployments;
}

export async function runQualityReview(projectId: string): Promise<QualityReviewResponse> {
  const response = await fetchWithTimeout(`${API_URL}/api/projects/${projectId}/quality/review`, { method: "POST" }, CHAT_TIMEOUT_MS);
  if (!response.ok) {
    throw new Error(await parseError(response));
  }
  return response.json() as Promise<QualityReviewResponse>;
}

export async function previewDesignPolish(projectId: string, focus: string): Promise<ProjectEditPreviewResponse> {
  const response = await fetchWithTimeout(
    `${API_URL}/api/projects/${projectId}/quality/polish/preview`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ focus }),
    },
    CHAT_TIMEOUT_MS,
  );
  if (!response.ok) {
    throw new Error(await parseError(response));
  }
  return response.json() as Promise<ProjectEditPreviewResponse>;
}

export async function generateVariants(projectId: string, count = 3, focus = ""): Promise<ProjectVariant[]> {
  const response = await fetchWithTimeout(`${API_URL}/api/projects/${projectId}/variants/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ count, focus: focus || undefined }),
  }, CHAT_TIMEOUT_MS);
  if (!response.ok) {
    throw new Error(await parseError(response));
  }
  const data = await response.json() as { variants: ProjectVariant[] };
  return data.variants;
}

export async function listVariants(projectId: string): Promise<ProjectVariant[]> {
  const response = await fetch(`${API_URL}/api/projects/${projectId}/variants`);
  if (!response.ok) {
    throw new Error(await parseError(response));
  }
  const data = await response.json() as { variants: ProjectVariant[] };
  return data.variants;
}

export async function applyVariant(projectId: string, variantId: string): Promise<ProjectEditApplyResponse> {
  const response = await fetch(`${API_URL}/api/projects/${projectId}/variants/${variantId}/apply`, {
    method: "POST",
  });
  if (!response.ok) {
    throw new Error(await parseError(response));
  }
  return response.json() as Promise<ProjectEditApplyResponse>;
}

export async function deleteVariant(projectId: string, variantId: string): Promise<ProjectVariant> {
  const response = await fetch(`${API_URL}/api/projects/${projectId}/variants/${variantId}`, {
    method: "DELETE",
  });
  if (!response.ok) {
    throw new Error(await parseError(response));
  }
  return response.json() as Promise<ProjectVariant>;
}

export function resolvePreviewUrl(
  previewPath: string | null,
  version: number = Date.now(),
): string | null {
  if (!previewPath) {
    return null;
  }

  const base = previewPath.startsWith("http://") || previewPath.startsWith("https://")
    ? previewPath
    : `${API_URL}${previewPath}`;

  const separator = base.includes("?") ? "&" : "?";
  return `${base}${separator}v=${version}`;
}

export { API_URL };
