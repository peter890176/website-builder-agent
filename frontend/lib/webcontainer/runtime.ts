import { WebContainer, type WebContainerProcess } from "@webcontainer/api";

import { viteReactTemplate } from "./vite-template";

export type WebContainerFileChange = {
  path: string;
  content: string;
};

let webcontainerInstance: WebContainer | null = null;
let devProcess: WebContainerProcess | null = null;
let bootedProject = false;

export async function getWebContainer(): Promise<WebContainer> {
  if (!webcontainerInstance) {
    webcontainerInstance = await WebContainer.boot();
  }

  return webcontainerInstance;
}

export async function bootViteReactProject({
  onLog,
  onServerReady,
}: {
  onLog: (line: string) => void;
  onServerReady: (url: string) => void;
}): Promise<WebContainer> {
  const webcontainer = await getWebContainer();

  webcontainer.on("server-ready", (_port, url) => {
    onServerReady(url);
  });

  if (!bootedProject) {
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

    bootedProject = true;
  }

  if (!devProcess) {
    onLog("Starting Vite dev server...\n");
    devProcess = await webcontainer.spawn("npm", ["run", "dev"]);
    void pipeProcessOutput(devProcess, onLog);
  }

  return webcontainer;
}

export async function writeFilesToWebContainer(
  files: WebContainerFileChange[],
  {
    onLog,
    onServerReady,
  }: {
    onLog: (line: string) => void;
    onServerReady: (url: string) => void;
  },
): Promise<void> {
  if (files.length === 0) {
    return;
  }

  const webcontainer = await bootViteReactProject({ onLog, onServerReady });
  const shouldInstall = files.some((file) => normalizePath(file.path) === "package.json");

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
