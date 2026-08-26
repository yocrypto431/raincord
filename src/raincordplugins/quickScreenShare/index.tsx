import { definePluginSettings } from "@api/Settings";
import { UserAreaButton, UserAreaButtonFactory, UserAreaRenderProps } from "@api/UserArea";
import { getUserSettingLazy } from "@api/UserSettings";
import { Heading } from "@components/Heading";
import { Paragraph } from "@components/Paragraph";
import { Logger } from "@utils/Logger";
import definePlugin, { OptionType } from "@utils/types";
import { findByCodeLazy, findByPropsLazy, findStoreLazy } from "@webpack";
import { ChannelStore, ContextMenuApi, MediaEngineStore, Menu, PermissionsBits, PermissionStore, React, SearchableSelect, SelectedChannelStore, showToast, Toasts, useStateFromStores } from "@webpack/common";

const logger = new Logger("QuickScreenShare");

const startStream = findByCodeLazy('type:"STREAM_START"');
const stopStream = findByCodeLazy('type:"STREAM_STOP"');
const getDesktopSources = findByCodeLazy("desktop sources");
const configModule = findByPropsLazy("getOutputVolume");
const ApplicationStreamingStore = findStoreLazy("ApplicationStreamingStore");
const ApplicationStreamingSettingsStore = findStoreLazy("ApplicationStreamingSettingsStore");
const StreamPreviewSettings = getUserSettingLazy("voiceAndVideo", "disableStreamPreviews")!;

interface MediaSource {
    id: string;
    name: string;
    type?: string;
}

const FALLBACK_SOURCE: MediaSource = { id: "screen:0:0", name: "Screen 1" };

const MONITOR_FALLBACKS: MediaSource[] = [
    { id: "screen:0:0", name: "Monitor 1" },
    { id: "screen:1:0", name: "Monitor 2" },
    { id: "screen:2:0", name: "Monitor 3" },
    { id: "screen:3:0", name: "Monitor 4" }
];

let cachedSources: MediaSource[] = [];

async function tryGetSources(kinds: string[]): Promise<MediaSource[] | null> {
    const engine = MediaEngineStore.getMediaEngine() as any;
    const attempts: Array<() => any> = [
        () => getDesktopSources(engine, kinds, null),
        () => getDesktopSources(kinds, null),
        () => getDesktopSources(kinds),
        () => engine?.getDesktopSources?.(kinds, null),
        () => engine?.getDesktopSources?.(kinds),
        () => engine?.getDesktopSource?.(kinds, null),
        () => engine?.getDesktopSource?.(kinds)
    ];

    for (const attempt of attempts) {
        try {
            const result = await attempt();
            if (Array.isArray(result)) return result;
        } catch (err) {
            logger.debug("Source enumeration attempt failed", err);
        }
    }

    return null;
}

async function listSources(includeWindows: boolean, includeCameras: boolean): Promise<MediaSource[]> {
    const kinds = includeWindows ? ["screen", "window"] : ["screen"];
    const sources = await tryGetSources(kinds) ?? [];

    if (includeCameras) {
        try {
            const devices = Object.values(configModule.getVideoDevices() || {}) as any[];
            sources.push(...devices.map(device => ({
                id: device.id,
                name: device.name,
                type: "video_device"
            })));
        } catch (err) {
            logger.warn("Failed to list video devices", err);
        }
    }

    return sources;
}

function SourcePicker() {
    const { sourceId, includeWindows, includeCameras } = settings.use(["sourceId", "includeWindows", "includeCameras"]);
    const [sources, setSources] = React.useState<MediaSource[]>([]);
    const [loading, setLoading] = React.useState(true);

    React.useEffect(() => {
        let active = true;
        setLoading(true);
        listSources(includeWindows, includeCameras)
            .then(found => {
                if (!active) return;
                setSources(found);
                setLoading(false);
            })
            .catch(err => {
                logger.error("Failed to list sources", err);
                if (active) setLoading(false);
            });
        return () => { active = false; };
    }, [includeWindows, includeCameras]);

    if (loading) return <Paragraph>Loading sources...</Paragraph>;
    if (!sources.length) return <Paragraph>No source found.</Paragraph>;

    const options = [
        { label: "Automatic (first screen)", value: "" },
        ...sources.map(source => ({ label: source.name, value: source.id }))
    ];

    return (
        <SearchableSelect
            placeholder="Select what to stream"
            maxVisibleItems={6}
            closeOnSelect
            options={options}
            value={options.find(option => option.value === (sourceId ?? ""))?.value}
            onChange={(value: string) => settings.store.sourceId = value}
        />
    );
}

function SourceSetting() {
    return (
        <section>
            <Heading>Source</Heading>
            <Paragraph>Falls back to the first screen when the saved source is gone.</Paragraph>
            <SourcePicker />
        </section>
    );
}

const settings = definePluginSettings({
    sourceId: {
        type: OptionType.COMPONENT,
        description: "Source to stream",
        default: "",
        component: SourceSetting
    },
    includeWindows: {
        type: OptionType.BOOLEAN,
        description: "List individual windows besides full screens",
        default: true
    },
    includeCameras: {
        type: OptionType.BOOLEAN,
        description: "List video input devices (cameras, capture cards)",
        default: false
    },
    shareSound: {
        type: OptionType.BOOLEAN,
        description: "Share audio when supported (falls back to your Discord setting when off)",
        default: true
    },
    showNotifications: {
        type: OptionType.BOOLEAN,
        description: "Show a toast when the stream starts or fails",
        default: true
    }
});

function toast(message: string, type: string) {
    if (!settings.store.showNotifications) return;
    showToast(message, type);
}

function buildStreamKey(stream: any): string | null {
    if (!stream) return null;
    const { streamType, guildId, channelId, ownerId } = stream;
    if (!channelId || !ownerId) return null;
    return streamType === "guild"
        ? `guild:${guildId}:${channelId}:${ownerId}`
        : `call:${channelId}:${ownerId}`;
}

async function resolveSource(): Promise<MediaSource> {
    let sources: MediaSource[] = [];
    try {
        sources = await listSources(settings.store.includeWindows, settings.store.includeCameras);
    } catch (err) {
        logger.warn("Falling back to the default screen", err);
    }

    const saved = settings.store.sourceId;

    if (sources.length) {
        if (saved) return sources.find(source => source.id === saved) ?? sources[0];
        return sources.find(source => source.id.startsWith("screen:")) ?? sources[0];
    }

    return saved ? { id: saved, name: saved } : FALLBACK_SOURCE;
}

async function refreshSourceCache() {
    try {
        const found = await listSources(false, false);
        if (found.length) cachedSources = found;
    } catch (err) {
        logger.debug("Source cache refresh failed", err);
    }
}

function stopCurrentStream() {
    const activeStream = ApplicationStreamingStore.getCurrentUserActiveStream();
    if (!activeStream) return false;

    const key = buildStreamKey(activeStream);
    if (!key) {
        toast("Could not identify the active stream.", Toasts.Type.FAILURE);
        return true;
    }
    stopStream(key);
    return true;
}

function startWithSource(source: MediaSource) {
    const channelId = SelectedChannelStore.getVoiceChannelId();
    if (!channelId) {
        toast("Join a voice channel first.", Toasts.Type.MESSAGE);
        return;
    }

    const channel = ChannelStore.getChannel(channelId);
    if (!channel) {
        toast("Voice channel not found.", Toasts.Type.FAILURE);
        return;
    }

    if (channel.type === 13) {
        toast("You cannot stream in a stage channel.", Toasts.Type.FAILURE);
        return;
    }

    const isGuildChannel = !channel.isDM?.() && !channel.isGroupDM?.();
    if (isGuildChannel && !PermissionStore.can(PermissionsBits.STREAM, channel)) {
        toast("You do not have permission to stream here.", Toasts.Type.FAILURE);
        return;
    }

    const sourceId = source.type === "video_device" ? `camera:${source.id}` : source.id;
    const previewDisabled = StreamPreviewSettings.getSetting();
    const { soundshareEnabled } = ApplicationStreamingSettingsStore.getState();

    logger.info(`starting stream sourceId=${sourceId} channel=${channelId}`);

    try {
        startStream(channel.guild_id ?? null, channelId, {
            pid: null,
            sourceId,
            sourceName: source.name,
            audioSourceId: source.name,
            sound: settings.store.shareSound ? true : soundshareEnabled,
            previewDisabled
        });
        toast(`Streaming ${source.name}`, Toasts.Type.SUCCESS);
    } catch (err) {
        logger.error("Failed to start stream", err);
        toast("Failed to start the stream.", Toasts.Type.FAILURE);
    }
}

async function toggleStream() {
    if (stopCurrentStream()) return;
    startWithSource(await resolveSource());
}

function shareSource(source: MediaSource) {
    settings.store.sourceId = source.id;
    stopCurrentStream();
    startWithSource(source);
}

function SourceMenu() {
    const monitors = cachedSources.filter(source => source.id.startsWith("screen:"));
    const monitorItems = monitors.length ? monitors : MONITOR_FALLBACKS;

    return (
        <Menu.Menu
            navId="quick-screen-share"
            onClose={ContextMenuApi.closeContextMenu}
            aria-label="Screen share monitors"
        >
            <Menu.MenuGroup label="Monitores">
                {monitorItems.map((source, index) => (
                    <Menu.MenuItem
                        key={source.id}
                        id={`qss-screen-${source.id}`}
                        label={source.name || `Monitor ${index + 1}`}
                        action={() => shareSource({ ...source, name: source.name || `Monitor ${index + 1}` })}
                    />
                ))}
            </Menu.MenuGroup>

            <Menu.MenuSeparator />
            <Menu.MenuItem
                id="qss-refresh"
                label="Recarregar monitores"
                action={() => { void refreshSourceCache(); }}
            />
        </Menu.Menu>
    );
}

function ScreenShareIcon({ className, active }: { className?: string; active?: boolean; }) {
    const color = active ? "#39FF14" : "currentColor";
    return (
        <svg className={className} width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <rect x="2.5" y="4" width="19" height="13" rx="2" stroke={color} strokeWidth="2" />
            <path d="M8 20.5h8" stroke={color} strokeWidth="2" strokeLinecap="round" />
            <path d="M12 8v5m0-5-2.2 2.2M12 8l2.2 2.2" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    );
}

const ScreenShareButton: UserAreaButtonFactory = ({ iconForeground, hideTooltips }: UserAreaRenderProps) => {
    const isStreaming = useStateFromStores(
        [ApplicationStreamingStore],
        () => Boolean(ApplicationStreamingStore.getCurrentUserActiveStream())
    );

    React.useEffect(() => {
        void refreshSourceCache();
    }, []);

    return (
        <UserAreaButton
            onClick={() => { void toggleStream(); }}
            onContextMenu={event => {
                void refreshSourceCache();
                ContextMenuApi.openContextMenu(event, () => <SourceMenu />);
            }}
            tooltipText={hideTooltips ? undefined : isStreaming ? "Stop streaming" : "Share your screen (right click to pick a monitor)"}
            role="switch"
            aria-checked={isStreaming}
            aria-label="Share your screen"
            redGlow={isStreaming}
            icon={<ScreenShareIcon className={iconForeground} active={isStreaming} />}
        />
    );
};

export default definePlugin({
    name: "QuickScreenShare",
    description: "Adds a button next to the mute controls that starts or stops sharing your screen in one click.",
    tags: ["Media", "Voice"],
    authors: [{ name: "RAINCORD", id: 0n }],
    settings,

    userAreaButton: {
        icon: ({ className }: { className?: string; }) => <ScreenShareIcon className={className} />,
        render: ScreenShareButton,
        priority: 3
    },

    toggleStream
});
