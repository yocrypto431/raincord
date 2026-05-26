const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const fs = require("fs");
const { execSync, execFileSync, spawn } = require("child_process");
const asar = require("asar");
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
        const exePath = process.execPath;
        const tempDir = (process.env.TEMP || "").toLowerCase();
        if (exePath.toLowerCase().includes(tempDir)) return null;

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

            // Check if patched: _app.asar exists = patched by EquilotlCli or us
            const backupExists = fs.existsSync(path.join(resources, "_app.asar"));
            const appDirExists = fs.existsSync(path.join(resources, "app", "package.json"));
            const isPatched = backupExists || (appDirExists &&
                fs.readFileSync(path.join(resources, "app", "package.json"), "utf-8").includes("raincord"));

            results.push({
                name: ch.name,
                version: ver.replace("app-", ""),
                path: resources,
                patched: isPatched,
            });
            break;
        }
    }
    return results;
});

// ── Install RainCord ──────────────────────────────────────────────────────────

ipcMain.handle("inject", async (_, resourcesPath) => {
    try {
        // 1. Find patcher.js in our embedded resources
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

        // 2. Copy dist/desktop/ to permanent location
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

        // 3. Find EquilotlCli in resources
        const equilotlCandidates = [
            path.join(resourcesDir, "EquilotlCli.exe"),
            path.join(path.dirname(process.execPath), "resources", "EquilotlCli.exe"),
        ];
        let equilotlPath = null;
        for (const p of equilotlCandidates) {
            if (fs.existsSync(p)) { equilotlPath = p; break; }
        }

        // 4. Kill Discord
        const procName = resourcesPath.includes("DiscordPTB") ? "DiscordPTB"
            : resourcesPath.includes("DiscordCanary") ? "DiscordCanary"
            : resourcesPath.includes("DiscordDevelopment") ? "DiscordDevelopment"
            : "Discord";
        try { execSync(`taskkill /F /IM ${procName}.exe`, { stdio: "ignore" }); } catch { }
        try { execSync(`taskkill /F /IM Update.exe`, { stdio: "ignore" }); } catch { }
        await new Promise(r => setTimeout(r, 3000));

        // 5. Create valid app.asar using @electron/asar
        const appAsar = path.join(resourcesPath, "app.asar");
        const backup = path.join(resourcesPath, "_app.asar");

        // Backup original app.asar BEFORE overwriting
        if (fs.existsSync(appAsar) && !fs.existsSync(backup)) {
            const size = fs.statSync(appAsar).size;
            if (size > 1000000) {
                // Real Discord app.asar — must backup first
                try {
                    fs.copyFileSync(appAsar, backup);
                } catch {
                    // Try with cmd
                    try {
                        execSync(`copy /Y "${appAsar}" "${backup}"`, { stdio: "ignore", shell: true });
                    } catch {
                        return { ok: false, error: "Could not backup app.asar. Close Discord and try again." };
                    }
                }
            }
        }

        // If no backup exists at all, this Discord is broken — skip it
        if (!fs.existsSync(backup) && (!fs.existsSync(appAsar) || fs.statSync(appAsar).size < 1000000)) {
            return { ok: false, error: "Discord installation is corrupted (no original app.asar). Reinstall Discord first." };
        }

        // Create a temp folder with index.js + package.json, then pack as asar
        const tempDir = path.join(process.env.TEMP || "", "raincord_asar_src");
        if (fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true });
        fs.mkdirSync(tempDir, { recursive: true });

        fs.writeFileSync(path.join(tempDir, "index.js"), `require("${permanentPatcher}");\n`);
        fs.writeFileSync(path.join(tempDir, "package.json"), '{"name":"discord","main":"index.js"}');

        // Pack to temp asar file
        const tempAsar = path.join(process.env.TEMP || "", "raincord_app.asar");
        await asar.createPackage(tempDir, tempAsar);

        // Copy over the real app.asar
        try {
            execSync(`copy /Y "${tempAsar}" "${appAsar}"`, { stdio: "ignore", shell: true });
        } catch {
            try {
                execSync(`powershell -NoProfile -Command "Copy-Item -Force '${tempAsar}' '${appAsar}'"`, { stdio: "ignore" });
            } catch {
                // Cleanup
                fs.rmSync(tempDir, { recursive: true, force: true });
                try { fs.unlinkSync(tempAsar); } catch { }
                return { ok: false, error: "Could not write app.asar — file is locked. Run as Administrator." };
            }
        }

        // Cleanup temp
        fs.rmSync(tempDir, { recursive: true, force: true });
        try { fs.unlinkSync(tempAsar); } catch { }

        // 7. Restart Discord
        await new Promise(r => setTimeout(r, 1000));
        const updateExe = path.join(resourcesPath, "..", "..", "Update.exe");
        if (fs.existsSync(updateExe)) {
            try { execFileSync(updateExe, ["--processStart", procName + ".exe"], { stdio: "ignore", timeout: 10000 }); } catch { }
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
        await new Promise(r => setTimeout(r, 4000));

        if (fs.existsSync(appDir)) fs.rmSync(appDir, { recursive: true, force: true });

        if (fs.existsSync(backup)) {
            if (fs.existsSync(appAsar)) {
                try { fs.unlinkSync(appAsar); } catch {
                    try { execSync(`del /F /Q "${appAsar}"`, { stdio: "ignore", shell: true }); } catch {
                        return { ok: false, error: "Could not remove patched app.asar. Run as Administrator." };
                    }
                }
            }
            await new Promise(r => setTimeout(r, 500));
            try { fs.renameSync(backup, appAsar); } catch {
                try { execSync(`move /Y "${backup}" "${appAsar}"`, { stdio: "ignore", shell: true }); } catch {
                    return { ok: false, error: "Could not restore original app.asar. Run as Administrator." };
                }
            }
        } else {
            if (fs.existsSync(appAsar)) {
                try { fs.unlinkSync(appAsar); } catch {
                    try { execSync(`del /F /Q "${appAsar}"`, { stdio: "ignore", shell: true }); } catch { }
                }
            }
        }

        const permanentDir = path.join(process.env.LOCALAPPDATA || "", "RainCord");
        if (fs.existsSync(permanentDir)) try { fs.rmSync(permanentDir, { recursive: true, force: true }); } catch { }

        await new Promise(r => setTimeout(r, 1000));
        const updateExe = path.join(resourcesPath, "..", "..", "Update.exe");
        if (fs.existsSync(updateExe)) {
            try { execFileSync(updateExe, ["--processStart", procName + ".exe"], { stdio: "ignore", timeout: 10000 }); } catch { }
        }

        return { ok: true };
    } catch (e) {
        return { ok: false, error: e.message };
    }
});

ipcMain.handle("close-app", () => app.quit());
ipcMain.handle("minimize-app", () => mainWindow?.minimize());

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
        const ps = `$ErrorActionPreference='SilentlyContinue'; Start-Sleep -Seconds 3; $old='${currentExe}'; $new='${newExe}'; for($i=0;$i -lt 10;$i++){ try { Remove-Item -Force -LiteralPath $old; break } catch { Start-Sleep -Seconds 1 } }; Move-Item -Force -LiteralPath $new -Destination $old; Start-Process -FilePath $old`;
        spawn("powershell", ["-NoProfile", "-WindowStyle", "Hidden", "-Command", ps], { detached: true, stdio: "ignore", shell: false }).unref();
        setTimeout(() => app.quit(), 500);
        return { ok: true };
    } catch (e) {
        return { ok: false, error: e.message };
    }
});
