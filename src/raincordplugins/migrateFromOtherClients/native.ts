import { IpcMainInvokeEvent } from "electron";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";

const KNOWN_CLIENTS = [
    { id: "vencord", name: "Vencord", folder: "Vencord" },
    { id: "equicord", name: "Equicord", folder: "Equicord" },
    { id: "plexcord", name: "Plexcord", folder: "Plexcord" },
    { id: "suncord", name: "Suncord", folder: "Suncord" },
    { id: "shelter", name: "Shelter", folder: "Shelter" },
];

export interface DetectedInstallation {
    id: string;
    name: string;
    path: string;
    hasSettings: boolean;
    hasQuickCss: boolean;
    themeCount: number;
    pluginCount: number;
}

function getCandidateRoots(): string[] {
    const home = homedir();
    const roots = new Set<string>();
    if (process.env.APPDATA) roots.add(process.env.APPDATA);
    roots.add(join(home, "AppData", "Roaming"));
    roots.add(join(home, ".config"));
    roots.add(join(home, "Library", "Application Support"));
    return Array.from(roots).filter(p => {
        try { return existsSync(p); } catch { return false; }
    });
}

function getRaincordDataDir(): string {
    const env = process.env.RAINCORD_USER_DATA_DIR;
    if (env) return env;
    const appdata = process.env.APPDATA ?? join(homedir(), "AppData", "Roaming");
    return join(appdata, "RAINCORD");
}

function inspectInstallation(folderPath: string): { hasSettings: boolean; hasQuickCss: boolean; themeCount: number; pluginCount: number; } {
    const settingsFile = join(folderPath, "settings", "settings.json");
    const quickCssFile = join(folderPath, "settings", "quickCss.css");
    const themesDir = join(folderPath, "themes");

    let hasSettings = false;
    let pluginCount = 0;
    try {
        if (existsSync(settingsFile)) {
            hasSettings = true;
            const raw = readFileSync(settingsFile, "utf-8");
            const parsed = JSON.parse(raw);
            if (parsed?.plugins && typeof parsed.plugins === "object") {
                pluginCount = Object.keys(parsed.plugins).length;
            }
        }
    } catch { }

    let hasQuickCss = false;
    try {
        if (existsSync(quickCssFile) && statSync(quickCssFile).size > 0) hasQuickCss = true;
    } catch { }

    let themeCount = 0;
    try {
        if (existsSync(themesDir)) {
            themeCount = readdirSync(themesDir).filter(f => /\.(css|theme\.css)$/i.test(f)).length;
        }
    } catch { }

    return { hasSettings, hasQuickCss, themeCount, pluginCount };
}

export async function detectInstallations(_: IpcMainInvokeEvent): Promise<DetectedInstallation[]> {
    const found: DetectedInstallation[] = [];
    const raincordDir = getRaincordDataDir();
    const seen = new Set<string>();

    for (const root of getCandidateRoots()) {
        for (const client of KNOWN_CLIENTS) {
            const folderPath = join(root, client.folder);
            try {
                if (!existsSync(folderPath)) continue;
                if (!statSync(folderPath).isDirectory()) continue;
            } catch { continue; }

            if (folderPath.toLowerCase() === raincordDir.toLowerCase()) continue;
            if (seen.has(folderPath.toLowerCase())) continue;
            seen.add(folderPath.toLowerCase());

            const info = inspectInstallation(folderPath);
            if (!info.hasSettings && !info.hasQuickCss && info.themeCount === 0) continue;

            found.push({
                id: `${client.id}_${Buffer.from(folderPath).toString("base64").slice(0, 12)}`,
                name: client.name,
                path: folderPath,
                ...info,
            });
        }
    }

    return found;
}

export interface MigrationOptions {
    sourcePath: string;
    importSettings: boolean;
    importQuickCss: boolean;
    importThemes: boolean;
    quickCssMode: "replace" | "append";
}

export interface MigrationResult {
    ok: boolean;
    pluginsImported: number;
    quickCssBytes: number;
    themesImported: string[];
    error?: string;
}

function safeMergePlugins(target: any, source: any): number {
    if (!source?.plugins || typeof source.plugins !== "object") return 0;
    if (!target.plugins || typeof target.plugins !== "object") target.plugins = {};
    let count = 0;
    for (const [name, srcCfg] of Object.entries(source.plugins)) {
        if (!srcCfg || typeof srcCfg !== "object") continue;
        const cur = target.plugins[name] && typeof target.plugins[name] === "object" ? target.plugins[name] : {};
        target.plugins[name] = { ...cur, ...(srcCfg as object) };
        count++;
    }
    return count;
}

export async function applyMigration(_: IpcMainInvokeEvent, options: MigrationOptions): Promise<MigrationResult> {
    const result: MigrationResult = { ok: false, pluginsImported: 0, quickCssBytes: 0, themesImported: [] };

    try {
        const raincordDir = getRaincordDataDir();
        const targetSettingsDir = join(raincordDir, "settings");
        const targetThemesDir = join(raincordDir, "themes");
        const targetSettingsFile = join(targetSettingsDir, "settings.json");
        const targetQuickCssFile = join(targetSettingsDir, "quickCss.css");

        mkdirSync(targetSettingsDir, { recursive: true });
        mkdirSync(targetThemesDir, { recursive: true });

        const srcSettings = join(options.sourcePath, "settings", "settings.json");
        const srcQuickCss = join(options.sourcePath, "settings", "quickCss.css");
        const srcThemesDir = join(options.sourcePath, "themes");

        if (options.importSettings && existsSync(srcSettings)) {
            let target: any = {};
            try {
                if (existsSync(targetSettingsFile)) target = JSON.parse(readFileSync(targetSettingsFile, "utf-8")) || {};
            } catch { target = {}; }

            let source: any = {};
            try { source = JSON.parse(readFileSync(srcSettings, "utf-8")) || {}; } catch { source = {}; }

            result.pluginsImported = safeMergePlugins(target, source);

            if (Array.isArray(source.themeLinks)) {
                const existing = Array.isArray(target.themeLinks) ? target.themeLinks : [];
                target.themeLinks = Array.from(new Set([...existing, ...source.themeLinks]));
            }
            if (source.cloud && typeof source.cloud === "object" && !target.cloud) {
                target.cloud = source.cloud;
            }

            const backupFile = `${targetSettingsFile}.pre-migration-${Date.now()}.bak`;
            try {
                if (existsSync(targetSettingsFile)) copyFileSync(targetSettingsFile, backupFile);
            } catch { }

            writeFileSync(targetSettingsFile, JSON.stringify(target, null, 4), "utf-8");
        }

        if (options.importQuickCss && existsSync(srcQuickCss)) {
            const srcCss = readFileSync(srcQuickCss, "utf-8");
            let outCss = srcCss;
            if (options.quickCssMode === "append" && existsSync(targetQuickCssFile)) {
                const cur = readFileSync(targetQuickCssFile, "utf-8");
                outCss = `${cur}\n\n/* === Imported from ${options.sourcePath} === */\n${srcCss}`;
            } else if (existsSync(targetQuickCssFile)) {
                const backupCss = `${targetQuickCssFile}.pre-migration-${Date.now()}.bak`;
                try { copyFileSync(targetQuickCssFile, backupCss); } catch { }
            }
            writeFileSync(targetQuickCssFile, outCss, "utf-8");
            result.quickCssBytes = Buffer.byteLength(outCss, "utf-8");
        }

        if (options.importThemes && existsSync(srcThemesDir)) {
            const files = readdirSync(srcThemesDir).filter(f => /\.(css|theme\.css)$/i.test(f));
            for (const f of files) {
                try {
                    const srcFile = join(srcThemesDir, f);
                    if (!statSync(srcFile).isFile()) continue;
                    const dstFile = join(targetThemesDir, f);
                    copyFileSync(srcFile, dstFile);
                    result.themesImported.push(f);
                } catch { }
            }
        }

        result.ok = true;
        return result;
    } catch (e: any) {
        result.error = String(e?.message ?? e);
        return result;
    }
}

export async function getRaincordPaths(_: IpcMainInvokeEvent): Promise<{ dataDir: string; settingsDir: string; themesDir: string; }> {
    const dataDir = getRaincordDataDir();
    return {
        dataDir,
        settingsDir: join(dataDir, "settings"),
        themesDir: join(dataDir, "themes"),
    };
}
