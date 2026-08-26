/*
 * Vencord, a modification for Discord's desktop app
 * Copyright (c) 2023-2026 Vendicated, Dolfies, and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import ErrorBoundary from "@components/ErrorBoundary";
import { Devs } from "@utils/constants";
import { isNonNullish } from "@utils/guards";
import { sleep } from "@utils/misc";
import { Queue } from "@utils/Queue";
import definePlugin from "@utils/types";
import { ProfileBadge } from "@vencord/discord-types";
import { Constants, FluxDispatcher, Parser, RestAPI, UserProfileStore, UserStore } from "@webpack/common";
import { type MouseEvent } from "react";

// Types
const UserFlags = (Constants.UserFlags ?? {}) as Record<string, number>;
const badges: Record<string, ProfileBadge> = {
    active_developer: { id: "active_developer", description: "Active Developer", icon: "6bdc42827a38498929a4920da12695d9", link: "https://support-dev.discord.com/hc/en-us/articles/10113997751447" },
    bug_hunter_level_1: { id: "bug_hunter_level_1", description: "Discord Bug Hunter", icon: "2717692c7dca7289b35297368a940dd0", link: "https://support.discord.com/hc/en-us/articles/360046057772-Discord-Bugs" },
    bug_hunter_level_2: { id: "bug_hunter_level_2", description: "Discord Bug Hunter", icon: "848f79194d4be5ff5f81505cbd0ce1e6", link: "https://support.discord.com/hc/en-us/articles/360046057772-Discord-Bugs" },
    certified_moderator: { id: "certified_moderator", description: "Moderator Programs Alumni", icon: "fee1624003e2fee35cb398e125dc479b", link: "https://discord.com/safety" },
    discord_employee: { id: "staff", description: "Discord Staff", icon: "5e74e9b61934fc1f67c65515d1f7e60d", link: "https://discord.com/company" },
    get staff() { return this.discord_employee; },
    hypesquad: { id: "hypesquad", description: "HypeSquad Events", icon: "bf01d1073931f921909045f3a39fd264", link: "https://discord.com/hypesquad" },
    hypesquad_online_house_1: { id: "hypesquad_house_1", description: "HypeSquad Bravery", icon: "8a88d63823d8a71cd5e390baa45efa02", link: "https://discord.com/settings/hypesquad-online" },
    hypesquad_online_house_2: { id: "hypesquad_house_2", description: "HypeSquad Brilliance", icon: "011940fd013da3f7fb926e4a1cd2e618", link: "https://discord.com/settings/hypesquad-online" },
    hypesquad_online_house_3: { id: "hypesquad_house_3", description: "HypeSquad Balance", icon: "3aa41de486fa12454c3761e8e223442e", link: "https://discord.com/settings/hypesquad-online" },
    partner: { id: "partner", description: "Partnered Server Owner", icon: "3f9748e53446a137a052f3454e2de41e", link: "https://discord.com/partners" },
    premium: { id: "premium", description: "Subscriber", icon: "2ba85e8026a8614b640c2837bcdfe21b", link: "https://discord.com/settings/premium" },
    premium_early_supporter: { id: "early_supporter", description: "Early Supporter", icon: "7060786766c9c840eb3019e725d2b358", link: "https://discord.com/settings/premium" },
    verified_developer: { id: "verified_developer", description: "Early Verified Bot Developer", icon: "6df5892e0f35b051f8b61eace34f4967" },
};

const fetching = new Set<string>();
const queue = new Queue(5);

export async function fetchUser(id: string) {
    if (!id || typeof id !== "string" || !/^\d{17,20}$/.test(id)) return null;

    let userObj = UserStore.getUser(id);
    if (userObj) return userObj;

    if (fetching.has(id)) return null;
    fetching.add(id);

    try {
        const endpoint = Constants.Endpoints?.USER ? Constants.Endpoints.USER(id) : `/users/${id}`;
        const response = await RestAPI.get({
            url: endpoint,
            retries: 2
        });

        const user = response?.body;
        if (!user || !user.id) return null;

        FluxDispatcher.dispatch({
            type: "USER_UPDATE",
            user: user,
        });

        userObj = UserStore.getUser(id);

        try {
            const fakeBadges: ProfileBadge[] = Object.entries(UserFlags)
                .filter(([_, flag]) => !isNaN(flag) && userObj?.hasFlag?.(flag))
                .map(([key]) => badges[key.toLowerCase()])
                .filter(isNonNullish);

            if (user.premium_type || (!user.bot && (user.banner || user.avatar?.startsWith?.("a_")))) {
                fakeBadges.push(badges.premium);
            }

            const profile = UserProfileStore.getUserProfile(id);
            if (profile) {
                profile.accentColor = user.accent_color;
                profile.badges = fakeBadges;
                profile.banner = user.banner;
                profile.premiumType = user.premium_type;
            }
        } catch { }

        return userObj;
    } catch (e: any) {
        if (e?.status === 429) {
            const retryAfter = e?.body?.retry_after ?? 1000;
            queue.unshift(() => sleep(retryAfter).then(() => fetchUser(id)));
        }
        return null;
    } finally {
        fetching.delete(id);
        await sleep(200);
    }
}

function queueFetchUser(id?: string) {
    if (!id || typeof id !== "string" || !/^\d{17,20}$/.test(id)) return;
    if (UserStore.getUser(id) || fetching.has(id)) return;
    queue.unshift(() => fetchUser(id));
}

function extractSnowflake(val: any): string | null {
    if (!val) return null;
    if (typeof val === "string") {
        const match = val.match(/<@!?(\d{17,20})>/) || val.match(/\b(\d{17,20})\b/);
        if (match) return match[1];
    }
    if (typeof val === "object") {
        if (val.userId && /^\d{17,20}$/.test(String(val.userId))) return String(val.userId);
        if (val.id && /^\d{17,20}$/.test(String(val.id))) return String(val.id);
        if (val.roleId && /^\d{17,20}$/.test(String(val.roleId))) return String(val.roleId);
        if (val.props) return extractSnowflake(val.props);
        if (val.content) return extractSnowflake(val.content);
        if (Array.isArray(val)) {
            for (const item of val) {
                const found = extractSnowflake(item);
                if (found) return found;
            }
        }
    }
    return null;
}

let unhookParser: (() => void) | null = null;

export default definePlugin({
    name: "ValidUser",
    description: "Fix mentions for unknown users showing up as '@unknown-user' (hover over a mention to fix it)",
    authors: [Devs.Ven, Devs.Dolfies],
    tags: ["MentionCacheFix", "Chat", "Utility"],

    patches: [
        // Patch UserMention component (has .USER_MENTION)
        {
            find: ".USER_MENTION)",
            replacement: [
                {
                    match: /(className:"mention",)/,
                    replace: "$1onMouseEnter:(e)=>$self.handleUserMentionHover(arguments[0],e),"
                }
            ]
        },
        // Patch RoleMention component (has .ROLE_MENTION) - used as fallback for uncached mentions
        {
            find: ".ROLE_MENTION)",
            replacement: [
                {
                    match: /(?<=className:\i\.\i,background:!1,.{0,60}?)(?=children:)/,
                    replace: "onMouseEnter:(e)=>$self.handleRoleMentionHover(arguments[0],e),"
                }
            ]
        },
        // Patch Markdown mention rule to ensure userId and props are preserved
        {
            find: "noStyleAndInteraction},",
            replacement: [
                {
                    match: /(className:"mention",)/,
                    replace: "$1props:arguments[2],onMouseEnter:(e)=>$self.handleMentionRuleHover(arguments[0],e),"
                }
            ]
        }
    ],

    start() {
        // Runtime hook into SimpleMarkdown mention parser rule if available
        if (Parser?.defaultRules?.mention) {
            const originalParse = Parser.defaultRules.mention.parse;
            const originalReact = Parser.defaultRules.mention.react;

            if (originalParse) {
                Parser.defaultRules.mention.parse = function (capture: any, parse: any, state: any) {
                    const node = originalParse.call(this, capture, parse, state);
                    if (node && capture?.[0]) {
                        const id = capture[0].match(/<@!?(\d{17,20})>/)?.[1];
                        if (id) {
                            node.userId = id;
                            node.id = id;
                        }
                    }
                    return node;
                };
            }

            if (originalReact) {
                Parser.defaultRules.mention.react = function (node: any, output: any, state: any) {
                    const id = node?.userId || node?.id || extractSnowflake(node);
                    const rendered = originalReact.call(this, node, output, state);

                    if (id && !UserStore.getUser(id)) {
                        return (
                            <span
                                onMouseEnter={() => queueFetchUser(id)}
                                className="vc-validuser-container"
                                style={{ display: "inline-contents" }}
                            >
                                {rendered}
                            </span>
                        );
                    }

                    return rendered;
                };
            }

            unhookParser = () => {
                if (Parser?.defaultRules?.mention) {
                    if (originalParse) Parser.defaultRules.mention.parse = originalParse;
                    if (originalReact) Parser.defaultRules.mention.react = originalReact;
                }
            };
        }
    },

    stop() {
        if (unhookParser) {
            unhookParser();
            unhookParser = null;
        }
    },

    handleUserMentionHover(props: any, event?: MouseEvent) {
        const id = props?.userId || props?.id || extractSnowflake(props);
        if (id) {
            queueFetchUser(id);
        } else if (event?.currentTarget?.textContent) {
            const extracted = extractSnowflake(event.currentTarget.textContent);
            if (extracted) queueFetchUser(extracted);
        }
    },

    handleRoleMentionHover(props: any, event?: MouseEvent) {
        const id = props?.userId || props?.id || extractSnowflake(props);
        if (id && !id.startsWith("&")) {
            queueFetchUser(id);
        } else if (event?.currentTarget?.textContent) {
            const text = event.currentTarget.textContent;
            const extracted = extractSnowflake(text);
            if (extracted) queueFetchUser(extracted);
        }
    },

    handleMentionRuleHover(data: any, event?: MouseEvent) {
        const id = data?.userId || data?.id || extractSnowflake(data);
        if (id) {
            queueFetchUser(id);
        } else if (event?.currentTarget?.textContent) {
            const extracted = extractSnowflake(event.currentTarget.textContent);
            if (extracted) queueFetchUser(extracted);
        }
    }
});
