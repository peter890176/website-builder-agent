import { WebContainer, type WebContainerProcess } from "@webcontainer/api";

import { viteReactTemplate } from "./vite-template";

export type WebContainerFileChange = {
  path: string;
  content: string;
};

let webcontainerInstance: WebContainer | null = null;
let devProcess: WebContainerProcess | null = null;
let bootedProject = false;
const serverReadyListeners: Array<(url: string) => void> = [];

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

  serverReadyListeners.push(onServerReady);
  webcontainer.on("server-ready", (_port, url) => {
    for (const listener of serverReadyListeners) {
      listener(url);
    }
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
  if (!devProcess) {
    return;
  }
  devProcess.kill();
  await devProcess.exit.catch(() => 1);
  devProcess = null;
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
  devProcess = await webcontainer.spawn("npm", ["run", "dev"]);
  void pipeProcessOutput(devProcess, onLog);
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
