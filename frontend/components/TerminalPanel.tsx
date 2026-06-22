"use client";

import { useEffect, useRef, useState } from "react";

import {
  getTerminalHistory,
  installBackendPackages,
  recordTerminalHistory,
  type TerminalHistoryEntry,
} from "@/lib/api";
import {
  installPackageInWebContainer,
  restartWebContainerDevServer,
  runWebContainerCommand,
  stopWebContainerDevServer,
  type InteractiveCommand,
} from "@/lib/webcontainer/runtime";

type TerminalPanelProps = {
  projectId: string | null;
  onServerReady: (url: string) => void;
  compact?: boolean;
};

export function TerminalPanel({ projectId, onServerReady, compact = false }: TerminalPanelProps) {
  const terminalRef = useRef<HTMLDivElement | null>(null);
  const terminalInstanceRef = useRef<{ write: (data: string) => void; writeln: (data: string) => void; dispose: () => void } | null>(null);
  const fitAddonRef = useRef<{ fit: () => void } | null>(null);
  const activeCommandRef = useRef<InteractiveCommand | null>(null);
  const [command, setCommand] = useState("npm run build");
  const [sessions, setSessions] = useState([{ id: "default", name: "Terminal 1", cwd: "/" }]);
  const [activeSessionId, setActiveSessionId] = useState("default");
  const [packageSpec, setPackageSpec] = useState("");
  const [history, setHistory] = useState<TerminalHistoryEntry[]>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const activeSession = sessions.find((session) => session.id === activeSessionId) ?? sessions[0];
  const activeHistory = history.filter((item) => item.session_id === activeSessionId);

  useEffect(() => {
    let disposed = false;
    async function bootTerminal() {
      const [{ Terminal }, { FitAddon }] = await Promise.all([
        import("@xterm/xterm"),
        import("@xterm/addon-fit"),
      ]);
      if (disposed || !terminalRef.current) {
        return;
      }
      const terminal = new Terminal({
        convertEol: true,
        cursorBlink: true,
        fontSize: 12,
        theme: { background: "#09090b", foreground: "#f4f4f5" },
      });
      const fitAddon = new FitAddon();
      terminal.loadAddon(fitAddon);
      terminal.open(terminalRef.current);
      fitAddon.fit();
      terminal.writeln("WebContainer terminal ready.");
      terminalInstanceRef.current = terminal;
      fitAddonRef.current = fitAddon;
    }

    void bootTerminal();
    const onResize = () => fitAddonRef.current?.fit();
    window.addEventListener("resize", onResize);
    return () => {
      disposed = true;
      window.removeEventListener("resize", onResize);
      terminalInstanceRef.current?.dispose();
      terminalInstanceRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!projectId) {
      return;
    }
    getTerminalHistory(projectId).then(setHistory).catch(() => undefined);
  }, [projectId]);

  async function runCommand() {
    if (!projectId || !command.trim()) {
      return;
    }
    const [cmd, ...args] = command.trim().split(/\s+/);
    let output = "";
    setRunning(true);
    setError(null);
    terminalInstanceRef.current?.writeln(`$ ${command}`);
    try {
      const active = await runWebContainerCommand({
        command: cmd,
        args,
        onOutput: (line) => {
          output += line;
          terminalInstanceRef.current?.write(line);
        },
      });
      activeCommandRef.current = active;
      const exitCode = await active.exit;
      terminalInstanceRef.current?.writeln(`\n[exit ${exitCode}]`);
      const nextHistory = await recordTerminalHistory(projectId, {
        command: cmd,
        args,
        session_id: activeSession.id,
        cwd: activeSession.cwd,
        exit_code: exitCode,
        output,
      });
      setHistory(nextHistory);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Command failed");
    } finally {
      activeCommandRef.current = null;
      setRunning(false);
    }
  }

  function createSession() {
    const id = `session-${Date.now()}`;
    setSessions((current) => [...current, { id, name: `Terminal ${current.length + 1}`, cwd: "/" }]);
    setActiveSessionId(id);
    terminalInstanceRef.current?.writeln(`\n[new session ${id}]`);
  }

  async function installPackage() {
    if (!projectId || !packageSpec.trim()) {
      return;
    }
    const packages = packageSpec.trim().split(/\s+/);
    setRunning(true);
    setError(null);
    try {
      terminalInstanceRef.current?.writeln(`$ npm install ${packages.join(" ")}`);
      const exitCode = await installPackageInWebContainer(packages, (line) => terminalInstanceRef.current?.write(line));
      await installBackendPackages(projectId, packages);
      terminalInstanceRef.current?.writeln(`\n[exit ${exitCode}]`);
      setHistory(await getTerminalHistory(projectId));
      setPackageSpec("");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Package install failed");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className={compact ? "overflow-hidden bg-white" : "overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm"}>
      <div className={`flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between ${compact ? "pb-3" : "border-b border-zinc-200 px-4 py-3"}`}>
        <div>
          <h2 className="text-sm font-medium text-zinc-800">Terminal</h2>
          <p className="mt-1 text-xs text-zinc-500">Advanced tools for running WebContainer commands, restarting the dev server, and installing dependencies when needed.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={createSession} className="rounded-lg border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50">
            New session
          </button>
          <button type="button" onClick={() => void restartWebContainerDevServer({ onLog: (line) => terminalInstanceRef.current?.write(line), onServerReady })} className="rounded-lg border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50">
            Restart dev server
          </button>
          <button type="button" onClick={() => void stopWebContainerDevServer()} className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50">
            Stop
          </button>
        </div>
      </div>
      <div className={compact ? "space-y-3" : "space-y-3 p-4"}>
        <div className="flex flex-wrap gap-2">
          {sessions.map((session) => (
            <button
              key={session.id}
              type="button"
              onClick={() => setActiveSessionId(session.id)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium ${
                session.id === activeSessionId ? "bg-zinc-900 text-white" : "border border-zinc-200 text-zinc-700"
              }`}
            >
              {session.name} · {session.cwd}
            </button>
          ))}
        </div>
        <div ref={terminalRef} className="h-64 overflow-hidden rounded-lg bg-zinc-950 p-2" />
        <div className="flex flex-col gap-2 sm:flex-row">
          <input value={command} onChange={(event) => setCommand(event.target.value)} className="flex-1 rounded-lg border border-zinc-200 px-3 py-2 text-sm" placeholder="npm run build" disabled={!projectId || running} />
          <button type="button" onClick={() => void runCommand()} disabled={!projectId || running || !command.trim()} className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:bg-zinc-400">
            {running ? "Running..." : "Run"}
          </button>
        </div>
        <details className="rounded-lg border border-zinc-200 bg-zinc-50">
          <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-zinc-700">
            Advanced package install
          </summary>
          <div className="space-y-2 p-3">
            <p className="text-xs leading-5 text-zinc-500">
              In normal flows, dependencies should be declared by the AI diff review before installation. This is an advanced debugging tool.
            </p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <input value={packageSpec} onChange={(event) => setPackageSpec(event.target.value)} className="flex-1 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm" placeholder="npm package, e.g. lucide-react" disabled={!projectId || running} />
              <button type="button" onClick={() => void installPackage()} disabled={!projectId || running || !packageSpec.trim()} className="rounded-lg border border-zinc-200 bg-white px-4 py-2 text-sm font-medium text-zinc-700 disabled:text-zinc-400">
                Install package
              </button>
            </div>
          </div>
        </details>
        {error ? <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div> : null}
        {history.length > 0 ? (
          <details className="rounded-lg border border-zinc-200 bg-zinc-50">
            <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-zinc-700">Command history</summary>
            <div className="max-h-40 space-y-2 overflow-auto p-3">
              {activeHistory.slice(0, 12).map((item) => (
                <div key={item.id} className="font-mono text-xs text-zinc-600">
                  [{item.cwd}] {item.command} {item.args.join(" ")} <span className="text-zinc-400">exit {item.exit_code ?? "-"}</span>
                </div>
              ))}
            </div>
          </details>
        ) : null}
      </div>
    </div>
  );
}
