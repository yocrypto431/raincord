/*
 * Equicord, a Discord client mod
 * Copyright (c) 2024 RAINCORD contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import definePlugin from "@utils/types";
import { findByPropsLazy } from "@webpack";
import { RelationshipStore, Toasts } from "@webpack/common";

const RelationshipActions = findByPropsLazy("removeFriend", "sendFriendRequest");

// RelationshipType 4 = OUTGOING_REQUEST
const OUTGOING_REQUEST = 4;

function cancelRequest(userId: string) {
    try {
        RelationshipActions.removeFriend(userId);
        Toasts.show({
            message: "Solicitação de amizade cancelada ✓",
            type: Toasts.Type.SUCCESS,
            id: Toasts.genId(),
        });
    } catch (e) {
        console.error("[CancelFriendRequest] Error:", e);
    }
}

function getUserIdFromOutgoingRelationships(): string | null {
    try {
        const rels = (RelationshipStore as any).getRelationships?.() ?? {};
        for (const [uid, type] of Object.entries(rels)) {
            if (type === OUTGOING_REQUEST) return uid;
        }
    } catch {}
    return null;
}

let observer: MutationObserver | null = null;

function patchBtn(btn: HTMLElement, userId: string) {
    if (btn.dataset.cfp) return;
    btn.dataset.cfp = "1";
    btn.addEventListener("click", (e: MouseEvent) => {
        e.preventDefault();
        e.stopImmediatePropagation();
        cancelRequest(userId);
    }, true);
    // Remover o disabled se presente para que o clique seja possível
    btn.removeAttribute("disabled");
    btn.style.cursor = "pointer";
    btn.style.opacity = "1";
}

function scan(root: Document | Element = document) {
    // ── Caso 1 : popup perfil ─────────────────────────────────────────────────
    // aria-label="Outgoing Friend Request" — invariante independente do idioma da UI
    root.querySelectorAll<HTMLElement>('button[aria-label="Outgoing Friend Request"]').forEach(btn => {
        // Encontrar o userId via o container do perfil
        const profileContainer = btn.closest("[class*='profileButtons']") 
            ?? btn.closest("[class*='profileHeader']")
            ?? btn.closest("[class*='inner']");
        if (!profileContainer) return;

        // Procurar um avatar com CDN Discord que contém o userId
        const wholeModal = btn.closest("[class*='modal'], [class*='userPopout'], [class*='profileBody']")
            ?? document;
        const avatarImg = wholeModal?.querySelector?.("img[src*='cdn.discordapp.com/avatars/']");
        if (avatarImg) {
            const m = avatarImg.getAttribute("src")?.match(/avatars\/(\d+)\//);
            if (m) { patchBtn(btn, m[1]); return; }
        }
        // Fallback : procurar via as relações pendentes (se apenas 1 solicitação enviada)
        const uid = getUserIdFromOutgoingRelationships();
        if (uid) patchBtn(btn, uid);
    });

    // ── Caso 2 : DM header ────────────────────────────────────────────────────
    // O botão "Friend Request Sent" está disabled + secondary no header DM
    // Estrutura : div.container_b50d96 > div.inline_b50d96 > button[disabled].secondary
    root.querySelectorAll<HTMLElement>('button[disabled][class*="secondary"]').forEach(btn => {
        // Verificar se estamos em um header de DM (não em outro lugar)
        const container = btn.closest("[class*='container_b50d96'], [class*='dmWelcome'], [class*='privateChannelEmptyMessage']");
        if (!container) return;

        // Recuperar o userId via o avatar neste header
        const avatarImg = container.querySelector("img[src*='cdn.discordapp.com/avatars/']");
        if (avatarImg) {
            const m = avatarImg.getAttribute("src")?.match(/avatars\/(\d+)\//);
            if (m) {
                const relType = (RelationshipStore as any).getRelationshipType(m[1]);
                if (relType === OUTGOING_REQUEST) { patchBtn(btn, m[1]); return; }
            }
        }

        // Fallback : via as relações enviadas
        const uid = getUserIdFromOutgoingRelationships();
        if (uid) {
            const relType = (RelationshipStore as any).getRelationshipType(uid);
            if (relType === OUTGOING_REQUEST) patchBtn(btn, uid);
        }
    });
}

export default definePlugin({
    name: "CancelFriendRequest",
    description: "Cancels a pending friend request by clicking the button again.",
    authors: [{ name: "RAINCORD", id: 0n }],

    start() {
        observer = new MutationObserver(mutations => {
            for (const m of mutations) {
                for (const node of m.addedNodes) {
                    if (node instanceof HTMLElement) scan(node);
                }
            }
        });
        observer.observe(document.body, { childList: true, subtree: true });
        scan(document);
        console.log("[CancelFriendRequest] Iniciado ✓");
    },

    stop() {
        observer?.disconnect();
        observer = null;
        document.querySelectorAll<HTMLElement>("[data-cfp]").forEach(el => {
            delete el.dataset.cfp;
        });
        console.log("[CancelFriendRequest] Parado.");
    },
});
