import definePlugin from "@utils/types";
import { FluxDispatcher, React, UserStore } from "@webpack/common";
import { UserAreaButton } from "@api/UserArea";
import { findByProps, findByPropsLazy } from "@webpack";

// Módulos Webpack
const ChannelActions = findByPropsLazy("selectVoiceChannel", "disconnect");
const SelectedChannelStore = findByPropsLazy("getVoiceChannelId", "getChannelId");

let enabled = false;
let targetChannelId: string | null = null;

function onVoiceStateUpdate({ voiceStates }: { voiceStates: any[]; }) {
    if (!enabled || !targetChannelId) return;

    const currentUser = UserStore.getCurrentUser();
    if (!currentUser) return;
    const myId = currentUser.id;

    // Verificar se meu estado mudou neste update
    const myState = voiceStates.find(s => s.userId === myId);

    // Se temos um update me envolvendo
    if (myState) {
        // Se o novo channelId é diferente do que estamos protegendo (ou null se desconectado)
        if (myState.channelId !== targetChannelId) {
            console.log(`[AntiMoveDeco] Movement or disconnect detected! Returning to channel ${targetChannelId}...`);

            // Pequeno atraso para deixar o Discord finalizar a desconexão antes de reconectar
            setTimeout(() => {
                if (enabled && targetChannelId) {
                    try {
                        ChannelActions?.selectVoiceChannel?.(targetChannelId);
                    } catch (e) {
                        console.error("[AntiMoveDeco] Error while reconnecting:", e);
                    }
                }
            }, 500);
        }
    }
}

function AntiMoveDecoIcon({ enabled }: { enabled: boolean; }) {
    const color = enabled ? "#39FF14" : "currentColor"; // Verde neon se ativado
    return (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="12" cy="12" r="10" stroke={color} strokeWidth="2.5" />
            <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" stroke={color} strokeWidth="2.5" />
        </svg>
    );
}

function AntiMoveDecoButton() {
    const [, forceUpdate] = React.useReducer(x => x + 1, 0);

    const toggle = () => {
        if (!enabled) {
            const channelId = SelectedChannelStore?.getVoiceChannelId?.();
            if (!channelId) {
                // Não está em canal de voz, não é possível ativar
                return;
            }
            targetChannelId = channelId;
            enabled = true;
            console.log(`[AntiMoveDeco] Enabled. Protected channel: ${targetChannelId}`);
        } else {
            enabled = false;
            targetChannelId = null;
            console.log("[AntiMoveDeco] Disabled.");
        }
        forceUpdate();
    };

    return (
        <UserAreaButton
            onClick={toggle}
            tooltipText={enabled ? "Disable AntiMove&Deco" : "Enable AntiMove&Deco"}
            icon={<AntiMoveDecoIcon enabled={enabled} />}
        />
    );
}

export default definePlugin({
    name: "AntiMoveDeco",
    description: "Adds a button to prevent being moved or disconnected from a voice channel.",
    authors: [{ name: "RAINCORD", id: 0n }],

    userAreaButton: {
        icon: () => <AntiMoveDecoIcon enabled={enabled} />,
        render: AntiMoveDecoButton
    },

    start() {
        FluxDispatcher.subscribe("VOICE_STATE_UPDATES", onVoiceStateUpdate);
    },
    stop() {
        FluxDispatcher.unsubscribe("VOICE_STATE_UPDATES", onVoiceStateUpdate);
        enabled = false;
        targetChannelId = null;
    }
});
