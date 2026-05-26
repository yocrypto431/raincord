"use strict";
const path = require("path");
const Module = require("module");
const fs = require("fs");
const { app } = require("electron");

const RAINCORDData = path.join(app.getPath("appData"), "RainCord");
app.setPath("userData", RAINCORDData);

app.setAppUserModelId("com.squirrel.Discord.Discord");

app.commandLine.appendSwitch("enable-features", "WebRTCPipeWireCapturer");

app.once("ready", () => {
    try {
        const BLOCKED_MODULES = new Set([
            "discord_rpc",
            "discord_dispatch",
            "discord_erinn",
        ]);

        const { session } = require("electron");

        app.once("browser-window-created", () => {
            try {
                const ses = session.defaultSession;
                ses.webRequest.onBeforeRequest(
                    { urls: ["https://discord.com/api/modules/*"] },
                    (details, callback) => {
                        const url = details.url;
                        const isBlocked = Array.from(BLOCKED_MODULES).some(m => url.includes(m));
                        if (isBlocked) {
                            console.log("[RAINCORD] Módulo bloqueado (inútil para RAINCORD):", url.split("/").slice(-2).join("/"));
                            callback({ cancel: true });
                        } else {
                            callback({});
                        }
                    }
                );
                console.log("[RAINCORD] Filtro de módulos 403 ativado ✓");
            } catch (e) {
                console.warn("[RAINCORD] Não foi possível ativar filtro de módulos:", e.message);
            }
        });
    } catch (e) {
        console.warn("[RAINCORD] FIX módulos 403 falhou:", e.message);
    }
});

try {
    const lsPath = path.join(RAINCORDData, "Local Storage", "leveldb");
    if (fs.existsSync(lsPath)) {
        const lockFile = path.join(lsPath, "LOCK");
        let corrupted = false;
        if (fs.existsSync(lockFile)) {
            try {
                const fd = fs.openSync(lockFile, "r+");
                fs.closeSync(fd);
            } catch (e) {
                try { fs.unlinkSync(lockFile); } catch { }
                corrupted = true;
            }
        }
        if (!corrupted) {
            const files = fs.readdirSync(lsPath).filter(f => f.endsWith(".ldb"));
            for (const f of files) {
                const size = fs.statSync(path.join(lsPath, f)).size;
                if (size === 0) { corrupted = true; break; }
            }
        }
        if (corrupted) {
            console.warn("[RAINCORD] LevelDB localStorage corrompido detectado — reparando...");
            try { fs.rmSync(lsPath, { recursive: true, force: true }); } catch { }
            console.warn("[RAINCORD] LevelDB removido — dados serão recriados");
        }
    }
} catch (e) { console.warn("[RAINCORD] LevelDB check falhou:", e.message); }

const bundledModulesPath = path.join(path.dirname(process.execPath), "modules");
const moduleDataPath = path.join(app.getPath("appData"), "discord", "module_data");

const discordLocalBase = path.join(app.getPath("appData"), "..", "Local", "Discord");
let discordNativeModulesPath = null;
try {
    const entries = fs.readdirSync(discordLocalBase)
        .filter(e => e.startsWith("app-"))
        .map(e => ({ name: e, full: path.join(discordLocalBase, e, "modules") }))
        .filter(e => fs.existsSync(e.full))
        .sort((a, b) => b.name.localeCompare(a.name, undefined, { numeric: true }));
    if (entries.length > 0) {
        discordNativeModulesPath = entries[0].full;
        console.log("[RAINCORD] Módulos nativos do Discord detectados:", discordNativeModulesPath);
    }
} catch (e) {
    console.warn("[RAINCORD] Não foi possível detectar módulos nativos do Discord:", e.message);
}

function addGlobalPath(p) {
    try { if (fs.existsSync(p) && !Module.globalPaths.includes(p)) Module.globalPaths.push(p); } catch (_) { }
}

addGlobalPath(bundledModulesPath);

if (discordNativeModulesPath) {
    addGlobalPath(discordNativeModulesPath);
    try {
        for (const mod of fs.readdirSync(discordNativeModulesPath)) {
            const modDir = path.join(discordNativeModulesPath, mod);
            if (!fs.existsSync(modDir) || !fs.statSync(modDir).isDirectory()) continue;
            addGlobalPath(modDir);
            for (const sub of fs.readdirSync(modDir)) {
                const subDir = path.join(modDir, sub);
                if (fs.existsSync(subDir) && fs.statSync(subDir).isDirectory()) addGlobalPath(subDir);
            }
        }
    } catch (e) { console.warn("[RAINCORD] Erro ao escanear módulos nativos:", e.message); }
}
try {
    for (const mod of fs.readdirSync(bundledModulesPath)) {
        const modDir = path.join(bundledModulesPath, mod);
        if (!fs.existsSync(modDir) || !fs.statSync(modDir).isDirectory()) continue;
        addGlobalPath(modDir);
        for (const ver of fs.readdirSync(modDir)) {
            const verDir = path.join(modDir, ver);
            if (fs.existsSync(verDir) && fs.statSync(verDir).isDirectory()) addGlobalPath(verDir);
        }
    }
} catch (e) { }

addGlobalPath(moduleDataPath);
try {
    for (const mod of fs.readdirSync(moduleDataPath)) {
        const modDir = path.join(moduleDataPath, mod);
        if (!fs.statSync(modDir).isDirectory()) continue;
        addGlobalPath(modDir);
        for (const ver of fs.readdirSync(modDir)) {
            const verDir = path.join(modDir, ver);
            if (fs.existsSync(verDir) && fs.statSync(verDir).isDirectory()) addGlobalPath(verDir);
        }
    }
} catch (e) { }

const _globalPathsSet = new Set(Module.globalPaths);
const _origResolve = Module._resolveLookupPaths;
Module._resolveLookupPaths = function (request, parent) {
    if (parent) {
        if (!parent.paths) parent.paths = [..._globalPathsSet];
        else if (parent.paths.length > 0) {
            for (const p of _globalPathsSet) {
                if (!parent.paths.includes(p)) parent.paths.push(p);
            }
        }
    }
    return _origResolve.call(this, request, parent);
};

const coreModuleDir = path.join(bundledModulesPath, "discord_desktop_core-1", "discord_desktop_core");
const coreModuleDirNative = discordNativeModulesPath
    ? path.join(discordNativeModulesPath, "discord_desktop_core-1", "discord_desktop_core")
    : null;
global.mainAppDirname = fs.existsSync(coreModuleDir)
    ? coreModuleDir
    : (coreModuleDirNative && fs.existsSync(coreModuleDirNative))
        ? coreModuleDirNative
        : path.join(moduleDataPath, "discord_desktop_core");
console.log("[RAINCORD] mainAppDirname:", global.mainAppDirname);

try {
    const buildInfoPath = path.join(
        path.dirname(process.execPath), "resources", "build_info.json"
    );
    const buildInfoRaw = fs.readFileSync(buildInfoPath, "utf-8");
    const buildInfo = JSON.parse(buildInfoRaw);
    const nativeModulesDir = path.join(path.dirname(process.execPath), "modules");
    if (fs.existsSync(nativeModulesDir) && !buildInfo.localModulesRoot) {
        buildInfo.localModulesRoot = nativeModulesDir;
        fs.writeFileSync(buildInfoPath, JSON.stringify(buildInfo, null, 2));
        console.log("[RAINCORD] build_info.json corrigido → localModulesRoot:", nativeModulesDir);
    }
} catch (e) {
    console.warn("[RAINCORD] Não foi possível corrigir build_info.json:", e.message);
}

require(path.join(__dirname, "dist", "desktop", "patcher.js"));
