/*
 * RAINCORD, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { addContextMenuPatch, NavContextMenuPatchCallback, removeContextMenuPatch } from "@api/ContextMenu";
import { HeaderBarButton } from "@api/HeaderBar";
import { DataStore } from "@api/index";
import { Logger } from "@utils/Logger";
import definePlugin from "@utils/types";
import { User, VoiceState } from "@vencord/discord-types";
import { ChannelStore, Constants, Menu, PermissionsBits, PermissionStore, React, RestAPI, Toasts, useEffect, UserStore, useState, VoiceStateStore } from "@webpack/common";

const logger = new Logger("FollowMe");

const DS_KEY = "followme-target-v1";

// ── Etat global ──────────────────────────────────────────────────────────────
interface Target {
    id: string;
    name: string;
}

const targets = new Map<string, string>();
const pending = new Set<string>();
let running = false;
let generation = 0;
let saveQueue = Promise.resolve();

const listeners = new Set<() => void>();
function notifyAll() { listeners.forEach(fn => fn()); }

function useFollowMeTargets() {
    const [, tick] = useState(0);
    useEffect(() => {
        const fn = () => tick(n => n + 1);
        listeners.add(fn);
        return () => { listeners.delete(fn); };
    }, []);
    return Array.from(targets, ([id, name]) => ({ id, name }));
}

function persist() {
    const saved = Array.from(targets, ([id, name]) => ({ id, name }));
    saveQueue = saveQueue.then(() => DataStore.set(DS_KEY, saved)).catch(error => {
        logger.error("Não foi possível salvar a seleção do Follow Me", error);
    });
}

async function moveTargetTo(userId: string, guildId: string, channelId: string) {
    if (!running || !targets.has(userId) || pending.has(userId)) return;
    const targetState = VoiceStateStore.getVoiceState(guildId, userId);
    if (!targetState?.channelId || targetState.channelId === channelId) return;
    const channel = ChannelStore.getChannel(channelId);
    const source = ChannelStore.getChannel(targetState.channelId);
    if (!channel || !source || source.guild_id !== guildId || channel.guild_id !== guildId) return;
    if (!PermissionStore.can(PermissionsBits.MOVE_MEMBERS, channel) || !PermissionStore.can(PermissionsBits.MOVE_MEMBERS, source)) return;
    const version = generation;
    pending.add(userId);
    try {
        await RestAPI.patch({
            url: Constants.Endpoints.GUILD_MEMBER(guildId, userId),
            body: { channel_id: channelId }
        });
    } catch (error) {
        logger.error("Não foi possível mover a pessoa no Follow Me", error);
    } finally {
        if (version === generation) {
            pending.delete(userId);
            const myId = UserStore.getCurrentUser()?.id;
            const current = myId ? VoiceStateStore.getVoiceStateForUser(myId) : undefined;
            const destination = current?.channelId ? ChannelStore.getChannel(current.channelId) : null;
            if (current?.channelId && destination?.guild_id === guildId && current.channelId !== channelId) {
                void moveTargetTo(userId, guildId, current.channelId);
            }
        }
    }
}

function followMe(userId: string) {
    if (!running || targets.has(userId)) return;
    const user = UserStore.getUser(userId);
    const name = user?.globalName ?? user?.username ?? userId;
    targets.set(userId, name);
    const myId = UserStore.getCurrentUser()?.id;
    const myState = myId ? VoiceStateStore.getVoiceStateForUser(myId) : undefined;
    const channel = myState?.channelId ? ChannelStore.getChannel(myState.channelId) : null;
    if (myState?.channelId && channel?.guild_id) {
        void moveTargetTo(userId, channel.guild_id, myState.channelId);
    }
    notifyAll();
    persist();
    Toasts.show({ message: `Follow Me ativado para ${name}.`, type: Toasts.Type.SUCCESS, id: Toasts.genId() });
}

function unfollowMe(userId?: string) {
    const name = userId ? targets.get(userId) : undefined;
    if (userId) targets.delete(userId);
    else targets.clear();
    notifyAll();
    persist();
    Toasts.show({ message: name ? `Follow Me desligado para ${name}.` : "Follow Me desligado para todos.", type: Toasts.Type.MESSAGE, id: Toasts.genId() });
}

// ── Icone ──
function FollowMeIcon({ filled = false }: { filled?: boolean; }) {
    return (
        <svg width="20" height="20" viewBox="0 0 24 24">
            <path
                fill={filled ? "#3ba55d" : "currentColor"}
                d="M15,10V5H13V10.5C13,10.78 13.22,11 13.5,11H18V9H15.5L18.41,6.09L17,4.68L14.09,7.59V5H12V11A1,1 0 0,0 13,12H19A1,1 0 0,0 20,11V5A1,1 0 0,0 19,4H13V2H19A3,3 0 0,1 22,5V11A3,3 0 0,1 19,14H13.81L14.41,15.79L12.5,16.41L11.5,13.5C11.31,12.92 10.77,12.5 10.16,12.5H6.5A1,1 0 0,0 5.5,13.5V20.5A1,1 0 0,0 6.5,21.5H9.5V23.5H6.5A3,3 0 0,1 3.5,20.5V13.5A3,3 0 0,1 6.5,10.5H9.5V7A3,3 0 0,1 12.5,4H13V2H12.5A5,5 0 0,0 7.5,7V10.5H6.5A5,5 0 0,0 1.5,15.5V20.5A5,5 0 0,0 6.5,25.5H9.5V23.5H6.5A3,3 0 0,1 3.5,20.5V15.5A3,3 0 0,1 6.5,12.5H7.5V15.5A1,1 0 0,0 8.5,16.5H11.5L12.5,19.41L14.41,17.5L12,15.09V13.41L15.09,16.5L17,14.59L13.91,11.5H15V10Z"
            />
        </svg>
    );
}

// ── HeaderBar Button ──
function FollowMeHeaderButton() {
    const selected = useFollowMeTargets();
    if (!selected.length) return null;

    return (
        <HeaderBarButton
            icon={() => (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="#3ba55d">
                    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 14.5v-9l6 4.5-6 4.5z" />
                </svg>
            )}
            tooltip={`Desligar Follow Me (${selected.length}): ${selected.map(target => target.name).join(", ")}`}
            onClick={() => unfollowMe()}
        />
    );
}

// ── Context Menu ──
const ctxPatch: NavContextMenuPatchCallback = (children, props: { user?: User; }) => {
    if (!children || !Array.isArray(children)) return;
    try {
        const userId: string | undefined = props?.user?.id;
        if (!userId || userId === UserStore.getCurrentUser()?.id) return;

        const isFollowed = targets.has(userId);

        children.push(
            <Menu.MenuCheckboxItem
                id="follow-me-ctx"
                label={isFollowed ? "Desligar Follow Me para esta pessoa" : "Follow Me"}
                checked={isFollowed}
                action={() => { if (isFollowed) unfollowMe(userId); else followMe(userId); }}
            />
        );
    } catch (e) {
        logger.error("Context menu patch error", e);
    }
};

// ── Plugin ───────────────────────────────────────────────────────────────────
export default definePlugin({
    name: "FollowMe",
    description: "Move as pessoas selecionadas para seu canal de voz no mesmo servidor, quando você tem permissão. Clique com o botão direito e marque Follow Me.",
    authors: [{ name: "RAINCORD", id: 0n }],

    headerBarButton: {
        icon: () => <FollowMeIcon filled={true} />,
        render: FollowMeHeaderButton,
        priority: 6,
    },

    flux: {
        VOICE_STATE_UPDATES({ voiceStates }: { voiceStates: VoiceState[]; }) {
            if (!running || !targets.size) return;
            const myId = UserStore.getCurrentUser()?.id;
            if (!myId) return;
            const myEvent = voiceStates.find(state => state.userId === myId);
            const myState = myEvent ?? VoiceStateStore.getVoiceStateForUser(myId);
            const channel = myState?.channelId ? ChannelStore.getChannel(myState.channelId) : null;
            if (!myState?.channelId || !channel?.guild_id) return;
            const userIds = myEvent ? targets.keys() : voiceStates.filter(state => targets.has(state.userId)).map(state => state.userId);
            for (const userId of userIds) void moveTargetTo(userId, channel.guild_id, myState.channelId);
        }
    },

    async start() {
        running = true;
        const version = ++generation;
        try {
            const saved = await DataStore.get<Target[] | Target | null>(DS_KEY);
            if (!running || version !== generation) return;
            for (const target of Array.isArray(saved) ? saved : saved ? [saved] : []) {
                if (typeof target.id === "string") targets.set(target.id, target.name ?? target.id);
            }
            notifyAll();
        } catch (error) {
            logger.error("Não foi possível restaurar o Follow Me", error);
        }
        if (!running || version !== generation) return;
        addContextMenuPatch("user-context", ctxPatch);
        addContextMenuPatch("user-profile-actions", ctxPatch);
    },

    stop() {
        running = false;
        ++generation;
        targets.clear();
        pending.clear();
        notifyAll();
        removeContextMenuPatch("user-context", ctxPatch);
        removeContextMenuPatch("user-profile-actions", ctxPatch);
    },
});
