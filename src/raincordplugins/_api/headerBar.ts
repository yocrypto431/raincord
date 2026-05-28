/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Os patches HeaderBarAPI estão em src/plugins/_api/headerBar.ts
// Este arquivo existe apenas para satisfazer o sistema de build de equicordplugins/_api

import { Devs } from "@utils/constants";
import definePlugin from "@utils/types";

export default definePlugin({
    name: "HeaderBarAPIEquicord",
    description: "Equicord extension stub for HeaderBarAPI",
    authors: [Devs.prism],
    hidden: true,
    patches: []
});
