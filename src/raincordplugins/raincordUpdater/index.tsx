import * as DataStore from "@api/DataStore";
import definePlugin from "@utils/types";
import { ChannelStore, FluxDispatcher, React, SelectedChannelStore, useEffect, UserStore, useState, VoiceStateStore } from "@webpack/common";

const REMOTE_VERSION_URL = "https://api.github.com/repos/yocrypto431/raincord/releases/latest";
const REJOIN_KEY = "__RAINCORD_pendingUpdate_voiceRejoin";
const REJOIN_MAX_AGE_MS = 5 * 60 * 1000;
const REJOIN_DELAY_MS = 750;

declare const VERSION: string;

interface PendingVoiceRejoin {
    channelId: string;
    guildId: string | null;
    channelName: string;
    timestamp: number;
}

function getLocalVersion(): string {
    try { return VERSION; } catch { return "0.0.0"; }
}

function isStrictlyNewer(remote: string, local: string): boolean {
    const parse = (v: string) => v.replace(/^v/, "").split(".").map(n => parseInt(n, 10) || 0);
    const r = parse(remote);
    const l = parse(local);
    for (let i = 0; i < Math.max(r.length, l.length); i++) {
        const rv = r[i] ?? 0;
        const lv = l[i] ?? 0;
        if (rv > lv) return true;
        if (rv < lv) return false;
    }
    return false;
}

function getCurrentVoiceInfo(): PendingVoiceRejoin | null {
    try {
        const channelId = SelectedChannelStore.getVoiceChannelId();
        if (!channelId) return null;

        const currentUser = UserStore.getCurrentUser();
        if (!currentUser) return null;

        const myVoiceState = VoiceStateStore.getVoiceStateForUser(currentUser.id);
        if (!myVoiceState?.channelId) return null;
        if (myVoiceState.channelId !== channelId) return null;

        const channel = ChannelStore.getChannel(channelId);
        const channelName = channel?.name
            ?? (channel?.recipients?.length ? `DM (${channel.recipients.length})` : "Voice channel");

        return {
            channelId,
            guildId: channel?.guild_id ?? null,
            channelName,
            timestamp: Date.now(),
        };
    } catch (e) {
        console.error("[RAINCORDUpdater] getCurrentVoiceInfo failed:", e);
        return null;
    }
}

async function saveVoiceStateForRejoin(info: PendingVoiceRejoin) {
    try {
        await DataStore.set(REJOIN_KEY, info);
        console.log("[RAINCORDUpdater] Saved voice state for rejoin:", info.channelName);
    } catch (e) {
        console.error("[RAINCORDUpdater] Failed to save voice state:", e);
    }
}

async function clearPendingRejoin() {
    try { await DataStore.del(REJOIN_KEY); } catch { }
}

async function tryRejoinVoiceAfterUpdate() {
    let saved: PendingVoiceRejoin | null = null;
    try {
        saved = await DataStore.get<PendingVoiceRejoin>(REJOIN_KEY) ?? null;
    } catch { return; }

    if (!saved?.channelId) return;

    if (Date.now() - saved.timestamp > REJOIN_MAX_AGE_MS) {
        await clearPendingRejoin();
        return;
    }

    await clearPendingRejoin();

    setTimeout(() => {
        try {
            const currentUser = UserStore.getCurrentUser();
            if (!currentUser) return;

            const myVoiceState = VoiceStateStore.getVoiceStateForUser(currentUser.id);
            if (myVoiceState?.channelId) return;

            let channel = ChannelStore.getChannel(saved.channelId);
            const tryDispatch = (attempt = 0) => {
                channel = ChannelStore.getChannel(saved!.channelId);
                if (!channel) {
                    if (attempt >= 20) {
                        console.warn("[RAINCORDUpdater] Channel not found for rejoin:", saved!.channelId);
                        return;
                    }
                    setTimeout(() => tryDispatch(attempt + 1), 250);
                    return;
                }

                FluxDispatcher.dispatch({
                    type: "VOICE_CHANNEL_SELECT",
                    guildId: saved!.guildId,
                    channelId: saved!.channelId,
                });
                console.log("[RAINCORDUpdater] Auto-rejoined voice channel:", saved!.channelName);
            };
            tryDispatch();
        } catch (e) {
            console.error("[RAINCORDUpdater] Auto-rejoin failed:", e);
        }
    }, REJOIN_DELAY_MS);
}

interface UpdateInfo {
    remoteVersion: string;
    localVersion: string;
    downloadUrl: string;
}

let pendingUpdate: UpdateInfo | null = null;
let listeners: Array<() => void> = [];
let updateAttempted = false;

function notify() { listeners.forEach(f => f()); }

async function checkForUpdates() {
    if (!REMOTE_VERSION_URL) return;
    try {
        const localVersion = getLocalVersion();
        const res = await fetch(REMOTE_VERSION_URL);
        if (!res.ok) return;

        const data = await res.json();
        if (!data?.tag_name) return;

        const remoteVersion: string = data.tag_name;
        console.log(`[RAINCORDUpdater] local=${localVersion} remote=${remoteVersion}`);

        if (isStrictlyNewer(remoteVersion, localVersion)) {
            pendingUpdate = {
                remoteVersion,
                localVersion,
                downloadUrl: "auto",
            };
            notify();
        }
    } catch (e) {
        console.error("[RAINCORDUpdater] Erro na verificação:", e);
    }
}

function UpdateBanner() {
    const [info, setInfo] = useState<UpdateInfo | null>(pendingUpdate);
    const [dismissed, setDismissed] = useState(false);
    const [status, setStatus] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        const fn = () => setInfo(pendingUpdate);
        listeners.push(fn);
        return () => { listeners = listeners.filter(f => f !== fn); };
    }, []);

    if (!info || dismissed || updateAttempted) return null;

    async function doUpdate() {
        if (loading || !info) return;
        setLoading(true);

        const voiceInfo = getCurrentVoiceInfo();
        if (voiceInfo) {
            await saveVoiceStateForRejoin(voiceInfo);
            setStatus(`Salvando call: ${voiceInfo.channelName}...`);
        }

        updateAttempted = true;
        setStatus("Baixando...");

        try {
            const VencordNative = (window as any).VencordNative;
            const ipc = VencordNative?.updater;
            if (!ipc) throw new Error("VencordNative.updater indisponível");

            const updateRes: { ok: boolean; value?: boolean; error?: any; } = await ipc.update();
            if (!updateRes?.ok) {
                throw new Error(updateRes?.error?.message ?? "Falha ao verificar atualizações");
            }

            setStatus("✓ Baixado! Extraindo...");
            const buildRes: { ok: boolean; value?: boolean; error?: any; } = await ipc.rebuild();
            if (!buildRes?.ok) {
                const errMsg = buildRes?.error?.message ?? JSON.stringify(buildRes?.error) ?? "Falha na instalação";
                throw new Error(errMsg);
            }

            setStatus(voiceInfo
                ? `✓ Atualização aplicada — recarregando sem sair de ${voiceInfo.channelName}...`
                : "✓ Atualização aplicada — recarregando...");

            setTimeout(() => {
                window.location.reload();
            }, 700);
        } catch (e: any) {
            console.error("[RAINCORDUpdater] Erro ao atualizar:", e);
            const msg = e?.message ? e.message.substring(0, 120) : "Erro desconhecido";
            setStatus(`❌ ${msg}. Verifique sua conexão ou reinicie manualmente.`);
            setLoading(false);
            updateAttempted = false;
            await clearPendingRejoin();
        }
    }

    return React.createElement("div", {
        style: {
            position: "fixed",
            top: 0, left: 0, right: 0,
            zIndex: 999999,
            background: "linear-gradient(90deg, #1e5c2a 0%, #3ba55c 100%)",
            color: "#fff",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "9px 16px",
            fontSize: 13,
            fontFamily: "var(--font-primary, sans-serif)",
            boxShadow: "0 2px 16px rgba(0,0,0,0.5)",
            gap: 12,
        }
    },
        React.createElement("div", {
            style: { display: "flex", alignItems: "center", gap: 10, flex: 1, minWidth: 0 }
        },
            React.createElement("span", { style: { fontWeight: 700, flexShrink: 0 } },
                `🔔 RAINCORD ${info.remoteVersion} disponível!`
            ),
            React.createElement("span", {
                style: { opacity: 0.85, fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }
            },
                status ?? `Versão atual: ${info.localVersion}`
            )
        ),
        React.createElement("div", { style: { display: "flex", gap: 8, flexShrink: 0 } },
            React.createElement("button", {
                onClick: doUpdate,
                disabled: loading,
                style: {
                    background: "rgba(255,255,255,0.2)",
                    border: "1px solid rgba(255,255,255,0.35)",
                    borderRadius: 6,
                    color: "#fff",
                    padding: "4px 14px",
                    cursor: loading ? "not-allowed" : "pointer",
                    fontSize: 12,
                    fontWeight: 700,
                    fontFamily: "inherit",
                }
            }, loading ? "..." : "⬇ Atualizar"),
            React.createElement("button", {
                onClick: () => setDismissed(true),
                style: {
                    background: "transparent",
                    border: "none",
                    color: "rgba(255,255,255,0.6)",
                    cursor: "pointer",
                    fontSize: 18,
                    padding: "0 4px",
                    fontFamily: "inherit",
                    lineHeight: 1,
                },
                title: "Dispensar"
            }, "✕")
        )
    );
}

let bannerRoot: any = null;
let bannerContainer: HTMLDivElement | null = null;

function mountBanner() {
    if (bannerContainer || document.getElementById("RAINCORD-updater-root")) return;
    bannerContainer = document.createElement("div");
    bannerContainer.id = "RAINCORD-updater-root";
    document.body.appendChild(bannerContainer);

    try {
        const ReactDOM = require("react-dom/client") ?? require("react-dom");
        if (ReactDOM?.createRoot) {
            bannerRoot = ReactDOM.createRoot(bannerContainer);
            bannerRoot.render(React.createElement(UpdateBanner));
        } else if (ReactDOM?.render) {
            ReactDOM.render(React.createElement(UpdateBanner), bannerContainer);
        }
    } catch (e) {
        try {
            const W = (window as any).Vencord?.Webpack;
            const RD = W?.find?.(W?.filters?.byProps?.("createRoot", "render"), { isIndirect: true })
                ?? W?.find?.(W?.filters?.byProps?.("render", "hydrate"), { isIndirect: true });
            if (RD?.createRoot) {
                bannerRoot = RD.createRoot(bannerContainer);
                bannerRoot.render(React.createElement(UpdateBanner));
            } else if (RD?.render) {
                RD.render(React.createElement(UpdateBanner), bannerContainer);
            }
        } catch { }
    }
}

function unmountBanner() {
    try { bannerRoot?.unmount(); } catch { }
    bannerContainer?.remove();
    bannerContainer = null;
    bannerRoot = null;
}

export default definePlugin({
    name: "RAINCORDUpdater",
    description: "Verifica atualizações na inicialização. Detecta call ativa e reconecta automaticamente após o update.",
    authors: [{ name: "RAINCORD", id: 0n }],
    enabledByDefault: true,
    required: true,

    flux: {
        async CONNECTION_OPEN() {
            try {
                await tryRejoinVoiceAfterUpdate();
            } catch (e) {
                console.error("[RAINCORDUpdater] CONNECTION_OPEN handler failed:", e);
            }
        },
    },

    start() {
        const mountWhenReady = () => setTimeout(mountBanner, 1500);
        if (document.readyState === "complete") mountWhenReady();
        else window.addEventListener("load", mountWhenReady, { once: true });

        setTimeout(() => checkForUpdates(), 5000);
        this._interval = setInterval(() => checkForUpdates(), 5 * 60 * 1000);
    },

    stop() {
        if (this._interval) clearInterval(this._interval);
        unmountBanner();
        pendingUpdate = null;
        updateAttempted = false;
        listeners = [];
    },
});
