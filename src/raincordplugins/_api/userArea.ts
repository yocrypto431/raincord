/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Devs } from "@utils/constants";
import definePlugin from "@utils/types";
import { findCssClassesLazy } from "@webpack";

const cssClasses = findCssClassesLazy("iconForeground", "accountPopoutButtonWrapper");

export default definePlugin({
    name: "UserAreaAPI",
    description: "API to add buttons to the user area panel.",
    authors: [Devs.prism],

    patches: [
        {
            // Discord's account panel button row (buttons__37e49 — mute/deafen/
            // settings buttons). This is a separate function component ("rv"
            // internally) from the account nameplate/name-zone container, and
            // injecting into the wrong one (the nameplate container) stretches
            // it to fit our extra buttons and breaks the account panel layout.
            // Anchored on the accountContainerRef prop, which is unique to this
            // component's destructured parameters and precedes its children
            // array regardless of how Discord renames/reorders the other props.
            find: "accountContainerRef:",
            replacement: [
                {
                    match: /(?<=accountContainerRef:\i,[\s\S]{0,450}?)children:\[/,
                    replace: "children:[...$self.renderButtons(arguments[0]),"
                }
            ]
        }
    ],

    renderButtons(props: { nameplate?: any; }) {
        return Vencord.Api?.UserArea?._renderButtons?.({
            nameplate: props.nameplate,
            iconForeground: props.nameplate != null ? cssClasses?.iconForeground : void 0,
            hideTooltips: false
        });
    }
});

