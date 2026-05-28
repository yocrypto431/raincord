/*
 * GhostClient native.ts — main process Electron
 * Inicia ghost-server via node.exe empacotado no RAINCORD-dist
 * Comunicação via HTTP localhost:47821
 */

import { app, shell, ipcMain } from "electron";
import * as childProcess from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as http from "http";

// Handler IPC para abrir URLs externas (usado pelo RAINCORDUpdater)
ipcMain.handle("RAINCORD_OPEN_URL", (_event, url: string) => {
    if (typeof url === "string" && url.startsWith("https://")) {
        shell.openExternal(url);
    }
});

const PORT = 47821;
let serverProc: childProcess.ChildProcess | null = null;
let serverReady = false;
let startPromise: Promise<boolean> | null = null;

// ── Encontrar ghost-server/server.js ────────────────────────────────────────────
function findServerScript(): string | null {
    const execDir = path.dirname(process.execPath);
    const resPath = (process as any).resourcesPath ?? "";
    const candidates = [
        // Production Electron : resources/ghost-server/server.js
        path.join(resPath, "ghost-server", "server.js"),
        // Production Electron (com app.asar descompactado) : resources/app/ghost-server/server.js
        path.join(resPath, "app", "ghost-server", "server.js"),
        // Production : exe + resources/ subpasta
        path.join(execDir, "resources", "ghost-server", "server.js"),
        path.join(execDir, "resources", "app", "ghost-server", "server.js"),
        // Portable (dist/desktop extraído) : exe em dist/desktop, ghost-server ao lado
        path.join(execDir, "ghost-server", "server.js"),
        // dev-inject : __dirname = dist/desktop/renderer
        path.join(__dirname, "..", "..", "ghost-server", "server.js"),
        path.join(__dirname, "..", "..", "..", "ghost-server", "server.js"),
        path.join(__dirname, "..", "..", "..", "..", "ghost-server", "server.js"),
        // Raiz do repo em dev
        path.join(resPath, "..", "ghost-server", "server.js"),
    ];
    console.log("[GhostNative] execPath:", process.execPath);
    console.log("[GhostNative] resourcesPath:", resPath);
    console.log("[GhostNative] __dirname:", __dirname);
    for (const c of candidates) {
        console.log("[GhostNative] test:", c, fs.existsSync(c) ? "✓" : "✗");
        if (fs.existsSync(c)) { console.log("[GhostNative] server.js encontrado:", c); return c; }
    }
    console.error("[GhostNative] server.js não encontrado! Candidatos testados:", candidates.length);
    return null;
}

function findNode(): string {
    const execDir = path.dirname(process.execPath);
    const resPath = (process as any).resourcesPath ?? "";
    const candidates = [
        // Production Electron : node.exe copiado ao lado do .exe Discord
        path.join(execDir, "node.exe"),
        // Production : em resources/ (collect-assets copia lá)
        path.join(resPath, "node.exe"),
        path.join(resPath, "..", "node.exe"),
        path.join(resPath, "app", "node.exe"),
        // Na subpasta resources/
        path.join(execDir, "resources", "node.exe"),
        path.join(execDir, "resources", "app", "node.exe"),
        // Portable : dist/desktop contém node.exe, __dirname sobe até dist/desktop
        path.join(__dirname, "..", "..", "node.exe"),
        path.join(__dirname, "..", "..", "..", "node.exe"),
        // NVM for Windows
        path.join(process.env.LOCALAPPDATA ?? "", "nvm", "nodejs", "node.exe"),
        "C:\\nvm4w\\nodejs\\node.exe",
        "C:\\Program Files\\nodejs\\node.exe",
        "C:\\Program Files (x86)\\nodejs\\node.exe",
        path.join(process.env.LOCALAPPDATA ?? "", "Programs", "nodejs", "node.exe"),
    ];
    for (const c of candidates) {
        if (fs.existsSync(c)) { console.log("[GhostNative] node.exe encontrado:", c); return c; }
    }
    console.warn("[GhostNative] node.exe empacotado não encontrado, fallback para 'node' do PATH");
    return "node";
}

function ping(): Promise<boolean> {
    return new Promise(resolve => {
        const req = http.get(`http://127.0.0.1:${PORT}/status`, res => {
            resolve(res.statusCode === 200);
        });
        req.setTimeout(1500, () => { req.destroy(); resolve(false); });
        req.on("error", () => resolve(false));
    });
}

async function killZombieServer(): Promise<void> {
    // Se um ghost-server zumbi está rodando de um crash anterior, matá-lo corretamente
    try {
        const res = await Promise.race([
            ping(),
            new Promise<boolean>(r => setTimeout(() => r(false), 500))
        ]);
        if (res) {
            // Um servidor responde — verificar se é o nosso ou um zumbi
            if (!serverProc) {
                // Não é nosso processo — é um zumbi do crash anterior
                // Tentamos pará-lo via API HTTP
                try {
                    await new Promise<void>((resolve) => {
                        const req = http.request({ hostname: '127.0.0.1', port: PORT, path: '/shutdown', method: 'POST' }, () => resolve());
                        req.setTimeout(1000, () => { req.destroy(); resolve(); });
                        req.on('error', () => resolve());
                        req.end();
                    });
                } catch { }
                // Fallback : taskkill
                try {
                    childProcess.execSync('taskkill /F /IM node.exe /FI "WINDOWTITLE eq ghost-server"', { stdio: 'ignore' });
                } catch { }
                await new Promise(r => setTimeout(r, 500));
            }
        }
    } catch { }
}

async function ensureServer(): Promise<boolean> {
    if (serverReady && await ping()) return true;
    if (startPromise) return startPromise;

    startPromise = (async () => {
        // Matar os zumbis antes de iniciar
        await killZombieServer();
        if (await ping()) { serverReady = true; return true; }

        const script = findServerScript();
        if (!script) {
            console.error("[GhostNative] server.js não encontrado!");
            startPromise = null;
            return false;
        }

        const nodeExe = findNode();
        const scriptDir = path.dirname(script);
        const nodeModulesPath = path.join(scriptDir, "node_modules");
        console.log(`[GhostNative] Iniciando: ${nodeExe} ${script}`);
        console.log(`[GhostNative] cwd: ${scriptDir}`);
        console.log(`[GhostNative] node_modules exists: ${fs.existsSync(nodeModulesPath)}`);

        serverProc = childProcess.spawn(nodeExe, [script], {
            windowsHide: true,
            stdio: ["ignore", "pipe", "pipe"],
            detached: false,
            cwd: scriptDir,
            env: {
                ...process.env,
            }
        });

        // Limitar os logs do ghost-server no main process Electron
        // Muitos logs = I/O na thread principal = freezes
        // Mas escrevemos em um arquivo de log para depuração
        const logPath = path.join(app.getPath("userData"), "ghost-server.log");
        let logStream: fs.WriteStream | null = null;
        try {
            logStream = fs.createWriteStream(logPath, { flags: "w" });
            logStream.write(`=== GHOST SERVER LOGS STARTED AT ${new Date().toISOString()} ===\n`);
            console.log("[GhostNative] Log file created at:", logPath);
        } catch (e: any) {
            console.error("[GhostNative] Impossível criar o arquivo de log:", e.message);
        }

        let logBuffer = "";
        serverProc.stdout?.on("data", (d: Buffer) => {
            if (logStream) logStream.write(d);
            logBuffer += d.toString();
            const lines = logBuffer.split("\n");
            logBuffer = lines.pop() ?? "";
            for (const line of lines) {
                if (line.trim()) console.log("[GhostServer]", line.trim());
            }
        });
        serverProc.stderr?.on("data", (d: Buffer) => {
            if (logStream) logStream.write(d);
            const msg = d.toString().trim();
            if (msg) console.error("[GhostServer ERR]", msg);
        });
        serverProc.on("exit", (code: number | null) => {
            console.log("[GhostNative] server exit:", code);
            if (logStream) {
                logStream.write(`\n=== GHOST SERVER EXITED WITH CODE ${code} ===\n`);
                logStream.end();
            }
            serverProc = null;
            serverReady = false;
        });
        serverProc.on("error", (e: Error) => {
            console.error("[GhostNative] spawn error:", e.message);
            if (logStream) {
                logStream.write(`\n=== GHOST SERVER SPAWN ERROR: ${e.message} ===\n`);
            }
        });

        // Poll a cada 200ms durante 60s max
        for (let i = 0; i < 300; i++) {
            await new Promise(r => setTimeout(r, 200));
            if (await ping()) {
                console.log("[GhostNative] ghost-server pronto ✓");
                serverReady = true;
                startPromise = null;
                return true;
            }
        }

        console.error("[GhostNative] ghost-server timeout!");
        startPromise = null;
        return false;
    })();

    return startPromise;
}

async function api(endpoint: string, body?: object, timeoutMs = 15000): Promise<any> {
    // FIX : timeout reduzido de 90s → 15s.
    // 90s bloqueava a UI do Discord inteira por quase 2 minutos se o ghost-server
    // não respondesse (ex: yt-dlp em andamento, ffmpeg iniciando).
    // 15s é amplamente suficiente para todas as chamadas rápidas (/connect, /join, /leave).
    // As chamadas lentas (/stream-start) agora são não-bloqueantes no lado do server.js.
    const ok = await ensureServer();
    if (!ok) return { ok: false, error: "ghost-server não encontrado ou timeout" };

    return new Promise((resolve, reject) => {
        const data = body !== undefined ? JSON.stringify(body) : undefined;
        const opts: http.RequestOptions = {
            hostname: "127.0.0.1",
            port: PORT,
            path: endpoint,
            method: body !== undefined ? "POST" : "GET",
            headers: {
                "Content-Type": "application/json",
                ...(data ? { "Content-Length": Buffer.byteLength(data) } : {}),
            },
        };
        const req = http.request(opts, res => {
            let raw = "";
            res.on("data", c => raw += c);
            res.on("end", () => {
                try { resolve(JSON.parse(raw)); }
                catch { resolve({ ok: false, error: "Invalid JSON" }); }
            });
        });
        // FIX : timeout de 15s ao invés de 90s — evita congelar a UI do Discord
        req.setTimeout(timeoutMs, () => { req.destroy(); reject(new Error(`Timeout ${timeoutMs / 1000}s`)); });
        req.on("error", reject);
        if (data) req.write(data);
        req.end();
    });
}

export async function listAudioInputDevices(_: any): Promise<{ label: string; dshowName: string; }[]> {
    // FIX : tentamos o ghost-server PRIMEIRO (rápido, < 1s se disponível).
    // Antes deste fix, se o ghost-server não estivesse pronto, spawnávamos ffmpeg diretamente
    // no main process Electron com um timeout de 8s — o que congelava a UI do Discord
    // por 8 segundos e explicava o "demora muito para carregar" no seletor de tela.
    // Agora: ghost-server em 1s → fallback ffmpeg em 5s max (reduzido de 8s).
    try {
        const ok = await Promise.race([
            ping(),
            new Promise<boolean>(r => setTimeout(() => r(false), 1000))
        ]);
        if (ok) {
            const res = await api("/devices", undefined, 3000);
            if (res?.devices?.length) {
                const names: string[] = res.devices;
                return names.map((n: string) => ({ label: n, dshowName: n }));
            }
        }
    } catch { }

    // Fallback ffmpeg direto — timeout reduzido para 5s (ao invés de 8s)
    return new Promise(resolve => {
        const ghostServerNodeModules = path.join(process.resourcesPath ?? "", "ghost-server", "node_modules");
        const ffmpegCandidates = [
            path.join(path.dirname(process.execPath), "ffmpeg.exe"),
            path.join(process.resourcesPath ?? "", "..", "ffmpeg.exe"),
            // Empacotado via node-av em ghost-server/node_modules (já no installer)
            path.join(ghostServerNodeModules, "node-av", "binary", "ffmpeg.exe"),
            path.join(ghostServerNodeModules, "node_modules", "node-av", "binary", "ffmpeg.exe"),
            "ffmpeg",
        ];
        let ffmpeg = "ffmpeg";
        for (const c of ffmpegCandidates) {
            if (c !== "ffmpeg" && fs.existsSync(c)) { ffmpeg = c; break; }
        }

        try {
            const proc = childProcess.spawn(ffmpeg, [
                "-list_devices", "true", "-f", "dshow", "-i", "dummy", "-hide_banner"
            ], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });

            const chunks: Buffer[] = [];
            proc.stderr?.on("data", (d: Buffer) => chunks.push(d));
            proc.stdout?.on("data", (d: Buffer) => chunks.push(d));

            proc.on("exit", () => {
                // Decodifica UTF-8, fallback latin1 se caracteres de substituição
                // (ffmpeg Windows usa o codepage do sistema, não UTF-8)
                const raw = Buffer.concat(chunks);
                let out = raw.toString("utf8");
                if (out.includes("\ufffd")) out = raw.toString("latin1");
                const names: string[] = [];
                for (const line of out.split(/\r?\n/)) {
                    if (!/\(audio\)/i.test(line) || /Alternative name/i.test(line)) continue;
                    const m = line.match(/"([^"]+)"/);
                    if (!m) continue;
                    const name = m[1].trim();
                    if (!name.startsWith("@") && name.length >= 2 && !names.includes(name))
                        names.push(name);
                }
                resolve(names.map((n: string) => ({ label: n, dshowName: n })));
            });

            proc.on("error", () => resolve([]));
            // FIX : timeout reduzido para 5s (ao invés de 8s) — reduz o freeze da UI em 37%
            setTimeout(() => { try { proc.kill(); } catch { } resolve([]); }, 5000);
        } catch { resolve([]); }
    });
}

export async function connectGhost(
    _: any, userId: string, token: string, guildId: string, channelId: string, micDevice: string,
): Promise<{ ok: boolean; error?: string; }> {
    // O ghost-server aguarda DVS internamente (até 60s) + login (20s) + joinVoice
    // Timeout HTTP de 120s para cobrir o pior caso sem empilhar waitForDVS
    try { return await api("/connect", { userId, token, guildId, channelId, micDevice }, 120000); }
    catch (e: any) { return { ok: false, error: e?.message ?? String(e) }; }
}

export async function preConnectGhost(
    _: any, userId: string, token: string, micDevice: string,
): Promise<{ ok: boolean; error?: string; }> {
    try { return await api("/preconnect", { userId, token, micDevice }, 120000); }
    catch (e: any) { return { ok: false, error: e?.message ?? String(e) }; }
}

export async function joinVoice(
    _: any, userId: string, guildId: string, channelId: string, micDevice: string,
): Promise<{ ok: boolean; error?: string; }> {
    try { return await api("/join", { userId, guildId, channelId, micDevice }); }
    catch (e: any) { return { ok: false, error: e?.message ?? String(e) }; }
}

export async function joinVoiceAll(
    _: any, userIds: string[], guildId: string, channelId: string, micDevice: string,
): Promise<{ ok: boolean; }> {
    try { await api("/join-all", { userIds, guildId, channelId, micDevice }); return { ok: true }; }
    catch { return { ok: false }; }
}

export async function leaveVoiceAll(_: any, userIds: string[]): Promise<void> {
    try { await api("/leave-all", { userIds }); } catch { }
}

export async function leaveVoice(_: any, userId: string): Promise<void> {
    try { await api("/leave", { userId }); } catch { }
}

export async function disconnectGhost(_: any, userId: string): Promise<void> {
    try { await api("/disconnect", { userId }); } catch { }
}

export async function init(_: any): Promise<void> {
    const script = findServerScript();
    console.log("[GhostNative] init — server.js:", script ?? "NÃO ENCONTRADO");
    console.log("[GhostNative] node exe:", findNode());

    const ok = await ensureServer();
    if (!ok) {
        console.error("[GhostNative] ghost-server failed");
        return;
    }
    console.log("[GhostNative] ghost-server HTTP pronto ✓");
}

// ── Cleanup ───────────────────────────────────────────────────────────────────
app.on("before-quit", () => {
    if (serverProc) {
        try { serverProc.kill(); } catch { }
        serverProc = null;
    }
});
