/*
 * Equicord, a modification for Discord's desktop app
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * SoundCloud Player — native.ts (main process Electron)
 *
 * Todas as requisições HTTP passam por net.fetch do Electron para
 * contornar o CSP do Discord que bloqueia fetch() a partir do renderer.
 */

import { IpcMainInvokeEvent, net } from "electron";

// ─── Fetch via net.fetch do Electron ──────────────────────────────────────────

async function netGet(url: string, headers?: Record<string, string>): Promise<string> {
    const resp = await net.fetch(url, {
        headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
            "Accept": "application/json, text/javascript, */*; q=0.01",
            "Referer": "https://soundcloud.com/",
            ...(headers ?? {}),
        }
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return resp.text();
}

// ─── Fetch dinâmico do client_id SoundCloud ─────────────────────────────────
// Mesma lógica que sc_fetch_client_id / sc_parse_js_for_clientid em C :
//   Etapa 1 : GET soundcloud.com → extrair os <script src="...">
//   Etapa 2 : GET o último bundle JS → buscar client_id:"XXXXXXXX"

export async function fetchSoundCloudClientId(_: IpcMainInvokeEvent): Promise<string | null> {
    try {
        // Etapa 1 : carregar soundcloud.com
        const html = await netGet("https://soundcloud.com/", {
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.5",
        });

        // Extrair as URLs dos bundles JS
        const scriptUrls: string[] = [];
        const re = /<script[^>]+src="(https:\/\/[^"]+\.js[^"]*)"[^>]*>/g;
        let m: RegExpExecArray | null;
        while ((m = re.exec(html)) !== null) {
            const url = m[1];
            if (!url.includes("cookielaw") && !url.includes("analytics") && !url.includes("st-f"))
                scriptUrls.push(url);
        }

        if (scriptUrls.length === 0) return null;

        // Etapa 2 : testar os bundles JS (buscamos nos mais recentes)
        for (const jsUrl of scriptUrls.slice(-5).reverse()) {
            try {
                const js = await netGet(jsUrl);

                // Patterns atualizados para 2024/2025
                const patterns = [
                    /client_id\s*:\s*"([a-zA-Z0-9]{32})"/,
                    /client_id\s*=\s*"([a-zA-Z0-9]{32})"/,
                    /client_id\s*:\s*'([a-zA-Z0-9]{32})'/,
                    /client_id\s*=\s*'([a-zA-Z0-9]{32})'/,
                    /"client_id"\s*:\s*"([a-zA-Z0-9]{32})"/,
                ];
                for (const pat of patterns) {
                    const match = js.match(pat);
                    if (match?.[1]) return match[1];
                }
            } catch { /* tentar o próximo */ }
        }

        return null;
    } catch (e: any) {
        console.error("[SoundCloudPlayer] fetchClientId error:", e?.message);
        return null;
    }
}

// ─── Pesquisa de faixas ──────────────────────────────────────────────────────

export async function searchSoundCloud(
    _: IpcMainInvokeEvent,
    query: string,
    clientId: string
): Promise<string | null> {
    try {
        const url = `https://api-v2.soundcloud.com/search/tracks?q=${encodeURIComponent(query)}&client_id=${clientId}&limit=20`;
        return await netGet(url);
    } catch (e: any) {
        // Retornar o código HTTP para detectar a expiração do client_id
        throw new Error(e?.message ?? String(e));
    }
}

// ─── Resolução da URL de stream ───────────────────────────────────────────

export async function resolveStreamUrl(_: IpcMainInvokeEvent, url: string, clientId: string): Promise<string | null> {
    try {
        // Adicionar o client_id à URL de stream se ausente
        const streamUrl = new URL(url);
        streamUrl.searchParams.set("client_id", clientId);

        // Fazemos um fetch manual seguindo os redirecionamentos para obter a URL final
        const resp = await net.fetch(streamUrl.toString(), {
            redirect: "follow",
            headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
                "Accept": "*/*",
                "Referer": "https://soundcloud.com/",
            }
        });

        if (!resp.ok) {
            console.error(`[SoundCloudNative] Stream resolution failed: ${resp.status}`);
            return null;
        }

        // Se é um fluxo HLS (m3u8), a API retorna um JSON contendo a URL real
        const text = await resp.text();
        try {
            const json = JSON.parse(text);
            return json.url || null;
        } catch {
            // Se não é JSON, talvez já seja a URL direta (caso raro)
            return resp.url;
        }
    } catch (e: any) {
        console.error("[SoundCloudNative] resolveStreamUrl error:", e?.message);
        return null;
    }
}

export async function resolveTrack(
    _: IpcMainInvokeEvent,
    trackId: string,
    clientId: string
): Promise<string | null> {
    try {
        const url = `https://api-v2.soundcloud.com/tracks/${trackId}?client_id=${clientId}`;
        return await netGet(url);
    } catch (e: any) {
        throw new Error(e?.message ?? String(e));
    }
}
