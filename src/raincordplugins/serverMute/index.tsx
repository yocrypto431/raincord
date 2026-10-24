/*
 * RAINCORD, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import * as DataStore from "@api/DataStore";
import { UserAreaButton, UserAreaButtonFactory } from "@api/UserArea";
import { Logger } from "@utils/Logger";
import definePlugin from "@utils/types";
import { User, VoiceState } from "@vencord/discord-types";
import { ChannelStore, Constants, ContextMenuApi, GuildStore, Menu, PermissionsBits, PermissionStore, React, RestAPI, showToast, Toasts, UserStore, VoiceStateStore } from "@webpack/common";

interface Target {
    id: string;
    name: string;
    active: boolean;
    guilds: string[];
}

const logger = new Logger("ServerMute");
const MIN_REQUEST_GAP = 2000;
const targets = new Map<string, Target>();
const pending = new Set<string>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();
const lastRequest = new Map<string, number>();
const warned = new Set<string>();
const listeners = new Set<() => void>();
let accountId: string | undefined;
let running = false;
let ready = false;
let generation = 0;
let saveQueue = Promise.resolve();

function notify() {
    for (const listener of listeners) listener();
}

function persist() {
    if (!accountId) return;
    const key = `ServerMute:targets:${accountId}`;
    const saved = Array.from(targets.values(), target => ({ ...target, guilds: [...target.guilds] }));
    saveQueue = saveQueue.then(() => DataStore.set(key, saved)).catch(error => {
        logger.error("Não foi possível salvar o mute fixo", error);
        showToast("Não foi possível salvar o mute fixo para a próxima sessão.", Toasts.Type.FAILURE);
    });
}

function schedule(userId: string, guildId: string, delay = MIN_REQUEST_GAP) {
    const key = `${guildId}:${userId}`;
    if (timers.has(key) || !running) return;
    timers.set(key, setTimeout(() => {
        timers.delete(key);
        void reconcile(userId, guildId);
    }, delay));
}

async function reconcile(userId: string, guildId: string) {
    if (!running || accountId !== UserStore.getCurrentUser()?.id) return;
    const target = targets.get(userId);
    if (!target || (!target.active && !target.guilds.includes(guildId))) return;
    const key = `${guildId}:${userId}`;
    if (pending.has(key)) return;
    const state = VoiceStateStore.getVoiceState(guildId, userId);
    const channel = state?.channelId ? ChannelStore.getChannel(state.channelId) : null;
    if (!state || !channel || channel.guild_id !== guildId) return;
    if (!PermissionStore.can(PermissionsBits.MUTE_MEMBERS, channel)) return;
    if (target.active === state.mute) {
        if (!target.active) {
            target.guilds = target.guilds.filter(id => id !== guildId);
            persist();
        }
        return;
    }
    const remaining = MIN_REQUEST_GAP - (Date.now() - (lastRequest.get(key) ?? 0));
    if (remaining > 0) {
        schedule(userId, guildId, remaining);
        return;
    }
    const desired = target.active;
    let succeeded = false;
    const currentGeneration = generation;
    if (desired && !target.guilds.includes(guildId)) {
        target.guilds.push(guildId);
        persist();
    }
    pending.add(key);
    lastRequest.set(key, Date.now());
    try {
        await RestAPI.patch({
            url: Constants.Endpoints.GUILD_MEMBER(guildId, userId),
            body: { mute: desired }
        });
        if (generation !== currentGeneration) return;
        succeeded = true;
        warned.delete(key);
        if (!desired) {
            target.guilds = target.guilds.filter(id => id !== guildId);
            persist();
        }
    } catch (error) {
        if (generation !== currentGeneration) return;
        logger.error("Não foi possível alterar o mute fixo", error);
        if (!warned.has(key)) {
            warned.add(key);
            showToast(`Não foi possível ${desired ? "mutar" : "desmutar"} ${target.name} em ${GuildStore.getGuild(guildId)?.name ?? "um servidor"}. Confira suas permissões.`, Toasts.Type.FAILURE);
        }
        const response = error as { status?: number; body?: { retry_after?: number; }; };
        if (response.status === 429) {
            const retryAfter = Number(response.body?.retry_after);
            const delay = Number.isFinite(retryAfter) && retryAfter > 0 ? Math.max(MIN_REQUEST_GAP, retryAfter * 1000 + 250) : MIN_REQUEST_GAP;
            lastRequest.set(key, Date.now() + delay - MIN_REQUEST_GAP);
            schedule(userId, guildId, delay);
        }
    } finally {
        if (generation === currentGeneration) {
            pending.delete(key);
            const latest = VoiceStateStore.getVoiceState(guildId, userId);
            if (running && (target.active !== desired || (succeeded && latest?.channelId && latest.mute !== target.active))) schedule(userId, guildId);
        }
    }
}

function reconcileAll(userId?: string) {
    for (const target of targets.values()) {
        if (userId && target.id !== userId) continue;
        const guildIds = new Set([...GuildStore.getGuildIds(), ...target.guilds]);
        for (const guildId of guildIds) void reconcile(target.id, guildId);
    }
}

function toggleTarget(user: Pick<User, "id" | "username" | "globalName">) {
    if (!running || !ready || user.id === accountId) return;
    const target = targets.get(user.id) ?? { id: user.id, name: user.globalName ?? user.username, active: false, guilds: [] };
    target.active = !target.active;
    targets.set(user.id, target);
    persist();
    notify();
    reconcileAll(user.id);
    showToast(target.active
        ? `Mute fixo ativado para ${target.name}. Aplicado onde você tem permissão, quando a pessoa está em voz.`
        : `Mute fixo desligado para ${target.name}. Liberando os mutes controlados pelo Raincord.`, Toasts.Type.SUCCESS);
}

function MuteIcon({ className, active = false }: { className?: string; active?: boolean; }) {
    return <svg className={className} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={active ? "var(--status-danger)" : "currentColor"} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M9 9V5a3 3 0 0 1 6 0v6M5 10v2a7 7 0 0 0 12 5M19 10v2a7 7 0 0 1-.3 2M12 19v3M8 22h8M3 3l18 18" />
        {active && <circle cx="19" cy="4" r="3" fill="var(--status-danger)" stroke="var(--background-base-low, var(--background-secondary))" />}
    </svg>;
}

const MuteButton: UserAreaButtonFactory = ({ iconForeground, hideTooltips }) => {
    const [, refresh] = React.useReducer(value => value + 1, 0);
    React.useEffect(() => {
        const listener = () => refresh();
        listeners.add(listener);
        return () => { listeners.delete(listener); };
    }, []);
    const entries = Array.from(targets.values());
    const active = entries.filter(target => target.active);
    const openMenu = (event: React.MouseEvent<HTMLDivElement>) => {
        ContextMenuApi.openContextMenu(event, () => <Menu.Menu navId="raincord-fixed-mute" onClose={ContextMenuApi.closeContextMenu} aria-label="Mute fixo">
            <Menu.MenuGroup label="Mute fixo nos servidores">
                {entries.length ? entries.map(target => <Menu.MenuCheckboxItem
                    key={target.id}
                    id={`raincord-unmute-${target.id}`}
                    label={target.name}
                    subtext={target.active ? "Clique para desligar e desmutar" : "Clique para ativar novamente"}
                    checked={target.active}
                    color={target.active ? "danger" : undefined}
                    action={() => toggleTarget({ id: target.id, username: target.name, globalName: undefined })}
                />) : <Menu.MenuItem id="raincord-mute-empty" label="Nenhuma pessoa selecionada" subtext="Clique com o botão direito em uma pessoa para ativar Mute fixo." disabled />}
            </Menu.MenuGroup>
        </Menu.Menu>);
    };
    return <UserAreaButton
        icon={<MuteIcon className={iconForeground} active={active.length > 0} />}
        tooltipText={hideTooltips ? undefined : active.length ? `Mute fixo ligado: ${active.map(target => target.name).join(", ")}. Clique para gerenciar.` : entries.length === 1 ? `Mute fixo desligado: clique para ativar para ${entries[0].name}` : "Mute fixo: selecione uma pessoa pelo botão direito"}
        aria-label="Gerenciar mute fixo"
        redGlow={active.length > 0}
        onClick={entries.length === 1 ? () => toggleTarget({ id: entries[0].id, username: entries[0].name, globalName: undefined }) : openMenu}
        disabled={!ready}
        onContextMenu={openMenu}
    />;
};

const patch: NavContextMenuPatchCallback = (children, { user }: { user?: User; }) => {
    if (!running || !ready || !user || user.id === accountId) return;
    const target = targets.get(user.id);
    const active = target?.active ?? false;
    children.push(<Menu.MenuCheckboxItem
        id="raincord-server-mute"
        label={active ? "Desligar mute fixo e desmutar" : "Manter mutado nos servidores"}
        subtext="Servidores em comum onde você tem permissão. Requer o Raincord aberto."
        checked={active}
        color={active ? "danger" : undefined}
        icon={() => <MuteIcon active={active} />}
        action={() => toggleTarget(user)}
    />);
};

async function loadAccount() {
    ready = false;
    const version = ++generation;
    accountId = UserStore.getCurrentUser()?.id;
    targets.clear();
    pending.clear();
    lastRequest.clear();
    warned.clear();
    for (const timer of timers.values()) clearTimeout(timer);
    timers.clear();
    notify();
    if (!accountId) return;
    try {
        const saved = await DataStore.get<Target[]>(`ServerMute:targets:${accountId}`);
        if (!running || version !== generation) return;
        for (const target of saved ?? []) {
            if (typeof target.id === "string" && typeof target.name === "string" && typeof target.active === "boolean" && Array.isArray(target.guilds)) targets.set(target.id, target);
        }
        ready = true;
        notify();
        reconcileAll();
    } catch (error) {
        logger.error("Não foi possível carregar o mute fixo", error);
        showToast("Não foi possível restaurar a lista de mute fixo.", Toasts.Type.FAILURE);
    }
}

export default definePlugin({
    name: "ServerMute",
    description: "Mantém pessoas selecionadas mutadas nos servidores em comum onde você tem permissão, enquanto o Raincord estiver aberto.",
    authors: [{ name: "RAINCORD", id: 0n }],
    userAreaButton: { icon: MuteIcon, render: MuteButton },
    contextMenus: { "user-context": patch, "user-profile-actions": patch },
    flux: {
        VOICE_STATE_UPDATES({ voiceStates }: { voiceStates: VoiceState[]; }) {
            for (const state of voiceStates) {
                if (!state.channelId || !targets.has(state.userId)) continue;
                const guildId = state.guildId ?? ChannelStore.getChannel(state.channelId)?.guild_id;
                if (guildId) void reconcile(state.userId, guildId);
            }
        },
        CONNECTION_OPEN() { running = true; void loadAccount(); },
        CONNECTION_RESUMED() { reconcileAll(); },
        GUILD_CREATE() { reconcileAll(); },
        LOGOUT() {
            running = false;
            ready = false;
            ++generation;
            targets.clear();
            for (const timer of timers.values()) clearTimeout(timer);
            timers.clear();
            notify();
        }
    },
    start() {
        running = true;
        void loadAccount();
    },
    stop() {
        running = false;
        ready = false;
        ++generation;
        for (const timer of timers.values()) clearTimeout(timer);
        timers.clear();
        targets.clear();
        pending.clear();
        notify();
    }
});
