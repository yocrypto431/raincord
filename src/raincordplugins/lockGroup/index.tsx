/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { findGroupChildrenByChildId, NavContextMenuPatchCallback } from "@api/ContextMenu";
import { definePluginSettings } from "@api/Settings";
import { showNotification } from "@api/Notifications";
import definePlugin, { OptionType } from "@utils/types";
import { ChannelStore, Menu, RestAPI, UserStore } from "@webpack/common";
import { Channel } from "discord-types/general";

const lockedGroups = new Set<string>();

const settings = definePluginSettings({
    showNotifications: {
        type: OptionType.BOOLEAN,
        description: "Exibir notificações durante as ações",
        default: true
    },
    debugMode: {
        type: OptionType.BOOLEAN,
        description: "Debug mode (detailed logs)",
        default: false
    }
});

function log(message: string, level: "info" | "warn" | "error" = "info") {
    const timestamp = new Date().toLocaleTimeString();
    const prefix = `[LockGroup ${timestamp}]`;
    switch (level) {
        case "warn": console.warn(prefix, message); break;
        case "error": console.error(prefix, message); break;
        default: console.log(prefix, message);
    }
}

function debugLog(message: string) {
    if (settings.store.debugMode) log(`\uD83D\uDD0D DEBUG: ${message}`);
}

function interceptAddMember(originalMethod: any) {
    return function (this: any, ...args: any[]) {
        const [requestData] = args;
        if (requestData?.url?.match(/^\/channels\/\d+\/recipients\/\d+$/)) {
            const urlParts = requestData.url.split("/");
            const channelId = urlParts[2];
            const targetUserId = urlParts[4];

            if (lockedGroups.has(channelId)) {
                const channel = ChannelStore.getChannel(channelId);
                const currentUserId = UserStore.getCurrentUser()?.id;

                if (channel && channel.type === 3 && channel.ownerId === currentUserId) {
                    debugLog(`\u2705 Proprietário autorizado a adicionar membros`);
                    return originalMethod.apply(this, args);
                }

                if (channel && channel.type === 3) {
                    const channelName = channel.name || "Grupo sem nome";
                    log(`\uD83D\uDEAB Adição não autorizada detectada em "${channelName}" - Auto-kick programado`);

                    setTimeout(async () => {
                        try {
                            await RestAPI.del({ url: `/channels/${channelId}/recipients/${targetUserId}` });
                            log(`\u2705 Usuário ${targetUserId} automaticamente kickado do grupo bloqueado`);
                            if (settings.store.showNotifications) {
                                showNotification({
                                    title: "\uD83D\uDD12 LockGroup - Auto-kick",
                                    body: `Membro não autorizado removido do grupo bloqueado "${channelName}"`,
                                    icon: undefined
                                });
                            }
                        } catch (error) {
                            log(`\u274C Erro no kick automático: ${error}`, "error");
                        }
                    }, 100);

                    if (settings.store.showNotifications) {
                        showNotification({
                            title: "\uD83D\uDD12 LockGroup - Adição não autorizada",
                            body: `Adição não autorizada detectada em "${channelName}" - Auto-kick em andamento...`,
                            icon: undefined
                        });
                    }
                }
            }
        }
        return originalMethod.apply(this, args);
    };
}

function toggleGroupLock(channelId: string) {
    const channel = ChannelStore.getChannel(channelId);
    const currentUserId = UserStore.getCurrentUser()?.id;

    if (!channel || channel.type !== 3 || !currentUserId) return;

    const channelName = channel.name || "Grupo sem nome";

    if (channel.ownerId !== currentUserId) {
        if (settings.store.showNotifications) {
            showNotification({
                title: "\u274C LockGroup",
                body: "Apenas o proprietário do grupo pode bloquear/desbloquear o grupo",
                icon: undefined
            });
        }
        return;
    }

    const isCurrentlyLocked = lockedGroups.has(channelId);

    if (isCurrentlyLocked) {
        lockedGroups.delete(channelId);
        log(`\uD83D\uDD13 Grupo "${channelName}" desbloqueado`);
        if (settings.store.showNotifications) {
            showNotification({
                title: "\uD83D\uDD13 LockGroup",
                body: `Grupo "${channelName}" desbloqueado - Adição de membros autorizada`,
                icon: undefined
            });
        }
    } else {
        lockedGroups.add(channelId);
        log(`\uD83D\uDD12 Grupo "${channelName}" bloqueado`);
        if (settings.store.showNotifications) {
            showNotification({
                title: "\uD83D\uDD12 LockGroup",
                body: `Grupo "${channelName}" bloqueado - Adição de membros bloqueada`,
                icon: undefined
            });
        }
    }
}

const GroupContextMenuPatch: NavContextMenuPatchCallback = (children, { channel }: { channel: Channel; }) => {
    if (!channel || channel.type !== 3) return;

    const currentUserId = UserStore.getCurrentUser()?.id;
    if (channel.ownerId !== currentUserId) return;

    const isLocked = lockedGroups.has(channel.id);
    const group = findGroupChildrenByChildId("leave-channel", children);

    if (group) {
        const menuItems: any[] = [<Menu.MenuSeparator key="separator" />];

        if (!isLocked) {
            menuItems.push(
                <Menu.MenuItem
                    key="lock-group"
                    id="vc-lock-group"
                    label="Bloquear o grupo"
                    color="danger"
                    action={() => toggleGroupLock(channel.id)}
                    icon={() => (
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6h2c0-1.66 1.34-3 3-3s3 1.34 3 3v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2z" />
                        </svg>
                    )}
                />
            );
        }

        if (isLocked) {
            menuItems.push(
                <Menu.MenuItem
                    key="unlock-group"
                    id="vc-unlock-group"
                    label="Desbloquear o grupo"
                    color="brand"
                    action={() => toggleGroupLock(channel.id)}
                    icon={() => (
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zM9 6c0-1.66 1.34-3 3-3s3 1.34 3 3v2H9V6z" />
                        </svg>
                    )}
                />
            );
        }

        group.push(...menuItems);
    }
};

let originalPutMethod: any = null;

export default definePlugin({
    name: "LockGroup",
    description: "Lock/unlock groups via the context menu (prevents adding members)",
    authors: [{ name: "Bash", id: 1327483363518582784n }],
    dependencies: ["ContextMenuAPI"],
    settings,

    contextMenus: { "gdm-context": GroupContextMenuPatch },

    flux: {
        MESSAGE_CREATE(event: { message: any; }) {
            const { message } = event;
            const currentUserId = UserStore.getCurrentUser()?.id;

            if (message && message.type === 1) {
                const channelId = message.channel_id;
                if (lockedGroups.has(channelId)) {
                    const channel = ChannelStore.getChannel(channelId);
                    if (channel && channel.type === 3 && channel.ownerId === currentUserId) {
                        const channelName = channel.name || "Grupo sem nome";
                        const addedUserId = message.mentions?.[0]?.id;
                        const addedByUserId = message.author?.id;

                        if (addedByUserId === currentUserId) {
                            debugLog(`\u2705 Adição feita pelo proprietário - Autorizada`);
                            return;
                        }

                        if (addedUserId && addedByUserId !== currentUserId) {
                            setTimeout(async () => {
                                try {
                                    await RestAPI.del({ url: `/channels/${channelId}/recipients/${addedUserId}` });
                                    log(`\uD83D\uDD12 Kick de segurança efetuado para ${addedUserId}`);
                                } catch (error) {
                                    debugLog(`Erro kick de segurança: ${error}`);
                                }
                            }, 150);

                            if (settings.store.showNotifications) {
                                showNotification({
                                    title: "\uD83D\uDD12 LockGroup - Adição não autorizada",
                                    body: `Membro adicionado sem autorização em "${channelName}" e removido`,
                                    icon: undefined
                                });
                            }
                        }
                    }
                }
            }
        }
    },

    start() {
        log("\uD83D\uDE80 Plugin LockGroup iniciado");
        if (RestAPI && RestAPI.put) {
            originalPutMethod = RestAPI.put;
            RestAPI.put = interceptAddMember(originalPutMethod);
        }
    },

    stop() {
        log("\uD83D\uDED1 Plugin LockGroup parado");
        if (originalPutMethod && RestAPI) {
            RestAPI.put = originalPutMethod;
            originalPutMethod = null;
        }
        lockedGroups.clear();
    }
});
