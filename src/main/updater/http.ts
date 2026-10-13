/*
 * RAINCORD — Auto-updater (HTTP / GitHub Releases via ASAR)
 * Vérifie les releases sur GitHub, télécharge le desktop.asar et remplace l'ancien.
 */

import { fetchBuffer, fetchJson } from "@main/utils/http";
import { IpcEvents } from "@shared/IpcEvents";
import { VENCORD_USER_AGENT } from "@shared/vencordUserAgent";
import { app,ipcMain } from "electron";
import { unzipSync } from "fflate";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "original-fs";
import { dirname, isAbsolute, join, relative, resolve } from "path";

import { serializeErrors } from "./common";

const RELEASES_REPO = "yocrypto431/raincord";
const API_BASE = "https://api.github.com/repos/yocrypto431/raincord";
const REPO_URL = "https://github.com/yocrypto431/raincord";
declare const VERSION: string;
const CURRENT_VERSION = `v${VERSION}`;
const ZIP_FILE = "RAINCORD-dist.zip";

let pendingDownloadUrl: string | null = null;
let pendingVersion: string | null = null;
let isApplying = false;

async function githubGet<T = any>(endpoint: string): Promise<T> {
    return fetchJson<T>(API_BASE + endpoint, {
        headers: {
            Accept: "application/vnd.github+json",
            "User-Agent": VENCORD_USER_AGENT
        }
    });
}

function isNewer(a: string, b: string): boolean {
    if (!a || a.includes("dev") || a === "v0.0.0" || a === "unknown") return false;
    const parse = (v: string) => v.replace(/^v/, "").split(".").map(n => parseInt(n, 10) || 0);
    const av = parse(a), bv = parse(b);
    for (let i = 0; i < Math.max(av.length, bv.length); i++) {
        if ((bv[i] ?? 0) > (av[i] ?? 0)) return true;
        if ((bv[i] ?? 0) < (av[i] ?? 0)) return false;
    }
    return false;
}

async function fetchUpdates(): Promise<boolean> {
    if (IS_DEV || !API_BASE) return false;
    try {
        const data = await githubGet("/releases/latest");
        const latestTag: string = data.tag_name ?? "";

        if (!latestTag || !isNewer(CURRENT_VERSION, latestTag)) {
            pendingDownloadUrl = null;
            pendingVersion = null;
            return false;
        }

        const asset = (data.assets as any[])?.find(
            (a: any) => a.name === ZIP_FILE
        );
        if (!asset) {
            pendingDownloadUrl = null;
            pendingVersion = null;
            return false;
        }

        pendingDownloadUrl = asset.browser_download_url;
        pendingVersion = latestTag;
        return true;
    } catch {
        pendingDownloadUrl = null;
        pendingVersion = null;
        return false;
    }
}

async function getUpdates() {
    const outdated = await fetchUpdates();
    if (!outdated) return [];
    return [{
        hash:    pendingVersion ?? "new",
        author:  "RainCord",
        message: `Nova versão disponível: ${pendingVersion}`
    }];
}

async function applyUpdates(): Promise<boolean> {
    if (!pendingDownloadUrl) return false;
    if (isApplying) return false;
    isApplying = true;

    let stagingDir: string | undefined;
    try {
        const files = unzipSync(await fetchBuffer(pendingDownloadUrl));
        if (!files["patcher.js"]?.length || !files["renderer.js"]?.length || !files["preload.js"]?.length) {
            throw new Error("O pacote de atualização está incompleto.");
        }

        stagingDir = mkdtempSync(join(app.getPath("temp"), "RAINCORD-update-"));
        for (const [name, contents] of Object.entries(files)) {
            const destination = resolve(stagingDir, name);
            const relativePath = relative(stagingDir, destination);
            if (relativePath.startsWith("..") || isAbsolute(relativePath) || name.includes("\\") || name.includes(":")) {
                throw new Error("O pacote contém um caminho inválido.");
            }
            if (name.endsWith("/")) {
                mkdirSync(destination, { recursive: true });
                continue;
            }
            mkdirSync(dirname(destination), { recursive: true });
            writeFileSync(destination, contents, { flush: true });
        }

        cpSync(stagingDir, __dirname, { recursive: true, force: true });
        pendingDownloadUrl = null;
        pendingVersion = null;
        return true;
    } finally {
        isApplying = false;
        if (stagingDir) rmSync(stagingDir, { recursive: true, force: true });
    }
}

// ─── Auto-update on quit ─────────────────────────────────────────────────────
// Si une mise à jour est en attente quand Discord se ferme, on l'installe
// silencieusement avant de quitter (timeout de sécurité 45s).
app.on("before-quit", event => {
    // Ne tenter l'update que si une URL est en attente ET qu'on n'est pas déjà en train
    if (!pendingDownloadUrl || isApplying) return;

    event.preventDefault();
    console.log("[RAINCORD] Applying pending update before quit...");

    const safetyTimeout = setTimeout(() => {
        console.error("[RAINCORD] Update on quit timed out — forcing exit.");
        // Nettoyer pour éviter la boucle infinie au prochain démarrage
        pendingDownloadUrl = null;
        pendingVersion = null;
        app.exit(0);
    }, 45_000);

    applyUpdates()
        .then(ok => {
            if (ok) console.log("[RAINCORD] Update applied successfully on quit.");
            else console.warn("[RAINCORD] Update on quit returned false.");
        })
        .catch(err => {
            console.error("[RAINCORD] Update on quit failed:", err);
            // En cas d'échec, nettoyer pour éviter la boucle infinie
            pendingDownloadUrl = null;
            pendingVersion = null;
        })
        .finally(() => {
            clearTimeout(safetyTimeout);
            app.exit(0);
        });
});

ipcMain.handle(IpcEvents.GET_REPO, serializeErrors(() => REPO_URL));
ipcMain.handle(IpcEvents.GET_UPDATES, serializeErrors(getUpdates));
ipcMain.handle(IpcEvents.UPDATE, serializeErrors(fetchUpdates));
ipcMain.handle(IpcEvents.BUILD, serializeErrors(applyUpdates));
