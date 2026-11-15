import definePlugin from "@utils/types";
import { ApplicationCommandInputType, sendBotMessage } from "@api/Commands";
import { UserAreaButton, UserAreaRenderProps } from "@api/UserArea";
import { ContextMenuApi, Menu, React, SelectedChannelStore, VoiceActions } from "@webpack/common";

let isGhostActive = false;
let configFakeMute = true;
let configFakeDeafen = true;

const FAKE_VOICE_CHANGE_EVENT = "RAINCORD-fake-voice-change";

function notifyFakeVoiceChange() {
    try { window.dispatchEvent(new CustomEvent(FAKE_VOICE_CHANGE_EVENT)); } catch { }
}

const syncState = () => {
    if (VoiceActions?.toggleSelfMute && SelectedChannelStore?.getVoiceChannelId?.()) {
        VoiceActions.toggleSelfMute();
        VoiceActions.toggleSelfMute();
    }
};

function refreshGhost() {
    isGhostActive = configFakeMute || configFakeDeafen;
}

function applyChange() {
    refreshGhost();
    syncState();
    notifyFakeVoiceChange();
}

function FakeDeafenIcon({ className }: { className?: string }) {
    return (
        <svg className={className} width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M12 2C7.58 2 4 5.58 4 10V19C4 20.66 5.34 22 7 22C8.66 22 10 20.66 10 19C10 20.66 11.34 22 13 22C14.66 22 16 20.66 16 19C16 20.66 17.34 22 19 22C20.66 22 22 20.66 22 19V10C22 5.58 18.42 2 14 2H10H12Z" fill="currentColor" />
            <circle cx="8.5" cy="10" r="1.5" fill={isGhostActive ? "#121212" : "black"} fillOpacity="0.6" />
            <circle cx="15.5" cy="10" r="1.5" fill={isGhostActive ? "#121212" : "black"} fillOpacity="0.6" />
            {isGhostActive && (
                <path d="M2 2L22 22" stroke="#ed4245" strokeWidth="2.5" strokeLinecap="round" />
            )}
        </svg>
    );
}

function GhostContextMenu() {
    const [, forceUpdate] = React.useReducer((x: number) => x + 1, 0);
    return (
        <Menu.Menu navId="fake-voice-menu" aria-label="Configuration Fake Voice">
            <Menu.MenuGroup label="Options du Fantôme">
                <Menu.MenuCheckboxItem
                    id="opt-both"
                    label="Fake Mute & Deafen"
                    checked={configFakeMute && configFakeDeafen}
                    action={() => {
                        const nextState = !(configFakeMute && configFakeDeafen);
                        configFakeMute = nextState;
                        configFakeDeafen = nextState;
                        applyChange();
                        forceUpdate();
                    }}
                />
                <Menu.MenuSeparator />
                <Menu.MenuCheckboxItem
                    id="opt-mute"
                    label="Fake Mute"
                    checked={configFakeMute}
                    action={() => {
                        configFakeMute = !configFakeMute;
                        applyChange();
                        forceUpdate();
                    }}
                />
                <Menu.MenuCheckboxItem
                    id="opt-deafen"
                    label="Fake Deafen"
                    checked={configFakeDeafen}
                    action={() => {
                        configFakeDeafen = !configFakeDeafen;
                        applyChange();
                        forceUpdate();
                    }}
                />
            </Menu.MenuGroup>
        </Menu.Menu>
    );
}

function FakeDeafenUserButton({ iconForeground, hideTooltips, nameplate }: UserAreaRenderProps & { hideTooltips?: boolean }) {
    const [, forceUpdate] = React.useReducer((x: number) => x + 1, 0);

    React.useEffect(() => {
        const listener = () => forceUpdate();
        window.addEventListener(FAKE_VOICE_CHANGE_EVENT, listener);
        return () => window.removeEventListener(FAKE_VOICE_CHANGE_EVENT, listener);
    }, []);

    return (
        <UserAreaButton
            onClick={() => {
                isGhostActive = !isGhostActive;
                if (isGhostActive && !configFakeMute && !configFakeDeafen) {
                    configFakeMute = true;
                    configFakeDeafen = true;
                }
                syncState();
                forceUpdate();
                notifyFakeVoiceChange();
            }}
            onContextMenu={(e: React.MouseEvent) => ContextMenuApi.openContextMenu(e, () => <GhostContextMenu />)}
            tooltipText={hideTooltips ? undefined : isGhostActive ? "Desativar Fake Voice" : "Ativar Fake Voice (Direito: Config)"}
            icon={<FakeDeafenIcon className={iconForeground} />}
            role="switch"
            aria-checked={isGhostActive}
            redGlow={false}
            plated={nameplate != null}
        />
    );
}

export default definePlugin({
    name: "FakeVoice",
    description: "Appear muted or deaf while listening. By mushzi.",
    authors: [{ name: "mushzi", id: 449282863582412850n }],
    dependencies: ["CommandsAPI", "UserAreaAPI"],

    patches: [
        {
            find: "}voiceStateUpdate(",
            replacement: {
                match: /self_mute:([^,]+),self_deaf:([^,]+),self_video:([^,]+)/,
                replace: "self_mute:$self.toggle($1,'mute'),self_deaf:$self.toggle($2,'deaf'),self_video:$self.toggle($3,'video')"
            }
        }
    ],

    toggle(val: any, what: string) {
        if (!isGhostActive) return val;
        switch (what) {
            case "mute": return configFakeMute ? true : val;
            case "deaf": return configFakeDeafen ? true : val;
            case "video": return val;
        }
    },

    userAreaButton: {
        icon: FakeDeafenIcon,
        render: FakeDeafenUserButton
    },

    commands: [
        {
            inputType: ApplicationCommandInputType.BUILT_IN,
            name: "fakemute",
            description: "Toggle Fake Mute",
            execute: async (_, ctx) => {
                configFakeMute = !configFakeMute;
                applyChange();
                sendBotMessage(ctx.channel.id, { content: `👻 **Fake Mute** est ${configFakeMute ? "activé" : "désactivé"}.` });
            },
        },
        {
            inputType: ApplicationCommandInputType.BUILT_IN,
            name: "fakedeafen",
            description: "Toggle Fake Deafen",
            execute: async (_, ctx) => {
                configFakeDeafen = !configFakeDeafen;
                applyChange();
                sendBotMessage(ctx.channel.id, { content: `👻 **Fake Deafen** est ${configFakeDeafen ? "activé" : "désactivé"}.` });
            },
        },
        {
            inputType: ApplicationCommandInputType.BUILT_IN,
            name: "fakedeafen_mute",
            description: "Toggle Fake Deafen & Mute simultanément",
            execute: async (_, ctx) => {
                const next = !(configFakeMute && configFakeDeafen);
                configFakeMute = next;
                configFakeDeafen = next;
                applyChange();
                sendBotMessage(ctx.channel.id, { content: `👻 **Fake Deafen & Mute** sont ${next ? "activés" : "désactivés"}.` });
            },
        },
    ],

    start() {},

    stop() {}
});
