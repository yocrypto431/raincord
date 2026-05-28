/*
 * RAINCORD — MultiInstance native.ts
 *
 * Injeção do token: método robusto via setPreloads da session.
 * Criamos um script de pré-carregamento TEMPORÁRIO em um arquivo que
 * passamos para ses.setPreloads([...]) — este script é executado no
 * main world ANTES de qualquer JS da página, garantindo que
 * localStorage.token esteja definido antes que o Discord o leia.
 */

import { BrowserWindow, screen, session, nativeImage, app, ipcMain } from "electron";
import { writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import { registerMediaPermissionsForSession } from "../../raincord/main/mediaPermissions";

const openWindows = new Map<string, BrowserWindow>();

// ─────────────────────────────────────────────────────────────────────────────
// Intercepta os IPC de controle de janela para uma instância multi.
//
// O Discord nativo usa ipcMain.handle("DISCORD_WINDOW_CLOSE" | "DISCORD_WINDOW_MINIMIZE" | ...)
// Esses handlers são registrados GLOBALMENTE pelo Discord no ipcMain, então eles
// capturam todos os eventos de todas as janelas e chamam injectedGetWindow(key)
// que sempre retorna a janela principal.
//
// Para contornar isso, usamos webContents.ipc.handle no webContents
// de cada janela multi-instance — esses handlers são LOCAIS a esse webContents
// e têm prioridade sobre os handlers globais ipcMain para esse sender.
// ─────────────────────────────────────────────────────────────────────────────

function registerWindowControlIpc(win: BrowserWindow): () => void {
    const wc = win.webContents as any; // webContents.ipc existe desde o Electron 20

    // Canais Discord nativo (descobertos em _core_extracted/bundle.js)
    const CLOSE     = "DISCORD_WINDOW_CLOSE";
    const MINIMIZE  = "DISCORD_WINDOW_MINIMIZE";
    const MAXIMIZE  = "DISCORD_WINDOW_MAXIMIZE";
    const RESTORE   = "DISCORD_WINDOW_RESTORE";
    const FULLSCREEN = "DISCORD_WINDOW_TOGGLE_FULLSCREEN";

    // webContents.ipc.handle é prioritário sobre ipcMain.handle para esse sender
    const handleClose     = () => { if (!win.isDestroyed()) win.close(); };
    const handleMinimize  = () => { if (!win.isDestroyed()) win.minimize(); };
    const handleMaximize  = () => {
        if (win.isDestroyed()) return;
        if (win.isMaximized()) win.unmaximize(); else win.maximize();
    };
    const handleRestore   = () => { if (!win.isDestroyed()) win.restore(); };
    const handleFullscreen = () => { if (!win.isDestroyed()) win.setFullScreen(!win.isFullScreen()); };

    try {
        // webContents.ipc.handle (Electron 20+)
        wc.ipc.handle(CLOSE,      handleClose);
        wc.ipc.handle(MINIMIZE,   handleMinimize);
        wc.ipc.handle(MAXIMIZE,   handleMaximize);
        wc.ipc.handle(RESTORE,    handleRestore);
        wc.ipc.handle(FULLSCREEN, handleFullscreen);
    } catch {
        // Fallback : ipcMain.handle global com filtro no sender
        // (menos limpo mas funciona no Electron < 20)
        //
        // IMPORTANTE: DISCORD_WINDOW_TOGGLE_FULLSCREEN já está registrado globalmente
        // pelo patcher principal. Não re-registramos aqui para evitar
        // "Attempted to register a second handler" que crasha o Discord na inicialização.
        const guardedHandle = (fn: () => void) => (event: Electron.IpcMainInvokeEvent) => {
            if (BrowserWindow.fromWebContents(event.sender) !== win) return;
            fn();
        };
        // removeHandler primeiro para evitar o crash em caso de chamada dupla
        ipcMain.removeHandler(CLOSE);
        ipcMain.removeHandler(MINIMIZE);
        ipcMain.removeHandler(MAXIMIZE);
        ipcMain.removeHandler(RESTORE);
        // NÃO registrar FULLSCREEN - gerenciado globalmente pelo patcher
        ipcMain.handle(CLOSE,     guardedHandle(handleClose));
        ipcMain.handle(MINIMIZE,  guardedHandle(handleMinimize));
        ipcMain.handle(MAXIMIZE,  guardedHandle(handleMaximize));
        ipcMain.handle(RESTORE,   guardedHandle(handleRestore));
        return () => {
            ipcMain.removeHandler(CLOSE);
            ipcMain.removeHandler(MINIMIZE);
            ipcMain.removeHandler(MAXIMIZE);
            ipcMain.removeHandler(RESTORE);
        };
    }

    // Retorna a limpeza para webContents.ipc
    return () => {
        try {
            wc.ipc.removeHandler(CLOSE);
            wc.ipc.removeHandler(MINIMIZE);
            wc.ipc.removeHandler(MAXIMIZE);
            wc.ipc.removeHandler(RESTORE);
            wc.ipc.removeHandler(FULLSCREEN);
        } catch { }
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// Cria o script de pré-carregamento que injeta o token
// ─────────────────────────────────────────────────────────────────────────────

function createTokenPreload(token: string): string {
    // Diretório temporário em userData
    const dir = join(app.getPath("userData"), "RAINCORD-mi-preloads");
    mkdirSync(dir, { recursive: true });

    const safeToken = JSON.stringify(token); // escapa corretamente o token

    const script = `
// RAINCORD MultiInstance — token preload
// Executado no main world ANTES do Discord
(function() {
    const TOKEN = ${safeToken};
    try {
        // Define o token no localStorage
        Object.defineProperty(window, '__RAINCORD_token', { value: TOKEN, writable: false });

        // Patch localStorage.getItem para sempre retornar o token se solicitado
        const _origGetItem = Storage.prototype.getItem;
        const _origSetItem = Storage.prototype.setItem;

        Storage.prototype.getItem = function(key) {
            if (this === localStorage && key === "token") {
                return JSON.stringify(TOKEN);
            }
            return _origGetItem.call(this, key);
        };

        // Pré-preenche também
        try { localStorage.setItem("token", JSON.stringify(TOKEN)); } catch(_) {}

        console.log("[RAINCORDMI] Token preload active ✓");
    } catch(e) {
        console.warn("[RAINCORDMI] Preload error:", e);
    }
})();
`;

    const filePath = join(dir, `token-preload-${Date.now()}.js`);
    writeFileSync(filePath, script, "utf-8");
    return filePath;
}

// ─────────────────────────────────────────────────────────────────────────────
// Abre uma nova janela Discord isolada
// ─────────────────────────────────────────────────────────────────────────────

// Contador de ícones detached: rotaciona de 1 a 5
let iconCounter = 1;

// Caminho para o diretório de ícones detached (multi-instance-icons/ no dist)
function getDetachedIconDir(): string {
    // Em produção: {app_dir}/multi-instance-icons/
    // Em dev: Desktop/lolll/
    const exeDir = join(process.execPath, "..")
    const prodDir = join(exeDir, "multi-instance-icons");
    if (existsSync(prodDir)) return prodDir;
    // Fallback dev : Desktop/lolll
    const desktopDir = join(app.getPath("desktop"), "lolll");
    if (existsSync(desktopDir)) return desktopDir;
    return prodDir;
}

export async function openInstanceWindow(
    _: any,
    token: string,
    userId: string,
    detached = false,
    username = ""
): Promise<{ ok: boolean; error?: string; }> {
    try {
        // Janela já aberta -> focus
        const existing = openWindows.get(userId);
        if (existing && !existing.isDestroyed()) {
            existing.show();
            existing.focus();
            return { ok: true };
        }

        // ID único por instância - Windows agrupa as janelas por AppUserModelId
        // Dando um ID diferente a cada janela, elas não se agrupam
        const uniqueAppId = `RAINCORD.instance.${userId}.${Date.now()}`;

        // Ícone: rotação 1→2→3→4→5→1→... de multi-instance-icons/
        let currentIconPath = "";
        const iconDir = getDetachedIconDir();
        currentIconPath = join(iconDir, `${iconCounter}.ico`);
        if (!existsSync(currentIconPath)) currentIconPath = "";
        iconCounter = iconCounter >= 5 ? 1 : iconCounter + 1;

        // Session Electron isolada por userId
        const partition = `persist:RAINCORD-mi-${userId}`;
        const ses = session.fromPartition(partition, { cache: true });

        ses.webRequest.onHeadersReceived((details, callback) => {
            const headers = { ...details.responseHeaders };
            for (const key of Object.keys(headers)) {
                const low = key.toLowerCase();
                if (low === "content-security-policy" || low === "permissions-policy" || low === "feature-policy") {
                    delete headers[key];
                }
            }
            callback({ responseHeaders: headers });
        });

        registerMediaPermissionsForSession(ses);

        const preloadPath = createTokenPreload(token);
        ses.setPreloads([preloadPath]);

        const win = new BrowserWindow({
            width: 1280,
            height: 800,
            minWidth: 940,
            minHeight: 500,
            parent: undefined,
            skipTaskbar: false,
            frame: false,
            transparent: false,
            titleBarStyle: "hidden",
            autoHideMenuBar: true,
            darkTheme: true,
            backgroundColor: "#313338",
            title: `RAINCORD [${username || userId}]`,
            icon: currentIconPath || undefined,
            webPreferences: {
                preload: join(__dirname, "preload.js"),
                contextIsolation: true,
                nodeIntegration: false,
                sandbox: false,
                session: ses,
                webSecurity: false,
            },
        });

        // CRÍTICO: setAppDetails DEVE ser chamado imediatamente após new BrowserWindow,
        // antes que a janela seja exibida. É isso que impede o Windows de agrupar
        // as janelas juntas na barra de tarefas.
        if (process.platform === "win32") {
            try {
                win.setAppDetails({
                    appId: uniqueAppId,
                    appIconPath: currentIconPath || undefined,
                    relaunchDisplayName: `RAINCORD [${username || userId}]`,
                });
            } catch (err) {
                console.warn("[RAINCORDMI] setAppDetails failed:", err);
            }
        }

        openWindows.set(userId, win);

        win.on("enter-html-full-screen", () => {
            win.setFullScreen(true);
        });
        win.on("leave-html-full-screen", () => {
            win.setFullScreen(false);
        });

        // Antes de fechar: desregistra os service workers e corta o gateway
        // para parar todas as notificações push
        win.on("close", () => {
            wc.executeJavaScript(`
                (async () => {
                    try {
                        const regs = await navigator.serviceWorker.getRegistrations();
                        for (const r of regs) await r.unregister();
                    } catch(e) {}
                    try {
                        // Corta a conexão gateway do Discord
                        const ws = window.__RAINCORD_GW_WS__;
                        if (ws && ws.readyState <= 1) ws.close(4000, 'window_close');
                    } catch(e) {}
                })();
            `).catch(() => {});
        });

        // Registra os handlers IPC de controle de janela (DISCORD_WINDOW_*) neste webContents
        // Deve ser feito ANTES que o Discord carregue seu JS (dom-ready)
        const wc = win.webContents;
        const cleanupIpc = registerWindowControlIpc(win);

        win.once("closed", () => {
            cleanupIpc();
            openWindows.delete(userId);
            // Limpa os service workers da sessão para cortar definitivamente as notificações
            ses.clearStorageData({ storages: ["serviceworkers"] }).catch(() => {});
        });

        // Flash quando há notificações
        wc.on("page-title-updated", (e, title) => {
            if (process.platform === "win32") {
                if (/^\(\d+\)/.test(title)) win.flashFrame(true);
                else win.flashFrame(false);
            }
        });

        // Injeção do token
        const safeToken = JSON.stringify(token);
        const injectJs = `(function(){ try { localStorage.setItem("token", ${safeToken}); } catch(e) {} })();`;
        wc.on("dom-ready", () => wc.executeJavaScript(injectJs).catch(() => { }));
        wc.on("did-finish-load", () => wc.executeJavaScript(injectJs).catch(() => { }));
        wc.on("did-navigate", () => wc.executeJavaScript(injectJs).catch(() => { }));

        // Título da janela
        wc.on("page-title-updated", (e, title) => {
            const cleanTitle = title.replace(/^\(\d+\)\s*/, "").replace(/\s*\[.*\]$/, "");
            win.setTitle(`${cleanTitle} [${username || userId}]`);
            e.preventDefault();
        });

        wc.on("will-navigate", (e, url) => {
            if (!/^https:\/\/(ptb\.|canary\.)?discord\.com/.test(url)) e.preventDefault();
        });

        wc.setWindowOpenHandler(({ url }) => {
            if (url.startsWith("http")) require("electron").shell.openExternal(url);
            return { action: "deny" };
        });

        await win.loadURL("https://discord.com/channels/@me");
        return { ok: true };
    } catch (e: any) {
        return { ok: false, error: e?.message ?? String(e) };
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Janelas « agrupadas » — mesmo grupo que RAINCORD na barra de tarefas
// Princípio: não tocamos em setAppDetails => a janela herda o AppId
// do processo principal (com.RAINCORD.app), o Windows a agrupa automaticamente
// ─────────────────────────────────────────────────────────────────────────────

const openGroupedWindows = new Map<string, BrowserWindow>();

export async function openInstanceWindowGrouped(
    _: any,
    token: string,
    userId: string,
    username = ""
): Promise<{ ok: boolean; error?: string; }> {
    try {
        // Focus se já aberta
        const existing = openGroupedWindows.get(userId);
        if (existing && !existing.isDestroyed()) {
            existing.show();
            existing.focus();
            return { ok: true };
        }

        // Sessão isolada por userId
        const partition = `persist:RAINCORD-mi-${userId}`;
        const ses = session.fromPartition(partition, { cache: true });

        ses.webRequest.onHeadersReceived((details, callback) => {
            const headers = { ...details.responseHeaders };
            for (const key of Object.keys(headers)) {
                const low = key.toLowerCase();
                if (low === "content-security-policy" || low === "permissions-policy" || low === "feature-policy") {
                    delete headers[key];
                }
            }
            callback({ responseHeaders: headers });
        });

        registerMediaPermissionsForSession(ses);

        const preloadPath = createTokenPreload(token);
        ses.setPreloads([preloadPath]);

        const win = new BrowserWindow({
            width: 1280,
            height: 800,
            minWidth: 940,
            minHeight: 500,
            parent: undefined,
            skipTaskbar: false,
            frame: false,
            transparent: false,
            titleBarStyle: "hidden",
            autoHideMenuBar: true,
            darkTheme: true,
            backgroundColor: "#313338",
            title: `RAINCORD [${username || userId}]`,
            webPreferences: {
                preload: join(__dirname, "preload.js"),
                contextIsolation: true,
                nodeIntegration: false,
                sandbox: false,
                session: ses,
                webSecurity: false,
            },
        });

        openGroupedWindows.set(userId, win);

        win.on("enter-html-full-screen", () => {
            win.setFullScreen(true);
        });
        win.on("leave-html-full-screen", () => {
            win.setFullScreen(false);
        });

        // Antes de fechar: desregistra os service workers e corta o gateway
        win.on("close", () => {
            wc.executeJavaScript(`
                (async () => {
                    try {
                        const regs = await navigator.serviceWorker.getRegistrations();
                        for (const r of regs) await r.unregister();
                    } catch(e) {}
                    try {
                        const ws = window.__RAINCORD_GW_WS__;
                        if (ws && ws.readyState <= 1) ws.close(4000, 'window_close');
                    } catch(e) {}
                })();
            `).catch(() => {});
        });

        // Registra os handlers IPC de controle de janela para esta instância agrupada
        const wc = win.webContents;
        const cleanupIpc = registerWindowControlIpc(win);

        win.once("closed", () => {
            cleanupIpc();
            openGroupedWindows.delete(userId);
            ses.clearStorageData({ storages: ["serviceworkers"] }).catch(() => {});
        });

        wc.on("page-title-updated", (e, title) => {
            if (process.platform === "win32") {
                if (/^\(\d+\)/.test(title)) win.flashFrame(true);
                else win.flashFrame(false);
            }
        });

        const safeToken = JSON.stringify(token);
        const injectJs = `(function(){ try { localStorage.setItem("token", ${safeToken}); } catch(e) {} })();`;
        wc.on("dom-ready", () => wc.executeJavaScript(injectJs).catch(() => {}));
        wc.on("did-finish-load", () => wc.executeJavaScript(injectJs).catch(() => {}));
        wc.on("did-navigate", () => wc.executeJavaScript(injectJs).catch(() => {}));

        wc.on("page-title-updated", (e, title) => {
            const cleanTitle = title.replace(/^\(\d+\)\s*/, "").replace(/\s*\[.*\]$/, "");
            win.setTitle(`${cleanTitle} [${username || userId}]`);
            e.preventDefault();
        });

        wc.on("will-navigate", (e, url) => {
            if (!/^https:\/\/(ptb\.|canary\.)?discord\.com/.test(url)) e.preventDefault();
        });

        wc.setWindowOpenHandler(({ url }) => {
            if (url.startsWith("http")) require("electron").shell.openExternal(url);
            return { action: "deny" };
        });

        await win.loadURL("https://discord.com/channels/@me");
        return { ok: true };
    } catch (e: any) {
        return { ok: false, error: e?.message ?? String(e) };
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Split screen: posiciona as duas janelas lado a lado
// ─────────────────────────────────────────────────────────────────────────────

export async function arrangeSplit(_: any, userId: string): Promise<void> {
    try {
        const secondWin = openWindows.get(userId);
        if (!secondWin || secondWin.isDestroyed()) return;

        const allWins = BrowserWindow.getAllWindows();
        const mainWin = allWins.find(w => w !== secondWin && !w.isDestroyed());
        if (!mainWin) return;

        const display = screen.getDisplayMatching(mainWin.getBounds());
        const { x, y, width, height } = display.workArea;
        const half = Math.floor(width / 2);

        mainWin.setBounds({ x, y, width: half, height }, true);
        secondWin.setBounds({ x: x + half, y, width: width - half, height }, true);
        secondWin.show();
        secondWin.focus();
    } catch (e) {
        console.error("[RAINCORDMI] arrangeSplit error:", e);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Lista / fecha as instâncias
// ─────────────────────────────────────────────────────────────────────────────

export async function getOpenInstances(_: any): Promise<string[]> {
    return [...openWindows.entries()]
        .filter(([, w]) => !w.isDestroyed())
        .map(([id]) => id);
}

export async function closeInstance(_: any, userId: string): Promise<void> {
    const win = openWindows.get(userId);
    if (win && !win.isDestroyed()) win.close();
}
