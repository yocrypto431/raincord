import { addServerListElement, removeServerListElement, ServerListRenderPosition } from "@api/ServerList";
import definePlugin from "@utils/types";
import { findByPropsLazy, findStoreLazy } from "@webpack";
import { React, Toasts } from "@webpack/common";

const GuildStore = findByPropsLazy("getGuilds", "getGuild");
const GuildChannelStore = findByPropsLazy("getChannels", "getDefaultChannel");
const ReadStateStore = findStoreLazy("ReadStateStore");
const ActiveJoinedThreadsStore = findStoreLazy("ActiveJoinedThreadsStore");
const BulkAck = findByPropsLazy("bulkAck");

function markAllAsRead() {
    const channels: Array<{ channelId: string; messageId: string; readStateType: number; }> = [];

    Object.values(GuildStore.getGuilds()).forEach((guild: any) => {
        const guildChannels = GuildChannelStore.getChannels(guild.id);
        if (!guildChannels) return;

        const allChannels = [
            ...(guildChannels.SELECTABLE || []),
            ...(guildChannels.VOCAL || []),
            ...Object.values(ActiveJoinedThreadsStore?.getActiveJoinedThreadsForGuild?.(guild.id) ?? {})
                .flatMap((threadChannels: any) => Object.values(threadChannels))
        ];

        allChannels.forEach((c: any) => {
            const channelId = c.channel?.id || c.id;
            if (!channelId || !ReadStateStore.hasUnread(channelId)) return;
            channels.push({
                channelId,
                messageId: ReadStateStore.lastMessageId(channelId),
                readStateType: 0
            });
        });
    });

    if (channels.length === 0) {
        Toasts.show({ message: "Tudo já está lido!", type: Toasts.Type.MESSAGE, id: Toasts.genId() });
        return;
    }

    BulkAck.bulkAck(channels);
    Toasts.show({ message: `✓ ${channels.length} canais marcados como lidos`, type: Toasts.Type.SUCCESS, id: Toasts.genId() });
}

function ReadAllButton() {
    const [hover, setHover] = React.useState(false);

    return (
        <div
            onClick={markAllAsRead}
            onMouseEnter={() => setHover(true)}
            onMouseLeave={() => setHover(false)}
            style={{
                width: 48,
                height: 48,
                borderRadius: hover ? 16 : 24,
                background: hover ? "#23a55a" : "var(--background-primary)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
                transition: "all 0.15s ease-out",
                marginBottom: 8,
            }}
            aria-label="Read All"
            role="button"
        >
            <svg width="24" height="24" viewBox="0 0 24 24" fill={hover ? "white" : "var(--interactive-normal)"}>
                <path d="M0.41 13.41L6 19l1.41-1.42L1.83 12 7.41 6.41 6 5 0.41 10.59zM22.24 5.59L11.66 16.17 7.48 12l-1.41 1.41L11.66 19l12-12-1.42-1.41z" />
            </svg>
        </div>
    );
}

export default definePlugin({
    name: "ReadAllButton",
    description: "Adds a button above the server list to mark all servers as read.",
    authors: [{ name: "RAINCORD", id: 0n }],

    renderGuildButton: () => <ReadAllButton />,

    start() {
        addServerListElement(ServerListRenderPosition.Above, this.renderGuildButton);
    },

    stop() {
        removeServerListElement(ServerListRenderPosition.Above, this.renderGuildButton);
    },
});
