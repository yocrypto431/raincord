/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { IconsDef } from "@raincordplugins/iconViewer/types";
import { Devs } from "@utils/constants";
import definePlugin from "@utils/types";
import { setColorPicker, setCreateScroller } from "@webpack/common";

export let iconsModule: IconsDef;

export default definePlugin({
    name: "ConcatenatedModules",
    description: "Extract modules that have been concatenated by the bundler",
    authors: [Devs.Ven],

    required: true,

    patches: [
        {
            find: "AngleBracketsIcon",
            replacement: {
                match: /\i\.\i\((\i)\),\i\.\i\(\i,\{AIcon/,
                replace: "$self.iconsModule($1),$&"
            }
        },
        {
            find: "#{intl::USER_SETTINGS_PROFILE_COLOR_SELECT_COLOR}),focusProps:",
            replacement: {
                match: /(?=function (\i)\(\i\)\{let\{onChange:\i,onClose:\i,[^}]+?showEyeDropper:)/,
                replace: "$self.setColorPicker($1);"
            }
        },
        {
            find: /="ltr",orientation:\i="vertical"[^}]+?customTheme:/,
            replacement: {
                match: /(?=function (\i)\(\i,\i,\i\)\{.{0,20}?return function\(\i\)\{let\{[^}]+?="ltr",orientation:)/,
                replace: "$self.setCreateScroller($1);"
            }
        }
    ],
    iconsModule(value: IconsDef) {
        iconsModule = value;
    },
    setColorPicker,
    setCreateScroller,
});
