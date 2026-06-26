import { WebContainer, type WebContainerProcess } from "@webcontainer/api";

import { viteReactTemplate } from "./vite-template";

export type WebContainerFileChange = {
  path: string;
  content: string;
};

type ServerReadyListener = (url: string) => void;

type WebContainerRuntimeState = {
  webcontainerInstance: WebContainer | null;
  webcontainerBootPromise: Promise<WebContainer> | null;
  devProcess: WebContainerProcess | null;
  devServerPromise: Promise<void> | null;
  bootedProject: boolean;
  projectBootPromise: Promise<void> | null;
  serverReadyHandlerRegistered: boolean;
  serverReadyListeners: Set<ServerReadyListener>;
  lastServerUrl: string | null;
};

declare global {
  var __websiteBuilderWebContainerState: WebContainerRuntimeState | undefined;
}

const runtimeState = globalThis.__websiteBuilderWebContainerState ??= {
  webcontainerInstance: null,
  webcontainerBootPromise: null,
  devProcess: null,
  devServerPromise: null,
  bootedProject: false,
  projectBootPromise: null,
  serverReadyHandlerRegistered: false,
  serverReadyListeners: new Set<ServerReadyListener>(),
  lastServerUrl: null,
};

const DEFAULT_TEMPLATE_STYLE_PATH = "src/style.css";
const DEFAULT_TEMPLATE_STYLE_CONTENT = [
  "body {",
  "  margin: 0;",
  "  font-family: Inter, system-ui, sans-serif;",
  "  background: #0f172a;",
  "  color: white;",
  "}",
  "",
  ".shell {",
  "  min-height: 100vh;",
  "  display: flex;",
  "  align-items: center;",
  "  justify-content: center;",
  "  padding: 2rem;",
  "  text-align: center;",
  "}",
  "",
  ".card {",
  "  max-width: 640px;",
  "  border: 1px solid rgba(125, 211, 252, 0.35);",
  "  border-radius: 24px;",
  "  background: rgba(15, 23, 42, 0.72);",
  "  box-shadow: 0 24px 80px rgba(56, 189, 248, 0.18);",
  "  padding: 3rem;",
  "}",
  "",
  "h1 {",
  "  margin: 0.75rem 0;",
  "  font-size: clamp(2rem, 6vw, 4rem);",
  "}",
  "",
  "p {",
  "  font-size: 1.125rem;",
  "}",
  "",
  "pre {",
  "  max-width: 100%;",
  "  overflow: auto;",
  "  white-space: pre-wrap;",
  "  word-break: break-word;",
  "  text-align: left;",
  "}",
  "",
  ".error-card {",
  "  border-color: rgba(248, 113, 113, 0.55);",
  "}",
  "",
  ".eyebrow {",
  "  color: #38bdf8;",
  "  letter-spacing: 0.16em;",
  "  text-transform: uppercase;",
  "}",
].join("\n");

export async function getWebContainer(): Promise<WebContainer> {
  if (runtimeState.webcontainerInstance) {
    return runtimeState.webcontainerInstance;
  }

  if (!runtimeState.webcontainerBootPromise) {
    runtimeState.webcontainerBootPromise = WebContainer.boot()
      .then((instance) => {
        runtimeState.webcontainerInstance = instance;
        return instance;
      })
      .catch((error: unknown) => {
        runtimeState.webcontainerBootPromise = null;
        throw error;
      });
  }

  return runtimeState.webcontainerBootPromise;
}

export async function bootViteReactProject({
  onLog,
  onServerReady,
}: {
  onLog: (line: string) => void;
  onServerReady: (url: string) => void;
}): Promise<WebContainer> {
  const webcontainer = await getWebContainer();

  runtimeState.serverReadyListeners.add(onServerReady);
  if (!runtimeState.serverReadyHandlerRegistered) {
    webcontainer.on("server-ready", (_port, url) => {
      runtimeState.lastServerUrl = url;
      for (const listener of runtimeState.serverReadyListeners) {
        listener(url);
      }
    });
    runtimeState.serverReadyHandlerRegistered = true;
  }
  if (runtimeState.lastServerUrl) {
    onServerReady(runtimeState.lastServerUrl);
  }

  await ensureProjectBooted(webcontainer, onLog);
  await ensureDevServerRunning(webcontainer, onLog);

  return webcontainer;
}

async function ensureProjectBooted(webcontainer: WebContainer, onLog: (line: string) => void): Promise<void> {
  if (runtimeState.bootedProject) {
    return;
  }

  if (!runtimeState.projectBootPromise) {
    runtimeState.projectBootPromise = (async () => {
      onLog("Mounting Vite React template...\n");
      await webcontainer.mount(viteReactTemplate);

      onLog("Running npm install...\n");
      const installProcess = await webcontainer.spawn("npm", [
        "install",
        "--no-fund",
        "--no-audit",
        "--no-progress",
      ]);
      void pipeProcessOutput(installProcess, onLog);
      const installExitCode = await installProcess.exit;

      if (installExitCode !== 0) {
        throw new Error(`npm install failed with exit code ${installExitCode}`);
      }

      runtimeState.bootedProject = true;
    })().catch((error: unknown) => {
      runtimeState.projectBootPromise = null;
      throw error;
    });
  }

  await runtimeState.projectBootPromise;
}

async function ensureDevServerRunning(webcontainer: WebContainer, onLog: (line: string) => void): Promise<void> {
  if (runtimeState.devProcess) {
    return;
  }

  if (!runtimeState.devServerPromise) {
    runtimeState.devServerPromise = (async () => {
      onLog("Starting Vite dev server...\n");
      const process = await webcontainer.spawn("npm", ["run", "dev"]);
      runtimeState.devProcess = process;
      void pipeProcessOutput(process, onLog);
      void process.exit.finally(() => {
        if (runtimeState.devProcess === process) {
          runtimeState.devProcess = null;
          runtimeState.devServerPromise = null;
        }
      });
    })().catch((error: unknown) => {
      runtimeState.devServerPromise = null;
      throw error;
    });
  }

  await runtimeState.devServerPromise;
}

export type InteractiveCommand = {
  id: string;
  command: string;
  args: string[];
  write: (input: string) => Promise<void>;
  kill: () => Promise<void>;
  exit: Promise<number>;
};

export async function runWebContainerCommand({
  command,
  args,
  onOutput,
}: {
  command: string;
  args: string[];
  onOutput: (line: string) => void;
}): Promise<InteractiveCommand> {
  const webcontainer = await getWebContainer();
  const process = await webcontainer.spawn(command, args, {
    terminal: {
      cols: 120,
      rows: 30,
    },
  });
  const writer = process.input.getWriter();
  void pipeProcessOutput(process, onOutput);

  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    command,
    args,
    write: async (input: string) => {
      await writer.write(input);
    },
    kill: async () => {
      process.kill();
      try {
        writer.releaseLock();
      } catch {
        // Writer may already be released after process exit.
      }
    },
    exit: process.exit,
  };
}

export async function installPackageInWebContainer(
  packages: string[],
  onOutput: (line: string) => void,
): Promise<number> {
  const command = await runWebContainerCommand({
    command: "npm",
    args: ["install", ...packages, "--no-fund", "--no-audit", "--no-progress"],
    onOutput,
  });
  return command.exit;
}

export async function stopWebContainerDevServer(): Promise<void> {
  if (!runtimeState.devProcess) {
    return;
  }
  const process = runtimeState.devProcess;
  process.kill();
  await process.exit.catch(() => 1);
  if (runtimeState.devProcess === process) {
    runtimeState.devProcess = null;
    runtimeState.devServerPromise = null;
  }
}

export async function restartWebContainerDevServer({
  onLog,
  onServerReady,
}: {
  onLog: (line: string) => void;
  onServerReady: (url: string) => void;
}): Promise<void> {
  const webcontainer = await bootViteReactProject({ onLog, onServerReady });
  await stopWebContainerDevServer();
  onLog("Restarting Vite dev server...\n");
  const process = await webcontainer.spawn("npm", ["run", "dev"]);
  runtimeState.devProcess = process;
  runtimeState.devServerPromise = Promise.resolve();
  void pipeProcessOutput(process, onLog);
  void process.exit.finally(() => {
    if (runtimeState.devProcess === process) {
      runtimeState.devProcess = null;
      runtimeState.devServerPromise = null;
    }
  });
}

export async function writeFilesToWebContainer(
  files: WebContainerFileChange[],
  {
    onLog,
    onServerReady,
    resetTemplateStyles = false,
  }: {
    onLog: (line: string) => void;
    onServerReady: (url: string) => void;
    resetTemplateStyles?: boolean;
  },
): Promise<void> {
  if (files.length === 0) {
    return;
  }

  const webcontainer = await bootViteReactProject({ onLog, onServerReady });
  const shouldInstall = files.some((file) => normalizePath(file.path) === "package.json");
  const incomingPaths = new Set(files.map((file) => normalizePath(file.path)));

  if (resetTemplateStyles && !incomingPaths.has(DEFAULT_TEMPLATE_STYLE_PATH)) {
    await clearDefaultTemplateStyle(webcontainer, onLog);
  }

  for (const file of files) {
    const path = normalizePath(file.path);
    await ensureParentDirectory(webcontainer, path);
    await webcontainer.fs.writeFile(path, file.content);
    onLog(`Synced ${path} to WebContainer.\n`);
  }

  if (shouldInstall) {
    onLog("package.json changed; running npm install in WebContainer...\n");
    const installProcess = await webcontainer.spawn("npm", [
      "install",
      "--no-fund",
      "--no-audit",
      "--no-progress",
    ]);
    void pipeProcessOutput(installProcess, onLog);
    const installExitCode = await installProcess.exit;

    if (installExitCode !== 0) {
      throw new Error(`npm install failed with exit code ${installExitCode}`);
    }
  }
}

async function clearDefaultTemplateStyle(webcontainer: WebContainer, onLog: (line: string) => void): Promise<void> {
  try {
    const currentStyle = await webcontainer.fs.readFile(DEFAULT_TEMPLATE_STYLE_PATH, "utf-8");
    if (currentStyle.trim() !== DEFAULT_TEMPLATE_STYLE_CONTENT.trim()) {
      return;
    }

    await webcontainer.fs.writeFile(
      DEFAULT_TEMPLATE_STYLE_PATH,
      "body {\n  margin: 0;\n}\n",
    );
    onLog("Cleared default WebContainer template styles.\n");
  } catch {
    // The generated project may not use the template stylesheet.
  }
}

export async function deleteFileFromWebContainer(path: string, onLog: (line: string) => void): Promise<void> {
  const webcontainer = await getWebContainer();
  const normalizedPath = normalizePath(path);

  try {
    await webcontainer.fs.rm(normalizedPath);
    onLog(`Deleted ${normalizedPath} from WebContainer.\n`);
  } catch {
    onLog(`Skipped deleting ${normalizedPath}; file was not found in WebContainer.\n`);
  }
}

export async function renameFileInWebContainer(
  oldPath: string,
  newPath: string,
  onLog: (line: string) => void,
): Promise<void> {
  const webcontainer = await getWebContainer();
  const normalizedOldPath = normalizePath(oldPath);
  const normalizedNewPath = normalizePath(newPath);

  await ensureParentDirectory(webcontainer, normalizedNewPath);
  try {
    await webcontainer.fs.rename(normalizedOldPath, normalizedNewPath);
    onLog(`Renamed ${normalizedOldPath} to ${normalizedNewPath} in WebContainer.\n`);
  } catch {
    onLog(`Skipped renaming ${normalizedOldPath}; file was not found in WebContainer.\n`);
  }
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\/+/, "");
}

async function ensureParentDirectory(webcontainer: WebContainer, path: string): Promise<void> {
  const parts = path.split("/").slice(0, -1);
  let current = "";

  for (const part of parts) {
    current = current ? `${current}/${part}` : part;
    try {
      await webcontainer.fs.mkdir(current);
    } catch {
      // Directory may already exist.
    }
  }
}

async function pipeProcessOutput(
  process: WebContainerProcess,
  onLog: (line: string) => void,
): Promise<void> {
  await process.output.pipeTo(
    new WritableStream({
      write(data) {
        onLog(data);
      },
    }),
  );
}
