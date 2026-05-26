/*
 * Equicord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import definePlugin, { PluginNative } from "@utils/types";

const Native = VencordNative.pluginHelpers.TitlebarLink as PluginNative<typeof import("./native")>;

const TARGET_URL = "https://RAINCORD.online";

const CSS = `
#RAINCORD-titlebar-btn {
    position: fixed;
    top: 0;
    left: 50%;
    transform: translateX(-50%);
    height: 15px;
    width: 40px;
    z-index: 9999;
    cursor: pointer !important;
    display: flex;
    align-items: center;
    justify-content: center;
    -webkit-app-region: no-drag;
    pointer-events: all;
    background: transparent;
    border: none;
    padding: 0;
}


`;

function inject() {
    if (document.getElementById("RAINCORD-titlebar-btn")) return;

    const style = document.createElement("style");
    style.id = "RAINCORD-titlebar-link-style";
    style.textContent = CSS;
    document.head.appendChild(style);

    const btn = document.createElement("div");
    btn.id = "RAINCORD-titlebar-btn";

    btn.addEventListener("click", () => {
        Native.openUrl(TARGET_URL);
    });

    document.body.appendChild(btn);
}

function remove() {
    document.getElementById("RAINCORD-titlebar-btn")?.remove();
    document.getElementById("RAINCORD-titlebar-link-style")?.remove();
}

export default definePlugin({
    name: "TitlebarLink",
    enabledByDefault: true,
    description: "Click on the central Discord title to open RAINCORD.online",
    authors: [{ name: "RAINCORD", id: 0n }],
    patches: [],

    start() {
        if (document.body) {
            inject();
        } else {
            document.addEventListener("DOMContentLoaded", inject, { once: true });
        }
    },

    stop() {
        remove();
    },
} as any);
