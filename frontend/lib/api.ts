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
      throw new Error("請求逾時。首次生成可能需要 1-3 分鐘，請確認後端 terminal 是否仍在執行 npm / build。");
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
