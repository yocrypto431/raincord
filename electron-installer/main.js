const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const fs = require("fs");
const { execSync, execFileSync } = require("child_process");

let mainWindow;

app.whenReady().then(() => {
    mainWindow = new BrowserWindow({
        width: 680,
        height: 520,
        resizable: false,
        frame: false,
        transparent: false,
        backgroundColor: "#0a0f1a",
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
        },
    });

    mainWindow.loadFile("index.html");
});

app.on("window-all-closed", () => app.quit());

// ── IPC Handlers ──────────────────────────────────────────────────────────────

ipcMain.handle("detect-discord", () => {
    const localAppData = process.env.LOCALAPPDATA || "";
    const channels = [
        { name: "Discord", folder: "Discord" },
        { name: "Discord PTB", folder: "DiscordPTB" },
        { name: "Discord Canary", folder: "DiscordCanary" },
        { name: "Discord Development", folder: "DiscordDevelopment" },
    ];

    const results = [];
    for (const ch of channels) {
        const base = path.join(localAppData, ch.folder);
        if (!fs.existsSync(base)) continue;

        const versions = fs.readdirSync(base)
            .filter(d => d.startsWith("app-"))
            .sort()
            .reverse();

        for (const ver of versions) {
            const resources = path.join(base, ver, "resources");
            if (!fs.existsSync(resources)) continue;

            const appDir = path.join(resources, "app");
            const backup = path.join(resources, "_app.asar");
            const appAsar = path.join(resources, "app.asar");

            // Detection: patched if app/ folder has raincord OR if _app.asar backup exists (EquilotlCli method)
            let isPatched = false;
            if (fs.existsSync(appDir) && fs.existsSync(path.join(appDir, "package.json"))) {
                const pkg = fs.readFileSync(path.join(appDir, "package.json"), "utf-8");
                isPatched = pkg.includes("raincord") || pkg.includes("equicord") || pkg.includes("vencord");
            } else if (fs.existsSync(backup)) {
                // EquilotlCli method: _app.asar is the backup, app.asar is the loader
                isPatched = true;
            }

            results.push({
                name: ch.name,
                version: ver.replace("app-", ""),
                path: resources,
                patched: isPatched,
            });
            break; // Only latest version per channel
        }
    }
    return results;
});

ipcMain.handle("inject", async (_, resourcesPath) => {
    try {
        const appDir = path.join(resourcesPath, "app");
        const appAsar = path.join(resourcesPath, "app.asar");
        const backup = path.join(resourcesPath, "_app.asar");

        // Kill Discord
        const procName = resourcesPath.includes("DiscordPTB") ? "DiscordPTB"
            : resourcesPath.includes("DiscordCanary") ? "DiscordCanary"
            : resourcesPath.includes("DiscordDevelopment") ? "DiscordDevelopment"
            : "Discord";
        try { execSync(`taskkill /F /IM ${procName}.exe`, { stdio: "ignore" }); } catch { }
        await new Promise(r => setTimeout(r, 4000));

        // Try to backup app.asar, but don't fail if locked
        // Electron loads app/ folder with priority over app.asar anyway
        if (fs.existsSync(appAsar) && !fs.existsSync(backup)) {
            try {
                fs.renameSync(appAsar, backup);
            } catch {
                // File locked — that's fine, app/ folder takes priority
                console.log("[Installer] app.asar locked, skipping rename — app/ folder will take priority");
            }
        }

        // Create app/ folder with loader
        if (fs.existsSync(appDir)) fs.rmSync(appDir, { recursive: true, force: true });
        fs.mkdirSync(appDir, { recursive: true });

        // Find patcher.js - embedded in resources (inside the exe)
        const resourcesDir = process.resourcesPath;
        const patcherCandidates = [
            path.join(resourcesDir, "dist", "desktop", "patcher.js"),
            path.join(resourcesDir, "..", "dist", "desktop", "patcher.js"),
            path.join(path.dirname(process.execPath), "dist", "desktop", "patcher.js"),
            path.join(process.cwd(), "dist", "desktop", "patcher.js"),
        ];

        let patcherPath = null;
        for (const p of patcherCandidates) {
            if (fs.existsSync(p)) { patcherPath = p; break; }
        }

        if (!patcherPath) {
            return { ok: false, error: `patcher.js not found in resources.` };
        }

        // Copy dist/desktop/ to permanent location (%LOCALAPPDATA%/RainCord/)
        const permanentDir = path.join(process.env.LOCALAPPDATA || "", "RainCord", "dist", "desktop");
        fs.mkdirSync(permanentDir, { recursive: true });
        const sourceDir = path.dirname(patcherPath);
        for (const file of fs.readdirSync(sourceDir)) {
            const src = path.join(sourceDir, file);
            if (fs.statSync(src).isFile()) {
                fs.copyFileSync(src, path.join(permanentDir, file));
            }
        }

        const permanentPatcher = path.join(permanentDir, "patcher.js").replace(/\\/g, "/");
        fs.writeFileSync(path.join(appDir, "package.json"), '{"name":"raincord","main":"index.js"}');
        fs.writeFileSync(path.join(appDir, "index.js"), `require("${permanentPatcher}");`);

        // Restart Discord
        const updateExe = path.join(resourcesPath, "..", "..", "Update.exe");
        if (fs.existsSync(updateExe)) {
            const exeName = procName + ".exe";
            try { execFileSync(updateExe, ["--processStart", exeName], { stdio: "ignore" }); } catch { }
        }

        return { ok: true };
    } catch (e) {
        return { ok: false, error: e.message };
    }
});

ipcMain.handle("uninject", async (_, resourcesPath) => {
    try {
        const appDir = path.join(resourcesPath, "app");
        const appAsar = path.join(resourcesPath, "app.asar");
        const backup = path.join(resourcesPath, "_app.asar");

        // Kill Discord
        const procName = resourcesPath.includes("DiscordPTB") ? "DiscordPTB"
            : resourcesPath.includes("DiscordCanary") ? "DiscordCanary"
            : "Discord";
        try { execSync(`taskkill /F /IM ${procName}.exe`, { stdio: "ignore" }); } catch { }
        await new Promise(r => setTimeout(r, 2000));

        // Remove app/ folder
        if (fs.existsSync(appDir)) fs.rmSync(appDir, { recursive: true, force: true });

        // Restore backup
        if (fs.existsSync(backup) && !fs.existsSync(appAsar)) {
            fs.renameSync(backup, appAsar);
        }

        return { ok: true };
    } catch (e) {
        return { ok: false, error: e.message };
    }
});

ipcMain.handle("close-app", () => app.quit());
ipcMain.handle("minimize-app", () => mainWindow?.minimize());
