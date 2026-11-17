import { addHeaderBarButton, removeHeaderBarButton } from "@api/HeaderBar";
import { definePluginSettings } from "@api/Settings";
import { setUserAreaLocation, UserAreaLocation, UserAreaTitleBarButtons } from "@api/UserArea";
import definePlugin, { OptionType } from "@utils/types";

import style from "./style.css?managed";

const BUTTON_ID = "RAINCORD-userarea-buttons";

const settings = definePluginSettings({
    location: {
        type: OptionType.SELECT,
        description: "Where the plugin buttons are shown",
        options: [
            { label: "User panel (bottom left)", value: "userArea", default: true },
            { label: "Title bar (top)", value: "titleBar" }
        ],
        onChange: (value: string) => setUserAreaLocation(value as UserAreaLocation)
    }
});

export default definePlugin({
    name: "ButtonsLocation",
    description: "Choose whether the plugin buttons sit in the user panel or in the title bar.",
    enabledByDefault: true,
    authors: [{ name: "RAINCORD", id: 0n }],
    dependencies: ["HeaderBarAPI", "UserAreaAPI"],
    settings,
    managedStyle: style,

    start() {
        setUserAreaLocation(settings.store.location as UserAreaLocation);
        addHeaderBarButton(BUTTON_ID, () => <UserAreaTitleBarButtons />, 100);
    },

    stop() {
        removeHeaderBarButton(BUTTON_ID);
        setUserAreaLocation("userArea");
    }
});
