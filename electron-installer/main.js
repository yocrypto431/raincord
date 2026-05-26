const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const fs = require("original-fs");
const { execSync, execFileSync, spawn } = require("child_process");
const https = require("https");

const REPO = "yocrypto431/raincord";
const INSTALLER_VERSION = require("./package.json").version;

let mainWindow;

function httpsGet(url) {
    return new Promise((resolve, reject) => {
        https.get(url, { headers: { "User-Agent": "RainCord-Installer" } }, res => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                return httpsGet(res.headers.location).then(resolve).catch(reject);
            }
            const chunks = [];
            res.on("data", c => chunks.push(c));
            res.on("end", () => resolve({ status: res.statusCode, data: Buffer.concat(chunks) }));
        }).on("error", reject);
    });
}

async function checkForUpdate() {
    try {
        const res = await httpsGet(`https://api.github.com/repos/${REPO}/releases/latest`);
        const release = JSON.parse(res.data.toString());
        const latestVer = release.tag_name.replace("v", "");
        if (!latestVer || latestVer === INSTALLER_VERSION) return null;

        const latestParts = latestVer.split(".").map(Number);
        const localParts = INSTALLER_VERSION.split(".").map(Number);
        let isNewer = false;
        for (let i = 0; i < 3; i++) {
            if ((latestParts[i] || 0) > (localParts[i] || 0)) { isNewer = true; break; }
            if ((latestParts[i] || 0) < (localParts[i] || 0)) break;
        }
        if (!isNewer) return null;

        const asset = release.assets.find(a => a.name === "RainCord-Installer.exe");
        if (!asset) return null;
        return { version: latestVer, url: asset.browser_download_url };
    } catch { return null; }
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
    app.quit();
} else {
    app.on("second-instance", () => {
        if (mainWindow) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.focus();
        }
    });

    app.whenReady().then(() => {
    mainWindow = new BrowserWindow({
        width: 680,
        height: 520,
        resizable: false,
        frame: false,
        backgroundColor: "#0a0f1a",
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
        },
    });
    mainWindow.loadFile("index.html");
});

app.on("window-all-closed", () => app.quit());
}

// ── Detect Discord installations ──────────────────────────────────────────────

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

        const versions = fs.readdirSync(base).filter(d => d.startsWith("app-")).sort().reverse();
        for (const ver of versions) {
            const resources = path.join(base, ver, "resources");
            if (!fs.existsSync(resources)) continue;

            const appAsar = path.join(resources, "app.asar");
            const backup = path.join(resources, "_app.asar");
            const appDir = path.join(resources, "app");

            let isPatched = false;
            let isOtherMod = false;

            if (fs.existsSync(appDir) && fs.existsSync(path.join(appDir, "package.json"))) {
                const pkg = fs.readFileSync(path.join(appDir, "package.json"), "utf-8").toLowerCase();
                let idx = "";
                try { idx = fs.readFileSync(path.join(appDir, "index.js"), "utf-8").toLowerCase(); } catch { }
                const combined = pkg + idx;
                if (combined.includes("raincord")) isPatched = true;
                else if (combined.includes("vencord") || combined.includes("equicord") || combined.includes("betterdiscord")) isOtherMod = true;
                else isOtherMod = true;
            }

            if (!isPatched && !isOtherMod && fs.existsSync(appAsar) && fs.existsSync(backup)) {
                try {
                    const size = fs.statSync(appAsar).size;
                    if (size < 500000) {
                        try {
                            const raw = fs.readFileSync(appAsar).toString("utf-8").toLowerCase();
                            if (raw.includes("raincord")) isPatched = true;
                            else if (raw.includes("vencord") || raw.includes("equicord") || raw.includes("betterdiscord")) isOtherMod = true;
                            else isOtherMod = true;
                        } catch {
                            isOtherMod = true;
                        }
                    }
                } catch { }
            }

            results.push({
                name: ch.name,
                version: ver.replace("app-", ""),
                path: resources,
                patched: isPatched,
                otherMod: isOtherMod,
            });
            break;
        }
    }
    return results;
});

// ── Install RainCord ──────────────────────────────────────────────────────────

ipcMain.handle("inject", async (_, resourcesPath) => {
    try {
        const resourcesDir = process.resourcesPath;
        const patcherCandidates = [
            path.join(resourcesDir, "dist", "desktop", "patcher.js"),
            path.join(path.dirname(process.execPath), "resources", "dist", "desktop", "patcher.js"),
            path.join(process.cwd(), "dist", "desktop", "patcher.js"),
        ];
        let patcherPath = null;
        for (const p of patcherCandidates) {
            if (fs.existsSync(p)) { patcherPath = p; break; }
        }
        if (!patcherPath) {
            return { ok: false, error: "patcher.js not found in resources." };
        }

        const permanentDir = path.join(process.env.LOCALAPPDATA || "", "RainCord", "dist", "desktop");
        fs.mkdirSync(permanentDir, { recursive: true });
        const sourceDir = path.dirname(patcherPath);
        let copied = 0;
        for (const file of fs.readdirSync(sourceDir)) {
            const src = path.join(sourceDir, file);
            if (fs.statSync(src).isFile()) {
                fs.copyFileSync(src, path.join(permanentDir, file));
                copied++;
            }
        }
        const permanentPatcher = path.join(permanentDir, "patcher.js").replace(/\\/g, "/");

        const procName = resourcesPath.includes("DiscordPTB") ? "DiscordPTB"
            : resourcesPath.includes("DiscordCanary") ? "DiscordCanary"
            : resourcesPath.includes("DiscordDevelopment") ? "DiscordDevelopment"
            : "Discord";

        try { execSync(`taskkill /F /IM ${procName}.exe`, { stdio: "ignore" }); } catch (e) {}
        try { execSync(`taskkill /F /IM Update.exe`, { stdio: "ignore" }); } catch { }
        await new Promise(r => setTimeout(r, 2000));

        const appDir = path.join(resourcesPath, "app");
        const appAsar = path.join(resourcesPath, "app.asar");
        const backup = path.join(resourcesPath, "_app.asar");

        if (!fs.existsSync(backup)) {
            for (let i = 0; i < 30; i++) {
                if (!fs.existsSync(appAsar)) {
                    await new Promise(r => setTimeout(r, 500));
                    continue;
                }
                const size1 = fs.statSync(appAsar).size;
                if (size1 < 1000000) {
                    try { execSync(`taskkill /F /IM Update.exe`, { stdio: "ignore" }); } catch { }
                    try { execSync(`taskkill /F /IM ${procName}.exe`, { stdio: "ignore" }); } catch { }
                    await new Promise(r => setTimeout(r, 500));
                    continue;
                }
                await new Promise(r => setTimeout(r, 500));
                if (!fs.existsSync(appAsar)) continue;
                const size2 = fs.statSync(appAsar).size;
                if (size1 === size2 && size2 > 1000000) {
                    break;
                }
            }
        }

        if (fs.existsSync(appDir)) {
            try { fs.rmSync(appDir, { recursive: true, force: true }); } catch (e) {
                try { execSync(`rmdir /S /Q "${appDir}"`, { stdio: "ignore", shell: true }); } catch { }
            }
        }

        if (fs.existsSync(backup) && fs.existsSync(appAsar)) {
            try {
                const size = fs.statSync(appAsar).size;
                if (size < 500000) {
                    try { fs.unlinkSync(appAsar); } catch {
                        try { execSync(`del /F /Q "${appAsar}"`, { stdio: "ignore", shell: true }); } catch { }
                    }
                }
            } catch { }
        }

        if (!fs.existsSync(backup) && fs.existsSync(appAsar)) {
            const size = fs.statSync(appAsar).size;
            if (size > 1000000) {
                let renamed = false;
                let lastErr = "";
                for (let i = 0; i < 20; i++) {
                    try { fs.renameSync(appAsar, backup); renamed = true; break; } catch (e) { lastErr = e.code; }
                    try { execSync(`move /Y "${appAsar}" "${backup}"`, { stdio: "ignore", shell: true }); if (fs.existsSync(backup)) { renamed = true; break; } } catch { }
                    await new Promise(r => setTimeout(r, 500));
                }
                if (!renamed) {
                    return { ok: false, error: `Could not backup app.asar (${lastErr}). Make sure Discord is fully closed.` };
                }
            }
        }

        try { fs.mkdirSync(appDir, { recursive: true }); } catch (e) {
            return { ok: false, error: "Could not create app folder: " + e.message };
        }

        try {
            fs.writeFileSync(path.join(appDir, "package.json"), '{"name":"raincord","main":"index.js"}');
            fs.writeFileSync(path.join(appDir, "index.js"), `require("${permanentPatcher}");\n`);
        } catch (e) {
            return { ok: false, error: "Could not write app folder files: " + e.message };
        }

        const discordExe = path.join(resourcesPath, "..", procName + ".exe");
        if (fs.existsSync(discordExe)) {
            try { spawn(discordExe, [], { detached: true, stdio: "ignore" }).unref(); } catch (e) {}
        }
        return { ok: true };
    } catch (e) {
        return { ok: false, error: e.message };
    }
});


// ── Uninstall ─────────────────────────────────────────────────────────────────

ipcMain.handle("uninject", async (_, resourcesPath) => {
    try {
        const appDir = path.join(resourcesPath, "app");
        const appAsar = path.join(resourcesPath, "app.asar");
        const backup = path.join(resourcesPath, "_app.asar");

        const procName = resourcesPath.includes("DiscordPTB") ? "DiscordPTB"
            : resourcesPath.includes("DiscordCanary") ? "DiscordCanary"
            : resourcesPath.includes("DiscordDevelopment") ? "DiscordDevelopment"
            : "Discord";

        try { execSync(`taskkill /F /IM ${procName}.exe`, { stdio: "ignore" }); } catch { }
        try { execSync(`taskkill /F /IM Update.exe`, { stdio: "ignore" }); } catch { }
        await new Promise(r => setTimeout(r, 2000));

        if (fs.existsSync(appDir)) {
            try { fs.rmSync(appDir, { recursive: true, force: true }); } catch {
                try { execSync(`rmdir /S /Q "${appDir}"`, { stdio: "ignore", shell: true }); } catch {
                    return { ok: false, error: "Could not remove app folder. Make sure Discord is closed." };
                }
            }
        }

        if (fs.existsSync(backup) && fs.existsSync(appAsar)) {
            try {
                const size = fs.statSync(appAsar).size;
                if (size < 500000) {
                    try { fs.unlinkSync(appAsar); } catch {
                        try { execSync(`del /F /Q "${appAsar}"`, { stdio: "ignore", shell: true }); } catch { }
                    }
                    if (!fs.existsSync(appAsar)) {
                        try { fs.renameSync(backup, appAsar); } catch {
                            try { execSync(`move /Y "${backup}" "${appAsar}"`, { stdio: "ignore", shell: true }); } catch { }
                        }
                    }
                }
            } catch { }
        } else if (fs.existsSync(backup) && !fs.existsSync(appAsar)) {
            try { fs.renameSync(backup, appAsar); } catch {
                try { execSync(`move /Y "${backup}" "${appAsar}"`, { stdio: "ignore", shell: true }); } catch { }
            }
        }

        const localAppDataU = process.env.LOCALAPPDATA || "";
        const channelsU = ["Discord", "DiscordPTB", "DiscordCanary", "DiscordDevelopment"];
        let stillInstalled = false;
        for (const ch of channelsU) {
            const baseU = path.join(localAppDataU, ch);
            if (!fs.existsSync(baseU)) continue;
            const versU = fs.readdirSync(baseU).filter(d => d.startsWith("app-")).sort().reverse();
            for (const v of versU) {
                const r = path.join(baseU, v, "resources");
                if (!fs.existsSync(r)) continue;
                const ad = path.join(r, "app");
                if (fs.existsSync(ad) && fs.existsSync(path.join(ad, "package.json"))) {
                    const c = fs.readFileSync(path.join(ad, "package.json"), "utf-8").toLowerCase();
                    if (c.includes("raincord")) { stillInstalled = true; break; }
                }
                break;
            }
            if (stillInstalled) break;
        }

        if (!stillInstalled) {
            const permanentDir = path.join(process.env.LOCALAPPDATA || "", "RainCord");
            if (fs.existsSync(permanentDir)) try { fs.rmSync(permanentDir, { recursive: true, force: true }); } catch { }
        }

        const discordExe = path.join(resourcesPath, "..", procName + ".exe");
        if (fs.existsSync(discordExe)) {
            try { spawn(discordExe, [], { detached: true, stdio: "ignore" }).unref(); } catch { }
        }

        return { ok: true };
    } catch (e) {
        return { ok: false, error: e.message };
    }
});

ipcMain.handle("close-app", () => app.quit());
ipcMain.handle("minimize-app", () => mainWindow?.minimize());
ipcMain.handle("get-version", () => INSTALLER_VERSION);

ipcMain.handle("check-update", async () => {
    return await checkForUpdate();
});

ipcMain.handle("self-update", async (_, url) => {
    try {
        const res = await httpsGet(url);
        if (res.status !== 200) return { ok: false, error: "Download failed" };
        const currentExe = process.execPath;
        const dir = path.dirname(currentExe);
        const name = path.basename(currentExe);
        const newExe = path.join(dir, name + ".update");
        fs.writeFileSync(newExe, res.data);
        const ps = `$ErrorActionPreference='SilentlyContinue'; Start-Sleep -Seconds 3; $old='${currentExe}'; $new='${newExe}'; for($i=0;$i -lt 10;$i++){ try { Remove-Item -Force -LiteralPath $old; break } catch { Start-Sleep -Seconds 1 } }; Move-Item -Force -LiteralPath $new -Destination $old`;
        spawn("powershell", ["-NoProfile", "-WindowStyle", "Hidden", "-Command", ps], { detached: true, stdio: "ignore", shell: false }).unref();
        setTimeout(() => app.quit(), 500);
        return { ok: true };
    } catch (e) {
        return { ok: false, error: e.message };
    }
});
