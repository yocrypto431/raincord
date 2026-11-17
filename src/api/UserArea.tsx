/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import ErrorBoundary from "@components/ErrorBoundary";
import { Logger } from "@utils/Logger";
import { findComponentByCodeLazy } from "@webpack";
import { useEffect, useState } from "@webpack/common";
import type { ComponentType, MouseEventHandler, ReactNode } from "react";
import { addHeaderBarButton, addStealthListener, isStealthModeEnabled, removeStealthListener } from "./HeaderBar";
import { useSettings } from "./Settings";

const PanelButton = findComponentByCodeLazy("tooltipPositionKey", "positionKeyStemOverride") as ComponentType<UserAreaButtonProps>;

export interface UserAreaButtonProps {
    icon: ReactNode;
    tooltipText?: ReactNode;
    onClick?: MouseEventHandler<HTMLDivElement>;
    onContextMenu?: MouseEventHandler<HTMLDivElement>;
    className?: string;
    role?: string;
    "aria-label"?: string;
    "aria-checked"?: boolean;
    disabled?: boolean;
    plated?: boolean;
    redGlow?: boolean;
    orangeGlow?: boolean;
}

export interface UserAreaRenderProps {
    nameplate?: any;
    iconForeground?: string;
    hideTooltips?: boolean;
}

export type UserAreaButtonFactory = (props: UserAreaRenderProps) => ReactNode;

export interface UserAreaButtonData {
    render: UserAreaButtonFactory;
    icon: ComponentType<{ className?: string; }>;
    priority?: number;
}

interface ButtonEntry {
    render: UserAreaButtonFactory;
    priority: number;
}

export const UserAreaButton = PanelButton;

const logger = new Logger("UserArea");

export const buttons = new Map<string, ButtonEntry>();

export function addUserAreaButton(id: string, render: UserAreaButtonFactory, priority = 0) {
    buttons.set(id, { render, priority });
}

export function removeUserAreaButton(id: string) {
    buttons.delete(id);
}

export type UserAreaLocation = "userArea" | "titleBar";

function UserAreaButtons({ props, where }: { props: UserAreaRenderProps; where: UserAreaLocation; }) {
    const [, forceUpdate] = useState(0);
    const { userAreaLocation } = useSettings(["userAreaLocation"]);

    useEffect(() => {
        const listener = () => forceUpdate(n => n + 1);
        addStealthListener(listener);
        window.addEventListener("RAINCORD-stealth-change", listener);
        return () => {
            removeStealthListener(listener);
            window.removeEventListener("RAINCORD-stealth-change", listener);
        };
    }, []);

    if (isStealthModeEnabled()) return null;
    if ((userAreaLocation ?? "userArea") !== where) return null;

    const inTitleBar = where === "titleBar";

    return (
        <div className={inTitleBar ? "vc-user-area-btns-titlebar" : "vc-user-area-btns"} style={inTitleBar ? undefined : { display: "contents" }}>
            {Array.from(buttons)
                .sort(([, a], [, b]) => a.priority - b.priority)
                .map(([id, { render: Button }]) => (
                    <ErrorBoundary noop key={id} onError={e => logger.error(`Failed to render ${id}`, e.error)}>
                        <Button {...props} hideTooltips={false} />
                    </ErrorBoundary>
                ))}
        </div>
    );
}

export function UserAreaTitleBarButtons() {
    return <UserAreaButtons where="titleBar" props={{}} />;
}

addHeaderBarButton("RAINCORD-userarea-buttons", () => <UserAreaTitleBarButtons />, 100);

export function _renderButtons(props: UserAreaRenderProps) {
    return [<UserAreaButtons key="vc-user-area-buttons" props={props} where="userArea" />];
}
