import { showNotification } from "@api/Notifications";
import { definePluginSettings } from "@api/Settings";
import { UserAreaButton, UserAreaButtonFactory, UserAreaRenderProps } from "@api/UserArea";
import { Logger } from "@utils/Logger";
import definePlugin, { makeRange, OptionType } from "@utils/types";
import { VoiceState } from "@vencord/discord-types";
import { findByPropsLazy } from "@webpack";
import { ChannelActions, ChannelStore, FluxDispatcher, React, SelectedChannelStore, UserStore, VoiceStateStore } from "@webpack/common";

const logger = new Logger("AntiMoveDeco");

const VoiceChannelActions = findByPropsLazy("selectVoiceChannel", "disconnect");

const settings = definePluginSettings({
    rejoinDelay: {
        type: OptionType.SLIDER,
        description: "Delay before the first attempt to return (ms)",
        markers: makeRange(100, 2000, 100),
        default: 400,
        stickToMarkers: true
    },
    retryInterval: {
        type: OptionType.SLIDER,
        description: "Interval between retries while still out of the channel (ms)",
        markers: makeRange(500, 5000, 500),
        default: 1500,
        stickToMarkers: true
    },
    maxAttempts: {
        type: OptionType.SLIDER,
        description: "Maximum number of attempts to return",
        markers: makeRange(1, 15, 1),
        default: 8,
        stickToMarkers: true
    },
    followManualMove: {
        type: OptionType.BOOLEAN,
        description: "If you move yourself, protect the new channel instead of going back",
        default: true
    },
    disableOnManualLeave: {
        type: OptionType.BOOLEAN,
        description: "Turn the protection off when you disconnect yourself",
        default: true
    },
    skipEndedCalls: {
        type: OptionType.BOOLEAN,
        description: "Do not rejoin a DM call when nobody else is left in it",
        default: true
    },
    showNotifications: {
        type: OptionType.BOOLEAN,
        description: "Notify when a move or disconnect is blocked",
        default: true
    }
});

interface Target {
    channelId: string;
    guildId: string | null;
}

let enabled = false;
let target: Target | null = null;
let attempts = 0;
let rejoinTimer: ReturnType<typeof setTimeout> | undefined;
let intentionalChannelId: string | null | undefined;
let intentionalTimer: ReturnType<typeof setTimeout> | undefined;
let selfRejoining = false;
const unwrappers: Array<() => void> = [];
const listeners = new Set<() => void>();

export function isProtectionEnabled() {
    return enabled;
}

export function getProtectedChannelId() {
    return target?.channelId ?? null;
}

function notifyListeners() {
    for (const listener of listeners) listener();
}

function setEnabled(value: boolean) {
    enabled = value;
    if (!value) {
        target = null;
        cancelRejoin();
    }
    notifyListeners();
}

function cancelRejoin() {
    if (rejoinTimer !== undefined) {
        clearTimeout(rejoinTimer);
        rejoinTimer = undefined;
    }
    attempts = 0;
}

function markIntentional(channelId: string | null) {
    if (selfRejoining) return;
    intentionalChannelId = channelId;
    if (intentionalTimer !== undefined) clearTimeout(intentionalTimer);
    intentionalTimer = setTimeout(() => {
        intentionalChannelId = undefined;
        intentionalTimer = undefined;
    }, 4000);
}

function getVoiceModules(): any[] {
    const modules: any[] = [];
    for (const candidate of [VoiceChannelActions, ChannelActions]) {
        try {
            if (candidate && typeof candidate.selectVoiceChannel === "function" && !modules.includes(candidate)) {
                modules.push(candidate);
            }
        } catch (err) {
            logger.debug("Voice module unavailable", err);
        }
    }
    return modules;
}

function wrapLeaveActions() {
    for (const module of getVoiceModules()) {
        const originalSelect = module.selectVoiceChannel;
        module.selectVoiceChannel = function (channelId: string | null, ...args: unknown[]) {
            markIntentional(channelId ?? null);
            return originalSelect.apply(this, [channelId, ...args]);
        };
        unwrappers.push(() => { module.selectVoiceChannel = originalSelect; });

        try {
            if (typeof module.disconnect === "function") {
                const originalDisconnect = module.disconnect;
                module.disconnect = function (...args: unknown[]) {
                    markIntentional(null);
                    return originalDisconnect.apply(this, args);
                };
                unwrappers.push(() => { module.disconnect = originalDisconnect; });
            }
        } catch (err) {
            logger.debug("Could not wrap disconnect", err);
        }
    }
}

function unwrapLeaveActions() {
    while (unwrappers.length) {
        try {
            unwrappers.pop()!();
        } catch (err) {
            logger.error("Failed to restore voice action", err);
        }
    }
}

function joinTarget(useDispatch: boolean) {
    if (!target) return;

    selfRejoining = true;
    try {
        if (!useDispatch) {
            for (const module of getVoiceModules()) {
                try {
                    module.selectVoiceChannel(target.channelId);
                    return;
                } catch (err) {
                    logger.error("selectVoiceChannel failed", err);
                }
            }
        }

        FluxDispatcher.dispatch({
            type: "VOICE_CHANNEL_SELECT",
            guildId: target.guildId,
            channelId: target.channelId
        });
    } finally {
        selfRejoining = false;
    }
}

function isCallEmpty(channelId: string) {
    try {
        const channel = ChannelStore.getChannel(channelId);
        if (!channel || channel.guild_id) return false;

        const myId = UserStore.getCurrentUser()?.id;
        const states = VoiceStateStore.getVoiceStatesForChannel(channelId) as Record<string, VoiceState>;
        return Object.values(states ?? {}).every(state => state.userId === myId);
    } catch (err) {
        logger.debug("Could not read voice states", err);
        return false;
    }
}

function attemptRejoin() {
    rejoinTimer = undefined;
    if (!enabled || !target) return;

    if (SelectedChannelStore.getVoiceChannelId() === target.channelId) {
        attempts = 0;
        return;
    }

    if (!ChannelStore.getChannel(target.channelId)) {
        logger.warn(`Protected channel ${target.channelId} no longer exists, disabling`);
        setEnabled(false);
        return;
    }

    if (settings.store.skipEndedCalls && isCallEmpty(target.channelId)) {
        logger.info("Call is empty, not rejoining");
        setEnabled(false);
        return;
    }

    if (attempts >= settings.store.maxAttempts) {
        logger.warn(`Gave up returning to ${target.channelId} after ${attempts} attempts`);
        attempts = 0;
        if (settings.store.showNotifications) {
            showNotification({
                title: "AntiMove&Deco",
                body: "Could not return to the protected channel.",
                icon: undefined
            });
        }
        return;
    }

    attempts++;
    joinTarget(attempts % 2 === 0);
    rejoinTimer = setTimeout(attemptRejoin, settings.store.retryInterval);
}

function scheduleRejoin(reason: "move" | "disconnect") {
    if (!enabled || !target) return;
    if (rejoinTimer !== undefined) return;

    logger.info(`${reason} detected, returning to ${target.channelId}`);
    if (settings.store.showNotifications) {
        const channel = ChannelStore.getChannel(target.channelId);
        showNotification({
            title: reason === "disconnect" ? "AntiMove&Deco - disconnect blocked" : "AntiMove&Deco - move blocked",
            body: `Returning to ${channel?.name ?? target.channelId}`,
            icon: undefined
        });
    }

    attempts = 0;
    rejoinTimer = setTimeout(attemptRejoin, settings.store.rejoinDelay);
}

function handleSelfVoiceState(channelId: string | null) {
    if (!enabled || !target) return;

    if (channelId === target.channelId) {
        cancelRejoin();
        return;
    }

    const wasIntentional = intentionalChannelId !== undefined && intentionalChannelId === channelId;

    if (channelId === null) {
        if (wasIntentional && settings.store.disableOnManualLeave) {
            logger.info("Manual disconnect, protection disabled");
            setEnabled(false);
            return;
        }
        scheduleRejoin("disconnect");
        return;
    }

    if (wasIntentional && settings.store.followManualMove) {
        const channel = ChannelStore.getChannel(channelId);
        target = { channelId, guildId: channel?.guild_id ?? null };
        cancelRejoin();
        logger.info(`Manual move, now protecting ${channelId}`);
        notifyListeners();
        return;
    }

    scheduleRejoin("move");
}

function AntiMoveDecoIcon({ className, active }: { className?: string; active?: boolean; }) {
    const color = active ? "#39FF14" : "currentColor";
    return (
        <svg className={className} width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <circle cx="12" cy="12" r="10" stroke={color} strokeWidth="2.5" />
            <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" stroke={color} strokeWidth="2.5" />
        </svg>
    );
}

const AntiMoveDecoButton: UserAreaButtonFactory = ({ iconForeground, hideTooltips }: UserAreaRenderProps) => {
    const [, forceUpdate] = React.useReducer((x: number) => x + 1, 0);

    React.useEffect(() => {
        const listener = () => forceUpdate();
        listeners.add(listener);
        return () => { listeners.delete(listener); };
    }, []);

    const toggle = () => {
        if (enabled) {
            setEnabled(false);
            return;
        }

        const channelId = SelectedChannelStore.getVoiceChannelId();
        if (!channelId) {
            if (settings.store.showNotifications) {
                showNotification({
                    title: "AntiMove&Deco",
                    body: "Join a voice channel first.",
                    icon: undefined
                });
            }
            return;
        }

        const channel = ChannelStore.getChannel(channelId);
        target = { channelId, guildId: channel?.guild_id ?? null };
        cancelRejoin();
        setEnabled(true);
    };

    const channelName = target ? ChannelStore.getChannel(target.channelId)?.name : undefined;

    return (
        <UserAreaButton
            onClick={toggle}
            tooltipText={hideTooltips ? undefined : enabled
                ? `Disable AntiMove&Deco${channelName ? ` (${channelName})` : ""}`
                : "Enable AntiMove&Deco"}
            role="switch"
            aria-checked={enabled}
            aria-label="AntiMove and AntiDisconnect protection"
            icon={<AntiMoveDecoIcon className={iconForeground} active={enabled} />}
        />
    );
};

export default definePlugin({
    name: "AntiMoveDeco",
    description: "Adds a button that prevents you from being moved or disconnected from a voice channel.",
    authors: [{ name: "RAINCORD", id: 0n }],
    settings,

    userAreaButton: {
        icon: ({ className }: { className?: string; }) => <AntiMoveDecoIcon className={className} active={enabled} />,
        render: AntiMoveDecoButton
    },

    flux: {
        VOICE_STATE_UPDATES({ voiceStates }: { voiceStates: VoiceState[]; }) {
            if (!enabled || !target) return;

            const myId = UserStore.getCurrentUser()?.id;
            if (!myId) return;

            const myState = voiceStates.find(state => state.userId === myId);
            if (!myState) return;

            handleSelfVoiceState(myState.channelId ?? null);
        },

        VOICE_CHANNEL_SELECT({ channelId }: { channelId: string | null; }) {
            if (!enabled || !target) return;
            handleSelfVoiceState(channelId ?? null);
        }
    },

    start() {
        wrapLeaveActions();
    },

    stop() {
        unwrapLeaveActions();
        if (intentionalTimer !== undefined) clearTimeout(intentionalTimer);
        intentionalTimer = undefined;
        intentionalChannelId = undefined;
        setEnabled(false);
        listeners.clear();
    }
});
