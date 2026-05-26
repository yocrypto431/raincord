/*
 * RainCord — FriendLog Plugin
 * Loga pedidos de amizade e remoções. Visual clean estilo Discord.
 */

import * as DataStore from "@api/DataStore";
import { addHeaderBarButton, HeaderBarButton, removeHeaderBarButton } from "@api/HeaderBar";
import { showNotification } from "@api/Notifications";
import definePlugin from "@utils/types";
import { openModal, ModalRoot, ModalSize, ModalHeader, ModalContent, ModalCloseButton } from "@utils/modal";
import { RestAPI, React, UserStore, useState, useEffect, Button, Forms } from "@webpack/common";
import { findByPropsLazy } from "@webpack";

const UserUtils = findByPropsLazy("getUser", "fetchCurrentUser");
const UserProfileActions = findByPropsLazy("openUserProfileModal", "closeUserProfileModal");

// ── Types ─────────────────────────────────────────────────────────────────────

type EventType = "request_received" | "request_cancelled" | "friend_removed" | "friend_added";

interface FriendEvent {
    id: string;
    userId: string;
    username: string;
    avatar: string | null;
    type: EventType;
    timestamp: number;
}

// ── State ─────────────────────────────────────────────────────────────────────

const STORE_KEY = "FriendLog_events";
let events: FriendEvent[] = [];
let unreadCount = 0;
let uiListeners: Array<() => void> = [];

function notifyUI() { uiListeners.forEach(f => f()); }

async function loadEvents() {
    events = (await DataStore.get<FriendEvent[]>(STORE_KEY)) ?? [];
}

async function saveEvents() {
    if (events.length > 200) events = events.slice(-200);
    await DataStore.set(STORE_KEY, events);
}

async function addEvent(ev: FriendEvent) {
    events.push(ev);
    unreadCount++;
    await saveEvents();
    notifyUI();
}

// ── Resolve user ──────────────────────────────────────────────────────────────

async function resolveUser(id: string): Promise<{ name: string; avatar: string | null; }> {
    try {
        let user = UserStore.getUser?.(id);
        if (!user) user = await UserUtils.getUser(id);
        if (user) {
            const avatar = user.avatar
                ? `https://cdn.discordapp.com/avatars/${id}/${user.avatar}.${user.avatar.startsWith("a_") ? "gif" : "png"}?size=128`
                : null;
            return { name: user.username ?? user.global_name ?? id, avatar };
        }
    } catch { }
    try {
        const res = await RestAPI.get({ url: `/users/${id}` });
        if (res.body) {
            const u = res.body;
            const avatar = u.avatar ? `https://cdn.discordapp.com/avatars/${id}/${u.avatar}.png?size=128` : null;
            return { name: u.username ?? u.global_name ?? id, avatar };
        }
    } catch { }
    return { name: id, avatar: null };
}

// ── Flux Handlers ─────────────────────────────────────────────────────────────

async function onRelationshipAdd(event: any) {
    const { relationship } = event;
    if (!relationship) return;
    const { id, type } = relationship;
    const info = await resolveUser(id);

    if (type === 3) {
        await addEvent({ id: crypto.randomUUID(), userId: id, username: info.name, avatar: info.avatar, type: "request_received", timestamp: Date.now() });
        showNotification({ title: "Friend Request", body: `${info.name} sent you a friend request` });
    } else if (type === 1) {
        await addEvent({ id: crypto.randomUUID(), userId: id, username: info.name, avatar: info.avatar, type: "friend_added", timestamp: Date.now() });
    }
}

async function onRelationshipRemove(event: any) {
    const { relationship } = event;
    if (!relationship) return;
    const { id, type } = relationship;
    const info = await resolveUser(id);

    if (type === 3) {
        await addEvent({ id: crypto.randomUUID(), userId: id, username: info.name, avatar: info.avatar, type: "request_cancelled", timestamp: Date.now() });
        showNotification({ title: "Friend Request", body: `${info.name} cancelled their friend request` });
    } else if (type === 1) {
        await addEvent({ id: crypto.randomUUID(), userId: id, username: info.name, avatar: info.avatar, type: "friend_removed", timestamp: Date.now() });
        showNotification({ title: "Friend Removed", body: `${info.name} is no longer your friend` });
    }
}

// ── Event descriptions ────────────────────────────────────────────────────────

function getEventText(ev: FriendEvent): string {
    switch (ev.type) {
        case "request_received": return "te enviou um pedido de amizade.";
        case "friend_added": return "aceitou seu pedido de amizade.";
        case "friend_removed": return "não é mais seu amigo.";
        case "request_cancelled": return "cancelou o pedido de amizade.";
    }
}

function getEventDot(type: EventType): string {
    switch (type) {
        case "request_received": return "#5865f2";
        case "friend_added": return "#23a55a";
        case "friend_removed": return "#f23f43";
        case "request_cancelled": return "#80848e";
    }
}

// ── Time formatting ───────────────────────────────────────────────────────────

function timeAgo(ts: number): string {
    const diff = Date.now() - ts;
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "now";
    if (mins < 60) return `${mins}m`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `${days}d`;
    const months = Math.floor(days / 30);
    return `${months}mo`;
}

// ── Open Profile ──────────────────────────────────────────────────────────────

function openProfile(userId: string) {
    try { UserProfileActions.openUserProfileModal?.({ userId }); } catch { }
}

// ── Modal ─────────────────────────────────────────────────────────────────────

function FriendLogModal({ onClose }: { onClose: () => void; }) {
    const [localEvents, setLocalEvents] = useState<FriendEvent[]>([...events].reverse());

    useEffect(() => {
        loadEvents().then(() => setLocalEvents([...events].reverse()));
        unreadCount = 0;
        notifyUI();
    }, []);

    const clearAll = async () => { events = []; await saveEvents(); setLocalEvents([]); };

    return (
        <>
            <ModalHeader separator={false}>
                <Forms.FormTitle tag="h2" style={{ margin: 0, flex: 1 }}>FriendLog</Forms.FormTitle>
                <button
                    onClick={clearAll}
                    style={{
                        background: "none", border: "none", color: "var(--interactive-normal)",
                        cursor: "pointer", fontSize: 12, padding: "4px 8px",
                    }}
                >
                    Mark All Read
                </button>
                <ModalCloseButton onClick={onClose} />
            </ModalHeader>
            <ModalContent>
                <div style={{ paddingBottom: 16 }}>
                    {localEvents.length === 0 ? (
                        <div style={{ textAlign: "center", padding: 48, color: "var(--text-muted)", fontSize: 14 }}>
                            Nothing here yet.
                        </div>
                    ) : localEvents.map(ev => (
                        <div
                            key={ev.id}
                            onClick={() => openProfile(ev.userId)}
                            style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 12,
                                padding: "12px 16px",
                                cursor: "pointer",
                                borderBottom: "1px solid var(--background-modifier-accent)",
                            }}
                            onMouseEnter={e => (e.currentTarget.style.background = "var(--background-modifier-hover)")}
                            onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
                        >
                            <img
                                src={ev.avatar ?? `https://cdn.discordapp.com/embed/avatars/${parseInt(ev.userId) % 5}.png`}
                                width={40}
                                height={40}
                                style={{ borderRadius: "50%", flexShrink: 0 }}
                                onError={e => { (e.target as HTMLImageElement).src = "https://cdn.discordapp.com/embed/avatars/0.png"; }}
                            />
                            <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontSize: 14, lineHeight: "18px" }}>
                                    <strong style={{ color: "var(--text-normal)" }}>{ev.username}</strong>
                                    {" "}
                                    <span style={{ color: "var(--text-muted)" }}>{getEventText(ev)}</span>
                                </div>
                                <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>
                                    {timeAgo(ev.timestamp)}
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            </ModalContent>
        </>
    );
}

function openFriendLogModal() {
    openModal(props => (
        <ModalRoot {...props} size={ModalSize.SMALL}>
            <FriendLogModal onClose={props.onClose} />
        </ModalRoot>
    ));
}

// ── Header Button ─────────────────────────────────────────────────────────────

function FriendLogHeaderButton() {
    const [, forceUpdate] = React.useReducer(x => x + 1, 0);
    useEffect(() => {
        uiListeners.push(forceUpdate);
        return () => { uiListeners = uiListeners.filter(f => f !== forceUpdate); };
    }, []);

    return (
        <HeaderBarButton
            tooltip="FriendLog"
            position="bottom"
            icon={() => (
                <div style={{ position: "relative" }}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M18.5 4A1.5 1.5 0 0 0 17 5.5V7h-4V5.5A1.5 1.5 0 0 0 11.5 4h-3A1.5 1.5 0 0 0 7 5.5V7H5.5A1.5 1.5 0 0 0 4 8.5v10A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5v-10A1.5 1.5 0 0 0 18.5 7H17V5.5A1.5 1.5 0 0 0 15.5 4h-3zM9 6h6v1H9V6zm-3 3h12v9H6V9zm3 2v2h2v-2H9zm4 0v2h2v-2h-2zm-4 3v2h2v-2H9zm4 0v2h2v-2h-2z" />
                    </svg>
                    {unreadCount > 0 && (
                        <div style={{
                            position: "absolute",
                            top: -3,
                            right: -3,
                            background: "#f23f43",
                            color: "white",
                            fontSize: 9,
                            fontWeight: 700,
                            minWidth: 14,
                            height: 14,
                            borderRadius: 7,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            padding: "0 3px",
                        }}>
                            {unreadCount > 9 ? "9+" : unreadCount}
                        </div>
                    )}
                </div>
            )}
            onClick={openFriendLogModal}
        />
    );
}

// ── Plugin ────────────────────────────────────────────────────────────────────

export default definePlugin({
    name: "FriendLog",
    description: "Logs friend requests and removals. Click entries to view profiles.",
    authors: [{ name: "RainCord", id: 0n }],

    flux: {
        RELATIONSHIP_ADD: onRelationshipAdd,
        RELATIONSHIP_REMOVE: onRelationshipRemove,
    },

    async start() {
        await loadEvents();
        addHeaderBarButton("FriendLog", FriendLogHeaderButton);
    },

    stop() {
        removeHeaderBarButton("FriendLog");
    },
});
