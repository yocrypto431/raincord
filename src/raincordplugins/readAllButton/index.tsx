import "./style.css";

import { addServerListElement, removeServerListElement, ServerListRenderPosition } from "@api/ServerList";
import ErrorBoundary from "@components/ErrorBoundary";
import definePlugin from "@utils/types";
import { FluxDispatcher, GuildChannelStore, GuildStore, React, ReadStateStore } from "@webpack/common";
import { findStoreLazy } from "@webpack";

const ActiveJoinedThreadsStore = findStoreLazy("ActiveJoinedThreadsStore");

function onClick() {
    const channels: Array<{ channelId: string; messageId: string; readStateType: number; }> = [];

    Object.values(GuildStore.getGuilds()).forEach(guild => {
        GuildChannelStore.getChannels(guild.id).SELECTABLE
            .concat(GuildChannelStore.getChannels(guild.id).VOCAL)
            .concat(
                Object.values(ActiveJoinedThreadsStore?.getActiveJoinedThreadsForGuild?.(guild.id) ?? {})
                    .flatMap((threadChannels: any) => Object.values(threadChannels))
            )
            .forEach((c: { channel: { id: string; }; }) => {
                if (!ReadStateStore.hasUnread(c.channel.id)) return;
                channels.push({
                    channelId: c.channel.id,
                    messageId: ReadStateStore.lastMessageId(c.channel.id),
                    readStateType: 0
                });
            });
    });

    FluxDispatcher.dispatch({
        type: "BULK_ACK",
        context: "APP",
        channels
    });
}

const ReadAllButton = () => (
    <button className="vc-ranb-button" onClick={onClick}>
        Read All
    </button>
);

export default definePlugin({
    name: "ReadAllButton",
    description: "Adds a button above the server list to mark all servers as read.",
    authors: [{ name: "RAINCORD", id: 0n }],
    enabledByDefault: true,
    dependencies: ["ServerListAPI"],

    renderReadAllButton: ErrorBoundary.wrap(ReadAllButton, { noop: true }),

    start() {
        addServerListElement(ServerListRenderPosition.Above, this.renderReadAllButton);
    },

    stop() {
        removeServerListElement(ServerListRenderPosition.Above, this.renderReadAllButton);
    },
});
