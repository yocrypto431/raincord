import { definePluginSettings } from "@api/Settings";
import { Logger } from "@utils/Logger";
import definePlugin, { makeRange, OptionType } from "@utils/types";
import { findByPropsLazy, findStoreLazy } from "@webpack";
import { ChannelStore, Constants, MediaEngineStore, PermissionsBits, PermissionStore, RestAPI, showToast, Toasts, UserStore, VoiceActions } from "@webpack/common";

import { isProtectionEnabled } from "@raincordplugins/antiMoveDeco";

const logger = new Logger("AutoUnmute");

const VoiceStateStore = findStoreLazy("VoiceStateStore");
const FallbackVoiceActions = findByPropsLazy("toggleSelfMute", "toggleSelfDeaf");

interface VoiceState {
    userId: string;
    channelId?: string;
    guildId?: string;
    deaf: boolean;
    mute: boolean;
    selfDeaf: boolean;
    selfMute: boolean;
}

const settings = definePluginSettings({
    onlyWithAntiMoveDeco: {
        type: OptionType.BOOLEAN,
        description: "Only act while the AntiMove&Deco button is turned on",
        default: true
    },
    undoServerMute: {
        type: OptionType.BOOLEAN,
        description: "Undo server mute when you have Mute Members",
        default: true
    },
    undoServerDeafen: {
        type: OptionType.BOOLEAN,
        description: "Undo server deafen when you have Deafen Members",
        default: true
    },
    alsoClearSelfState: {
        type: OptionType.BOOLEAN,
        description: "Also turn off your own mute/deafen after the server state is lifted",
        default: true
    },
    maxAttempts: {
        type: OptionType.SLIDER,
        description: "Attempts per event before giving up",
        markers: makeRange(1, 8, 1),
        default: 4,
        stickToMarkers: true
    },
    retryDelay: {
        type: OptionType.SLIDER,
        description: "Delay between attempts (ms)",
        markers: makeRange(200, 3000, 200),
        default: 800,
        stickToMarkers: true
    },
    notifyOnFailure: {
        type: OptionType.BOOLEAN,
        description: "Show a toast when the unmute request is rejected",
        default: true
    }
});

let running = false;
let pending: ReturnType<typeof setTimeout> | undefined;
let warnedMissingPermission = false;
let lastEventState: VoiceState | null = null;
let inFlight = false;
let lastPatchAt = 0;

const MIN_PATCH_GAP = 700;

function guildMemberUrl(guildId: string, userId: string) {
    try {
        const endpoint = (Constants as any)?.Endpoints?.GUILD_MEMBER?.(guildId, userId);
        if (typeof endpoint === "string") return endpoint;
    } catch (err) {
        logger.debug("GUILD_MEMBER endpoint helper unavailable", err);
    }
    return `/guilds/${guildId}/members/${userId}`;
}

function getSelfVoiceState(): VoiceState | null {
    const userId = UserStore.getCurrentUser()?.id;
    if (!userId) return null;

    let stored: VoiceState | null = null;
    try {
        stored = VoiceStateStore.getVoiceStateForUser(userId) ?? null;
    } catch (err) {
        logger.debug("Could not read own voice state", err);
    }

    if (!stored) return lastEventState;
    if (stored.guildId || !lastEventState?.guildId) return stored;

    return { ...stored, guildId: lastEventState.guildId };
}

function clearSelfState(state: VoiceState) {
    if (!settings.store.alsoClearSelfState) return;

    const actions = (() => {
        try {
            if (typeof VoiceActions?.toggleSelfMute === "function") return VoiceActions;
        } catch (err) {
            logger.debug("Common VoiceActions unavailable", err);
        }
        try {
            if (typeof FallbackVoiceActions?.toggleSelfMute === "function") return FallbackVoiceActions;
        } catch (err) {
            logger.debug("Fallback VoiceActions unavailable", err);
        }
        return null;
    })();

    if (!actions) {
        logger.warn("No voice actions module found, cannot clear self mute");
        return;
    }

    try {
        if (MediaEngineStore.isSelfDeaf()) {
            actions.toggleSelfDeaf();
            logger.info("self deafen cleared");
        }
        if (MediaEngineStore.isSelfMute()) {
            actions.toggleSelfMute();
            logger.info("self mute cleared");
        }
    } catch (err) {
        logger.warn("Failed to clear own mute state", err);
    }
}

function sleep(ms: number) {
    return new Promise<void>(resolve => setTimeout(resolve, ms));
}

function isGateOpen() {
    try {
        return isProtectionEnabled();
    } catch (err) {
        logger.warn("Could not read AntiMove&Deco state, acting anyway", err);
        return true;
    }
}

async function enforce(attempt = 1, eventState?: VoiceState) {
    if (!running) return;

    if (settings.store.onlyWithAntiMoveDeco && !isGateOpen()) {
        logger.info("AntiMove&Deco is off, ignoring");
        return;
    }

    if (inFlight && attempt === 1) {
        logger.info("already working, ignoring duplicate trigger");
        return;
    }

    inFlight = true;
    try {
        const userId = UserStore.getCurrentUser()?.id;
        const state = eventState ?? getSelfVoiceState();

        if (!userId || !state?.channelId) {
            logger.info("Nothing to do: not connected to a voice channel");
            return;
        }

        const channel = ChannelStore.getChannel(state.channelId);
        if (!channel) {
            logger.warn(`Channel ${state.channelId} not in store`);
            return;
        }

        const guildId = state.guildId ?? (channel as any).guild_id ?? null;
        if (!guildId) {
            logger.info("Voice channel is not in a guild, server mute cannot exist");
            return;
        }

        logger.info(`attempt ${attempt}: mute=${state.mute} deaf=${state.deaf} selfMute=${state.selfMute} selfDeaf=${state.selfDeaf} guild=${guildId}`);

        const body: Record<string, boolean> = {};

        if (state.mute && settings.store.undoServerMute) {
            const allowed = PermissionStore.can(PermissionsBits.MUTE_MEMBERS, channel);
            logger.info(`server muted, MUTE_MEMBERS=${allowed}`);
            if (allowed) {
                body.mute = false;
            } else if (!warnedMissingPermission && settings.store.notifyOnFailure) {
                warnedMissingPermission = true;
                showToast("AutoUnmute: missing Mute Members permission.", Toasts.Type.FAILURE);
            }
        }

        if (state.deaf && settings.store.undoServerDeafen) {
            const allowed = PermissionStore.can(PermissionsBits.DEAFEN_MEMBERS, channel);
            logger.info(`server deafened, DEAFEN_MEMBERS=${allowed}`);
            if (allowed) {
                body.deaf = false;
            } else if (!warnedMissingPermission && settings.store.notifyOnFailure) {
                warnedMissingPermission = true;
                showToast("AutoUnmute: missing Deafen Members permission.", Toasts.Type.FAILURE);
            }
        }

        if (!Object.keys(body).length) {
            if (!state.mute && !state.deaf) clearSelfState(state);
            return;
        }

        const gap = Date.now() - lastPatchAt;
        if (gap < MIN_PATCH_GAP) await sleep(MIN_PATCH_GAP - gap);

        const url = guildMemberUrl(guildId, userId);

        try {
            lastPatchAt = Date.now();
            await RestAPI.patch({ url, body });
            logger.info(`PATCH ${url} ${JSON.stringify(body)} ok`);
            warnedMissingPermission = false;
            clearSelfState(state);
            return;
        } catch (err: any) {
            const status = err?.status ?? err?.body?.code;

            if (status === 429) {
                const retryAfter = Number(err?.body?.retry_after ?? err?.retry_after ?? 1);
                const waitMs = Math.min(10000, Math.max(500, retryAfter * 1000)) + 250;
                logger.warn(`rate limited (429), retrying in ${waitMs}ms`);
                lastPatchAt = Date.now() + waitMs;

                if (attempt < settings.store.maxAttempts) {
                    await sleep(waitMs);
                    const fresh = getSelfVoiceState();
                    if (fresh?.mute || fresh?.deaf) await enforce(attempt + 1, fresh ?? undefined);
                }
                return;
            }

            logger.warn(`PATCH ${url} failed (status ${status})`, err);

            if (status === 403 && settings.store.notifyOnFailure && !warnedMissingPermission) {
                warnedMissingPermission = true;
                showToast("AutoUnmute: Discord rejected the unmute (403).", Toasts.Type.FAILURE);
                return;
            }
        }

        if (attempt >= settings.store.maxAttempts) return;

        await sleep(settings.store.retryDelay);
        const current = getSelfVoiceState();
        if (!current) return;
        if ((current.mute && settings.store.undoServerMute) || (current.deaf && settings.store.undoServerDeafen)) {
            await enforce(attempt + 1, current);
        } else {
            clearSelfState(current);
        }
    } finally {
        if (attempt === 1) inFlight = false;
    }
}

function schedule() {
    if (pending !== undefined) return;
    pending = setTimeout(() => {
        pending = undefined;
        void enforce(1);
    }, 150);
}

export default definePlugin({
    name: "AutoUnmute",
    description: "Automatically lifts server mute and server deafen on yourself when you have the permissions.",
    authors: [{ name: "Bash", id: 1327483363518582784n }],
    settings,

    flux: {
        VOICE_STATE_UPDATES({ voiceStates }: { voiceStates: VoiceState[]; }) {
            if (!running) return;

            const myId = UserStore.getCurrentUser()?.id;
            if (!myId) return;

            const myState = voiceStates.find(state => state.userId === myId);
            if (!myState?.channelId) return;

            lastEventState = myState;
            if (!myState.mute && !myState.deaf) return;

            logger.info(`event: mute=${myState.mute} deaf=${myState.deaf} guild=${myState.guildId}`);
            void enforce(1, myState);
        },

        VOICE_CHANNEL_SELECT({ channelId }: { channelId: string | null; }) {
            if (!running || !channelId) return;
            schedule();
        },

        CONNECTION_OPEN() {
            if (!running) return;
            schedule();
        }
    },

    start() {
        running = true;
        warnedMissingPermission = false;
        logger.info("started");
        schedule();
    },

    stop() {
        running = false;
        lastEventState = null;
        if (pending !== undefined) clearTimeout(pending);
        pending = undefined;
    }
});
