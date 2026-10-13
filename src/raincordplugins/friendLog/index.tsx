/*
 * RainCord — FriendLog Plugin
 * Loga pedidos de amizade e remoções. Visual clean estilo Discord.
 */

import "./styles.css";

import * as DataStore from "@api/DataStore";
import { addHeaderBarButton, HeaderBarButton, removeHeaderBarButton } from "@api/HeaderBar";
import { showNotification } from "@api/Notifications";
import { classNameFactory } from "@utils/css";
import { openUserProfile } from "@utils/discord";
import { Logger } from "@utils/Logger";
import { ModalCloseButton,ModalContent, ModalHeader, ModalRoot, ModalSize, openModal } from "@utils/modal";
import definePlugin from "@utils/types";
import { IconUtils,React, useEffect, UserStore, useState } from "@webpack/common";

const cl = classNameFactory("rc-friend-log-");
const logger = new Logger("FriendLog");

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

function resolveUser(id: string): { name: string; avatar: string | null; } {
    const user = UserStore.getUser(id);
    if (!user) return { name: id, avatar: null };

    return { name: user.username ?? user.globalName ?? id, avatar: IconUtils.getUserAvatarURL(user, false, 128) };
}

// ── Flux Handlers ─────────────────────────────────────────────────────────────

async function onRelationshipAdd(event: any) {
    const { relationship } = event;
    if (!relationship) return;
    const { id, type } = relationship;
    const info = resolveUser(id);

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
    const info = resolveUser(id);

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
        case "friend_added": return "agora está na sua lista de amigos.";
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
    if (mins < 1) return "agora";
    if (mins < 60) return `${mins}m`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `${days}d`;
    const months = Math.floor(days / 30);
    return `${months} meses`;
}

// ── Open Profile ──────────────────────────────────────────────────────────────

async function openProfile(userId: string): Promise<boolean> {
    try {
        await openUserProfile(userId);
        return true;
    } catch (error) {
        logger.error("Failed to open profile", error);
        showNotification({ title: "Não foi possível abrir o perfil", body: "Tente novamente em alguns instantes." });
        return false;
    }
}

// ── Modal ─────────────────────────────────────────────────────────────────────

function FriendLogModal({ onClose }: { onClose: () => void; }) {
    const [localEvents, setLocalEvents] = useState<FriendEvent[]>(() => [...events].reverse());
    const [filter, setFilter] = useState<"all" | EventType>("all");
    const [opening, setOpening] = useState<string | null>(null);

    useEffect(() => {
        const update = () => {
            unreadCount = 0;
            setLocalEvents([...events].reverse());
        };
        uiListeners.push(update);
        unreadCount = 0;
        notifyUI();
        return () => { uiListeners = uiListeners.filter(listener => listener !== update); };
    }, []);

    const clearAll = async () => {
        events = [];
        unreadCount = 0;
        notifyUI();
        try {
            await saveEvents();
        } catch (error) {
            logger.error("Failed to clear history", error);
            showNotification({ title: "Erro ao salvar", body: "Não foi possível salvar a limpeza do histórico." });
        }
    };
    const filtered = filter === "all" ? localEvents : localEvents.filter(event => event.type === filter);
    const filters: Array<{ key: "all" | EventType; label: string; }> = [
        { key: "all", label: "Todos" },
        { key: "request_received", label: "Pedidos" },
        { key: "friend_added", label: "Adicionados" },
        { key: "friend_removed", label: "Removidos" },
        { key: "request_cancelled", label: "Cancelados" }
    ];

    return (
        <>
            <ModalHeader separator={false} className={cl("header")}>
                <div className={cl("heading")}>
                    <h2 className={cl("title")}>FriendLog</h2>
                    <p className={cl("subtitle")}>Seu histórico de amizades</p>
                </div>
                <button type="button" className={cl("clear")} onClick={clearAll} disabled={!localEvents.length}>Limpar histórico</button>
                <ModalCloseButton onClick={onClose} />
            </ModalHeader>
            <div className={cl("filters")} role="group" aria-label="Filtrar atividades">
                {filters.map(item => (
                    <button type="button" key={item.key} className={cl("filter")} aria-pressed={filter === item.key} onClick={() => setFilter(item.key)}>
                        {item.label}
                        <span className={cl("count")}>{item.key === "all" ? localEvents.length : localEvents.filter(event => event.type === item.key).length}</span>
                    </button>
                ))}
            </div>
            <ModalContent className={cl("content")}>
                {filtered.length === 0 ? (
                    <div className={cl("empty")}>
                        <strong>Nenhuma atividade por aqui</strong>
                        <p>{localEvents.length ? "Escolha outro filtro para ver os registros." : "Novos pedidos e mudanças nas amizades aparecerão aqui."}</p>
                    </div>
                ) : (
                    <ul className={cl("list")}>
                        {filtered.map(event => (
                            <li key={event.id}>
                                <button type="button" className={cl("entry")} disabled={opening !== null} aria-busy={opening === event.id}
                                    onClick={async () => {
                                        setOpening(event.id);
                                        const opened = await openProfile(event.userId);
                                        if (opened) onClose();
                                        else setOpening(null);
                                    }}>
                                    <img className={cl("avatar")} src={event.avatar ?? IconUtils.getDefaultAvatarURL(event.userId)} width={40} height={40} alt="" loading="lazy" />
                                    <span className={cl("details")}>
                                        <strong className={cl("username")}>{event.username}</strong>
                                        <span className={cl("description")}>{getEventText(event)}</span>
                                        <span className={cl("meta")}>
                                            <span className={cl("dot")} style={{ backgroundColor: getEventDot(event.type) }} />
                                            <span>{filters.find(item => item.key === event.type)?.label}</span>
                                            <span aria-hidden="true">·</span>
                                            <time dateTime={new Date(event.timestamp).toISOString()} title={new Date(event.timestamp).toLocaleString("pt-BR")}>{timeAgo(event.timestamp)}</time>
                                        </span>
                                    </span>
                                    <span className={cl("open")}>{opening === event.id ? "Abrindo…" : "Ver perfil"}<span aria-hidden="true"> ↗</span></span>
                                </button>
                            </li>
                        ))}
                    </ul>
                )}
            </ModalContent>
            <div className={cl("footer")}>Histórico salvo neste dispositivo · Até 200 registros</div>
        </>
    );
}

function openFriendLogModal() {
    openModal(props => (
        <ModalRoot {...props} size={ModalSize.DYNAMIC} className={cl("modal")} aria-label="FriendLog">
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
