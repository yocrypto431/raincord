/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import definePlugin from "@utils/types";

export default definePlugin({
    name: "ActivityDisplayCapture",
    description: "Lets activities capture your screen, so screen sharing activities work without an outside browser tab.",
    tags: ["Activity", "Media", "ScreenShare"],
    authors: [{ name: "RAINCORD", id: 0n }],

    patches: [
        {
            find: 'allow:"autoplay; encrypted-media"',
            replacement: {
                match: /allow:"autoplay; encrypted-media"/,
                replace: 'allow:"autoplay; encrypted-media; display-capture"'
            }
        }
    ]
});
