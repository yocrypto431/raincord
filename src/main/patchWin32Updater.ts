/*
 * Vencord, a modification for Discord's desktop app
 * Copyright (c) 2022 Vendicated and contributors
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/

import { app } from "electron";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "original-fs";
import { basename, dirname, join } from "path";

const LOADER_TAG = "RAINCORD auto-repatch loader";

function isNewer($new: string, old: string) {
    const newParts = $new.slice(4).split(".").map(Number);
    const oldParts = old.slice(4).split(".").map(Number);

    for (let i = 0; i < oldParts.length; i++) {
        if (newParts[i] > oldParts[i]) return true;
        if (newParts[i] < oldParts[i]) return false;
    }
    return false;
}

function buildLoaderIndex(patcherFullPath: string): string {
    const safePath = patcherFullPath.replace(/\\/g, "/");
    return `// ${LOADER_TAG} (generated)
"use strict";
try {
    require(${JSON.stringify(safePath)});
} catch (err) {
    console.error("[RAINCORD] Patcher load failed, falling back to vanilla Discord:", err && err.message);
    try {
        const _path = require("path");
        const _fs = require("fs");
        const _fallback = _path.join(__dirname, "..", "_app.asar");
        if (_fs.existsSync(_fallback)) {
            require(_fallback);
        } else {
            throw err;
        }
    } catch (e2) {
        console.error("[RAINCORD] Vanilla Discord fallback also failed:", e2 && e2.message);
        throw err;
    }
}
`;
}

function cleanupBrokenAsarFolder(appAsarPath: string, _backupPath: string): boolean {
    try {
        if (!existsSync(appAsarPath)) return false;
        if (!statSync(appAsarPath).isDirectory()) return false;

        const idxPath = join(appAsarPath, "index.js");
        if (existsSync(idxPath)) {
            const content = readFileSync(idxPath, "utf-8");
            const looksBroken = /require\([^)]*join[^)]*"app"[^)]*"dist"/.test(content)
                || !content.includes(LOADER_TAG);
            if (looksBroken) {
                console.info("[RAINCORD] Cleaning up broken app.asar/ folder at", appAsarPath);
                rmSync(appAsarPath, { recursive: true, force: true });
                return true;
            }
            return false;
        }

        rmSync(appAsarPath, { recursive: true, force: true });
        return true;
    } catch (e) {
        console.error("[RAINCORD] cleanupBrokenAsarFolder failed:", e);
        return false;
    }
}

function patchLatest() {
    try {
        const currentAppPath = dirname(process.execPath);
        const currentVersion = basename(currentAppPath);
        const discordPath = join(currentAppPath, "..");

        const latestVersion = readdirSync(discordPath)
            .filter(name => name.startsWith("app-") && statSync(join(discordPath, name)).isDirectory())
            .reduce((prev, curr) => isNewer(curr, prev) ? curr : prev, currentVersion as string);

        if (latestVersion === currentVersion) return;

        const resources = join(discordPath, latestVersion, "resources");
        const appAsarPath = join(resources, "app.asar");
        const backupPath = join(resources, "_app.asar");
        const appDirPath = join(resources, "app");

        if (existsSync(appDirPath) && existsSync(join(appDirPath, "package.json"))) {
            try {
                const pkg = JSON.parse(readFileSync(join(appDirPath, "package.json"), "utf-8"));
                const name = String(pkg?.name || "").toLowerCase();
                if (name === "raincord" || name === "discord") {
                    const idxJs = join(appDirPath, "index.js");
                    if (existsSync(idxJs)) {
                        const content = readFileSync(idxJs, "utf-8");
                        if (content.includes(LOADER_TAG)) return;
                    }
                    writeFileSync(idxJs, buildLoaderIndex(__filename));
                    console.info("[RAINCORD] Updated loader on existing injection at", appDirPath);
                    return;
                }
            } catch { }
        }

        cleanupBrokenAsarFolder(appAsarPath, backupPath);

        const hasAppAsarFile = existsSync(appAsarPath) && !statSync(appAsarPath).isDirectory();
        const hasBackup = existsSync(backupPath) && !statSync(backupPath).isDirectory();
        if (!hasAppAsarFile && !hasBackup) return;

        console.info("[RAINCORD] Detected Host Update. Repatching", latestVersion);

        if (hasAppAsarFile && !hasBackup) {
            renameSync(appAsarPath, backupPath);
        } else if (hasAppAsarFile && hasBackup) {
            rmSync(appAsarPath, { force: true });
        }

        if (existsSync(appAsarPath)) {
            try { rmSync(appAsarPath, { recursive: true, force: true }); } catch { }
        }

        mkdirSync(appDirPath, { recursive: true });
        writeFileSync(join(appDirPath, "package.json"), JSON.stringify({
            name: "raincord",
            main: "index.js"
        }));
        writeFileSync(join(appDirPath, "index.js"), buildLoaderIndex(__filename));

        console.info("[RAINCORD] Repatched", latestVersion, "→ patcher:", __filename);
    } catch (err) {
        console.error("[RAINCORD] Failed to repatch latest host update", err);
    }
}

app.on("before-quit", patchLatest);
