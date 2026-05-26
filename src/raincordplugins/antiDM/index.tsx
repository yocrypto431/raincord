/*
 * RainCord — AntiDM Plugin
 * Bloqueia convites para grupos DM. Salva logs com histórico.
 * Modal bonito pra ver quem tentou te adicionar.
 */

import * as DataStore from "@api/DataStore";
import { addHeaderBarButton, HeaderBarButton, removeHeaderBarButton } from "@api/HeaderBar";
import { showNotification } from "@api/Notifications";
import definePlugin from "@utils/types";
import { openModal, ModalRoot, ModalSize, ModalHeader, ModalContent, ModalCloseButton } from "@utils/modal";
import { RestAPI, React, UserStore, useState, useEffect, Button, Forms, ScrollerThin } from "@webpack/common";
import { findByPropsLazy } from "@webpack";

const UserUtils = findByPropsLazy("getUser", "fetchCurrentUser");

// ── Types ─────────────────────────────────────────────────────────────────────

interface BlockedEntry {
    id: string;
    timestamp: number;
    ownerName: string;
    ownerId: string;
    ownerAvatar: string | null;
    members: Array<{ id: string; name: string; avatar: string | null; }>;
    groupId: string;
}

// ── State ─────────────────────────────────────────────────────────────────────

const STORE_KEY = "AntiDM_logs";
let enabled = true;
let logs: BlockedEntry[] = [];
let uiListeners: Array<() => void> = [];

function notifyUI() { uiListeners.forEach(f => f()); }

async function loadLogs() {
    logs = (await DataStore.get<BlockedEntry[]>(STORE_KEY)) ?? [];
}

async function saveLogs() {
    // Keep max 100 entries
    if (logs.length > 100) logs = logs.slice(-100);
    await DataStore.set(STORE_KEY, logs);
}

async function addLog(entry: BlockedEntry) {
    logs.push(entry);
    await saveLogs();
    notifyUI();
}

// ── Resolve user info ─────────────────────────────────────────────────────────

async function resolveUser(id: string): Promise<{ name: string; avatar: string | null; }> {
    try {
        // Try cache first
        let user = UserStore.getUser?.(id);
        // If not cached, fetch from API
        if (!user) {
            user = await UserUtils.getUser(id);
        }
        if (user) {
            const avatar = user.avatar
                ? `https://cdn.discordapp.com/avatars/${id}/${user.avatar}.${user.avatar.startsWith("a_") ? "gif" : "png"}?size=64`
                : null;
            return { name: user.username ?? user.global_name ?? id, avatar };
        }
    } catch { }
    // Last resort: fetch via REST
    try {
        const res = await RestAPI.get({ url: `/users/${id}` });
        if (res.body) {
            const u = res.body;
            const avatar = u.avatar
                ? `https://cdn.discordapp.com/avatars/${id}/${u.avatar}.png?size=64`
                : null;
            return { name: u.username ?? u.global_name ?? id, avatar };
        }
    } catch { }
    return { name: id, avatar: null };
}

// ── Flux Handler ──────────────────────────────────────────────────────────────

async function onChannelCreate(event: any) {
    if (!enabled) return;

    const channel = event.channel ?? event;
    if (channel.type !== 3) return; // Only Group DMs

    const myId = UserStore.getCurrentUser()?.id;
    const recipients: Array<any> = channel.recipients ?? channel.rawRecipients ?? [];
    const ownerId = channel.ownerId ?? channel.owner_id ?? "unknown";

    // Resolve owner
    const ownerInfo = await resolveUser(ownerId);

    // Resolve members
    const members: Array<{ id: string; name: string; avatar: string | null; }> = [];
    for (const r of recipients) {
        const rid = typeof r === "string" ? r : r.id;
        if (rid === myId) continue;
        if (typeof r === "object" && r.username) {
            const av = r.avatar ? `https://cdn.discordapp.com/avatars/${rid}/${r.avatar}.png?size=64` : null;
            members.push({ id: rid, name: r.username, avatar: av });
        } else {
            const info = await resolveUser(rid);
            members.push({ id: rid, ...info });
        }
    }

    // Save log
    const entry: BlockedEntry = {
        id: crypto.randomUUID(),
        timestamp: Date.now(),
        ownerName: ownerInfo.name,
        ownerId,
        ownerAvatar: ownerInfo.avatar,
        members,
        groupId: channel.id,
    };
    await addLog(entry);

    // Desktop notification
    showNotification({
        title: "AntiDM — Group Blocked",
        body: `${ownerInfo.name} tried to add you (${members.map(m => m.name).join(", ")})`,
    });

    // Leave group
    RestAPI.del({ url: `/channels/${channel.id}` }).catch(() => { });
}

// ── Log Modal ─────────────────────────────────────────────────────────────────

function LogModal({ onClose }: { onClose: () => void; }) {
    const [, forceUpdate] = React.useReducer(x => x + 1, 0);
    const [localLogs, setLocalLogs] = useState<BlockedEntry[]>([...logs].reverse());

    useEffect(() => {
        loadLogs().then(() => setLocalLogs([...logs].reverse()));
    }, []);

    const clearLogs = async () => {
        logs = [];
        await saveLogs();
        setLocalLogs([]);
    };

    const formatTime = (ts: number) => {
        const d = new Date(ts);
        return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }) + " " +
            d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
    };

    return (
        <>
            <ModalHeader>
                <div style={{ display: "flex", alignItems: "center", gap: 12, flex: 1 }}>
                    <Forms.FormTitle tag="h2" style={{ margin: 0 }}>
                        AntiDM Logs
                    </Forms.FormTitle>
                    <span style={{
                        background: "var(--status-danger)",
                        color: "white",
                        fontSize: 11,
                        fontWeight: 700,
                        padding: "2px 8px",
                        borderRadius: 10,
                    }}>
                        {localLogs.length}
                    </span>
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <Button
                        size={Button.Sizes.SMALL}
                        color={Button.Colors.RED}
                        onClick={clearLogs}
                        disabled={localLogs.length === 0}
                    >
                        Clear All
                    </Button>
                    <ModalCloseButton onClick={onClose} />
                </div>
            </ModalHeader>
            <ModalContent>
                <div style={{ padding: "12px 0" }}>
                    {localLogs.length === 0 ? (
                        <div style={{ textAlign: "center", padding: 40, color: "var(--text-muted)" }}>
                            <div style={{ fontSize: 32, marginBottom: 8 }}>🛡️</div>
                            <div>No blocked group DMs yet.</div>
                            <div style={{ fontSize: 12, marginTop: 4 }}>When someone tries to add you to a group, it will appear here.</div>
                        </div>
                    ) : (
                        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                            {localLogs.map(entry => (
                                <div
                                    key={entry.id}
                                    style={{
                                        display: "flex",
                                        alignItems: "flex-start",
                                        gap: 12,
                                        padding: "10px 12px",
                                        borderRadius: 6,
                                        background: "var(--background-secondary)",
                                        transition: "background 0.1s",
                                    }}
                                    onMouseEnter={e => (e.currentTarget.style.background = "var(--background-modifier-hover)")}
                                    onMouseLeave={e => (e.currentTarget.style.background = "var(--background-secondary)")}
                                >
                                    {/* Avatar */}
                                    <img
                                        src={entry.ownerAvatar ?? `https://cdn.discordapp.com/embed/avatars/${parseInt(entry.ownerId) % 5}.png`}
                                        width={36}
                                        height={36}
                                        style={{ borderRadius: "50%", flexShrink: 0 }}
                                        onError={e => { (e.target as HTMLImageElement).src = "https://cdn.discordapp.com/embed/avatars/0.png"; }}
                                    />

                                    {/* Content */}
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                            <span style={{
                                                background: "var(--status-danger)",
                                                color: "white",
                                                fontSize: 10,
                                                fontWeight: 700,
                                                padding: "1px 6px",
                                                borderRadius: 3,
                                                textTransform: "uppercase",
                                            }}>
                                                Blocked
                                            </span>
                                            <span style={{ fontWeight: 600, fontSize: 13 }}>
                                                {entry.ownerName}
                                            </span>
                                            <span style={{ color: "var(--text-muted)", fontSize: 11, marginLeft: "auto", flexShrink: 0 }}>
                                                {formatTime(entry.timestamp)}
                                            </span>
                                        </div>
                                        <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 3 }}>
                                            Tried to add you to a group with:{" "}
                                            <span style={{ color: "var(--text-normal)" }}>
                                                {entry.members.map(m => m.name).join(", ") || "unknown"}
                                            </span>
                                        </div>
                                        {/* Member avatars row */}
                                        {entry.members.length > 0 && (
                                            <div style={{ display: "flex", gap: 4, marginTop: 6 }}>
                                                {entry.members.slice(0, 8).map(m => (
                                                    <img
                                                        key={m.id}
                                                        src={m.avatar ?? `https://cdn.discordapp.com/embed/avatars/${parseInt(m.id) % 5}.png`}
                                                        width={22}
                                                        height={22}
                                                        title={m.name}
                                                        style={{ borderRadius: "50%", border: "2px solid var(--background-secondary)" }}
                                                        onError={e => { (e.target as HTMLImageElement).src = "https://cdn.discordapp.com/embed/avatars/0.png"; }}
                                                    />
                                                ))}
                                                {entry.members.length > 8 && (
                                                    <span style={{ fontSize: 11, color: "var(--text-muted)", alignSelf: "center" }}>
                                                        +{entry.members.length - 8}
                                                    </span>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </ModalContent>
        </>
    );
}

function openLogModal() {
    openModal(props => (
        <ModalRoot {...props} size={ModalSize.MEDIUM}>
            <LogModal onClose={props.onClose} />
        </ModalRoot>
    ));
}

// ── Header Bar Button ─────────────────────────────────────────────────────────

function AntiDMIcon({ active }: { active?: boolean; }) {
    return (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
            <path
                d="M21 12.5V6c0-.83-.67-1.5-1.5-1.5h-3C15.67 4.5 15 5.17 15 6v1.5"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                fill="none"
            />
            <circle cx="18" cy="3" r="2" stroke="currentColor" strokeWidth="1.8" fill="none" />
            <path
                d="M13 18v-2.5c0-.83-.67-1.5-1.5-1.5h-5C5.67 14 5 14.67 5 15.5V18"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                fill="none"
            />
            <circle cx="9" cy="11" r="2.5" stroke="currentColor" strokeWidth="1.8" fill="none" />
            {active && (
                <line
                    x1="3" y1="21" x2="21" y2="3"
                    stroke="var(--status-danger)"
                    strokeWidth="2"
                    strokeLinecap="round"
                />
            )}
        </svg>
    );
}

function AntiDMHeaderButton() {
    const [, forceUpdate] = React.useReducer(x => x + 1, 0);

    useEffect(() => {
        uiListeners.push(forceUpdate);
        return () => { uiListeners = uiListeners.filter(f => f !== forceUpdate); };
    }, []);

    return (
        <HeaderBarButton
            tooltip={enabled ? "AntiDM: ON (right-click=logs)" : "AntiDM: OFF (right-click=logs)"}
            position="bottom"
            icon={() => <AntiDMIcon active={enabled} />}
            onClick={() => {
                enabled = !enabled;
                notifyUI();
            }}
            onContextMenu={(e: React.MouseEvent) => {
                e.preventDefault();
                openLogModal();
            }}
        />
    );
}

// ── Plugin ────────────────────────────────────────────────────────────────────

export default definePlugin({
    name: "AntiDM",
    description: "Blocks group DM invites with a log panel. Left-click icon = view logs. Right-click = toggle on/off.",
    authors: [{ name: "RainCord", id: 0n }],

    async start() {
        await loadLogs();
        addHeaderBarButton("AntiDM", AntiDMHeaderButton);
    },

    stop() {
        removeHeaderBarButton("AntiDM");
        enabled = false;
    },

    flux: {
        CHANNEL_CREATE: onChannelCreate,
    },
});
