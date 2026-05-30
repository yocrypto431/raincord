/*
 * Equicord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { addContextMenuPatch, removeContextMenuPatch } from "@api/ContextMenu";
import { ChatBarButton, ChatBarButtonFactory } from "@api/ChatButtons";
import { definePluginSettings } from "@api/Settings";
import definePlugin, { OptionType } from "@utils/types";
import { Menu, Parser, Toasts, useState, useEffect, React } from "@webpack/common";
import type { Message } from "@vencord/discord-types";

const MARKER = "\u200B\u200C\u200D";
const RC_MARKER = "\u9F99\u9F8D"; // 龙龍 — two dragon chars as marker (blends with CJK output)

// RAINCORD secret — multi-layer derivation, obfuscated in split hex
const _S = [
    "\x52\x34\x31\x4e",
    "\x43\x30\x52\x44",
    "-\xC6\x92\xC3\xB8",
    "\x72\x6B\x2D\x32",
    "0\x32\x36\x2D",
    "\x78\x39\x4B\x70",
    "$\x6D\x5A\x21",
    "\x76\x4C\x23\x38",
    "w\x51\x65\x40",
    "\x6E\x42\x66\x54",
    "&\x6A\x59\x2A",
    "3\x68\x55\x63",
    "\x41\x37\x64\x47",
    "!\xC2\xA7\xE2\x80\xA0",
    "\xE2\x88\x9E\xCF\x80",
    "\xE2\x9C\xA6\xF0\x9F\x94\x91",
].join("");

// second key material — XOR'd with timestamp-derived salt per message
const _K2 = new Uint8Array([
    0x7A, 0xF3, 0x1B, 0x9E, 0x4D, 0xC8, 0x62, 0xA5,
    0x0F, 0xD7, 0x83, 0x56, 0xE1, 0x2C, 0x94, 0xB8,
    0x3F, 0x6A, 0xD0, 0x15, 0x77, 0xEC, 0x49, 0x8B,
    0xA2, 0x5E, 0xC1, 0x36, 0xF9, 0x04, 0x68, 0xDD,
]);

async function rcDeriveKey(): Promise<CryptoKey> {
    const pass = new TextEncoder().encode(_S);
    // round 1: HMAC-like construction
    const s1 = await crypto.subtle.digest("SHA-512", pass);
    // round 2: mix with second key material
    const mixed = new Uint8Array(64 + _K2.length);
    mixed.set(new Uint8Array(s1), 0);
    mixed.set(_K2, 64);
    const s2 = await crypto.subtle.digest("SHA-512", mixed);
    // round 3: iterative hashing (poor man's PBKDF)
    let current = new Uint8Array(s2);
    for (let i = 0; i < 1000; i++) {
        const round = new Uint8Array(current.length + 4);
        round.set(current, 0);
        round[current.length] = (i >>> 24) & 0xFF;
        round[current.length + 1] = (i >>> 16) & 0xFF;
        round[current.length + 2] = (i >>> 8) & 0xFF;
        round[current.length + 3] = i & 0xFF;
        current = new Uint8Array(await crypto.subtle.digest("SHA-256", round));
    }
    return crypto.subtle.importKey("raw", current, "AES-GCM", false, ["encrypt", "decrypt"]);
}

// encode bytes as CJK chars — each byte maps to one char in CJK range
function bytesToChaos(bytes: Uint8Array): string {
    let out = "";
    for (let i = 0; i < bytes.length; i++) {
        out += String.fromCharCode(0x4E00 + bytes[i]);
    }
    return out;
}

function chaosToBytes(text: string): Uint8Array {
    const bytes = new Uint8Array(text.length);
    for (let i = 0; i < text.length; i++) {
        bytes[i] = text.charCodeAt(i) - 0x4E00;
    }
    return bytes;
}

async function rcEncrypt(plaintext: string): Promise<string> {
    const key = await rcDeriveKey();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const data = new TextEncoder().encode(plaintext);
    const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, data);
    const combined = new Uint8Array(12 + ct.byteLength);
    combined.set(iv, 0);
    combined.set(new Uint8Array(ct), 12);
    return RC_MARKER + bytesToChaos(combined);
}

async function rcDecrypt(ciphertext: string): Promise<string | null> {
    if (!ciphertext.startsWith(RC_MARKER)) return null;
    try {
        const key = await rcDeriveKey();
        const payload = ciphertext.slice(RC_MARKER.length);
        const bytes = chaosToBytes(payload);
        if (bytes.length < 13) return null;
        const iv = bytes.slice(0, 12);
        const ct = bytes.slice(12);
        const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
        return new TextDecoder().decode(pt);
    } catch {
        return null;
    }
}

function isRcEncrypted(text: string): boolean {
    return text.startsWith(RC_MARKER);
}

// ── Original technique-based encryption ──

const NOISE_CHARSETS = [
    "§¤¦¶†‡•‰™©®",
    "αβγδεζηθικλμ",
    "╔╗╚╝║═╬╠╣╦╩┼",
    "░▒▓█▄▀▐▌◆◇○●",
    "∀∂∃∅∆∇∈∏∑∞∝√",
    "①②③④⑤⑥⑦⑧⑨⑩⑪",
    "ⒶⒷⒸⒹⒺⒻⒼⒽⒾⒿⓀ",
    "♠♣♦♥♤♧♢♡★☆✦",
    "♈♉♊♋♌♍♎♏♐♑♒♓",
    "☀☁☂☃❿❀❁❂❃❄❅",
    "⚀⚁⚂⚃⚄⚅◐◑◒◓◔",
    "▲△▴▵▶▷▸▹►▻▼▽",
    "⊕⊖⊗⊘⊙⊚⊛⊜⊝⊞⊟",
    "←→↑↓↔↕↖↗↘↙↚↛",
    "⌐¬√∛∜∝∞∟∠∡∢∣",
    "₠₡₢₣₤₥₦₧₨₩₪₫",
    "♩♪♫♬♭♮♯◊♦◈◇",
    "≈≉≊≋≌≍≎≏≐≑≒≓",
    "⊛⊕⊗⊘⊙⊚⊜⊝⊞⊟⟐",
    "✕✖✗✘✙✚✛✜✝✞✟",
    "☰☱☲☳☴☵☶☷⚊⚋⚌",
];

function seededRng(seed: number) {
    return () => {
        seed = (seed + 0x6D2B79F5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function makeSBox(rng: () => number): Uint8Array {
    const sbox = new Uint8Array(256);
    for (let i = 0; i < 256; i++) sbox[i] = i;
    for (let i = 255; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [sbox[i], sbox[j]] = [sbox[j], sbox[i]];
    }
    return sbox;
}

function invertSBox(sbox: Uint8Array): Uint8Array {
    const inv = new Uint8Array(256);
    for (let i = 0; i < 256; i++) inv[sbox[i]] = i;
    return inv;
}

function encrypt(plaintext: string, technique: number): string {
    const prefixed = "NC:" + plaintext;
    const raw = new TextEncoder().encode(prefixed);
    const base = (technique + 1) * 7919 + 31337;
    const xorRng = seededRng(base);
    const sbox = makeSBox(seededRng(base + 65537));
    const noiseRng = seededRng(base + 99991);
    const charset = NOISE_CHARSETS[technique % NOISE_CHARSETS.length];

    const xored = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) xored[i] = raw[i] ^ Math.floor(xorRng() * 256);

    const substituted = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) substituted[i] = sbox[xored[i]];

    let hex = "";
    for (let i = 0; i < substituted.length; i++) {
        hex += substituted[i].toString(16).padStart(2, "0");
        if (noiseRng() < 0.35) hex += charset[Math.floor(noiseRng() * charset.length)];
    }

    return MARKER + hex;
}

function decrypt(ciphertext: string, technique: number): string | null {
    if (!ciphertext.startsWith(MARKER)) return null;
    const stripped = ciphertext.slice(3).replace(/[^0-9a-fA-F]/g, "");
    if (stripped.length < 2 || stripped.length % 2 !== 0) return null;

    const bytes = new Uint8Array(stripped.length / 2);
    for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(stripped.slice(i * 2, i * 2 + 2), 16);

    const base = (technique + 1) * 7919 + 31337;
    const xorRng = seededRng(base);
    const sbox = makeSBox(seededRng(base + 65537));
    const inv = invertSBox(sbox);

    const unsubstituted = new Uint8Array(bytes.length);
    for (let i = 0; i < bytes.length; i++) unsubstituted[i] = inv[bytes[i]];

    const plain = new Uint8Array(bytes.length);
    for (let i = 0; i < bytes.length; i++) plain[i] = unsubstituted[i] ^ Math.floor(xorRng() * 256);

    let text: string;
    try {
        text = new TextDecoder("utf-8", { fatal: true }).decode(plain);
    } catch {
        return null;
    }
    return text.startsWith("NC:") ? text.slice(3) : null;
}

function isEncrypted(text: string): boolean {
    return text.startsWith(MARKER) || text.startsWith(RC_MARKER);
}

function autoDecrypt(ciphertext: string): { text: string; technique: number | "RAINCORD"; } | null {
    if (ciphertext.startsWith(RC_MARKER)) return null; // handled async
    if (!ciphertext.startsWith(MARKER)) return null;
    for (let t = 0; t < 400; t++) {
        const result = decrypt(ciphertext, t);
        if (result !== null) return { text: result, technique: t };
    }
    return null;
}

// ── Settings ──

const TECHNIQUE_RAINCORD = -1;

const settings = definePluginSettings({
    autoDecrypt: {
        type: OptionType.BOOLEAN,
        description: "Automatically decrypt encrypted messages",
        default: true,
    },
    autoEncrypt: {
        type: OptionType.BOOLEAN,
        description: "Automatically encrypt all outgoing messages",
        default: false,
    },
    defaultTechnique: {
        type: OptionType.SLIDER,
        description: "Default encryption technique (0-399). Use right-click menu for RAINCORD mode.",
        default: 0,
        markers: [0, 50, 100, 150, 200, 250, 300, 350, 399],
        stickToMarkers: false,
    },
});

let encryptionEnabled = false;
let currentTechnique: number = 0; // -1 = RAINCORD mode

function LockIcon({ enabled, width = 20, height = 20 }: { enabled: boolean; width?: number; height?: number; }) {
    const isRc = currentTechnique === TECHNIQUE_RAINCORD && enabled;
    return (
        <svg width={width} height={height} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            {isRc ? (
                <path fill="var(--brand-experiment)" d="M12 2L4 5v6.09c0 5.05 3.41 9.76 8 10.91 4.59-1.15 8-5.86 8-10.91V5l-8-3z" />
            ) : enabled
                ? <path fill="currentColor" d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zM12 17c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zM15.1 8H8.9V6c0-1.71 1.39-3.1 3.1-3.1s3.1 1.39 3.1 3.1v2z" />
                : <path fill="currentColor" opacity="0.8" d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6h2c0-1.66 1.34-3 3-3s3 1.34 3 3v2h-2V6c0-1.71-1.39-3.1-3.1-3.1S8.9 4.29 8.9 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2z" />
            }
            {isRc && <path d="M9 12l2 2 4-4" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />}
        </svg>
    );
}

function TechniqueMenu() {
    const [, forceUpdate] = React.useReducer((x: number) => x + 1, 0);
    return (
        <Menu.Menu navId="encrypted-message-menu" aria-label="Encryption" onClose={() => { }}>
            <Menu.MenuGroup label="Exclusive">
                <Menu.MenuRadioItem
                    id="enc-key-raincord"
                    group="enc-technique"
                    label="RAINCORD (AES-256-GCM)"
                    checked={currentTechnique === TECHNIQUE_RAINCORD}
                    action={() => {
                        currentTechnique = TECHNIQUE_RAINCORD;
                        forceUpdate();
                        Toasts.show({
                            message: "RAINCORD Encrypt active",
                            type: Toasts.Type.SUCCESS,
                            id: Toasts.genId(),
                        });
                    }}
                />
            </Menu.MenuGroup>
            <Menu.MenuSeparator />
            {Array.from({ length: 4 }, (_, g) => (
                <Menu.MenuItem
                    id={`enc-group-${g}`}
                    key={g}
                    label={`Technique ${g * 100} - ${(g + 1) * 100 - 1}`}
                >
                    {Array.from({ length: 100 }, (__, i) => {
                        const idx = g * 100 + i;
                        return (
                            <Menu.MenuRadioItem
                                key={idx}
                                id={`enc-key-${idx}`}
                                group="enc-technique"
                                label={`Technique ${idx}`}
                                checked={currentTechnique === idx}
                                action={() => {
                                    currentTechnique = idx;
                                    forceUpdate();
                                    Toasts.show({
                                        message: `🔐 Encryption key → ${idx}`,
                                        type: Toasts.Type.SUCCESS,
                                        id: Toasts.genId(),
                                    });
                                }}
                            />
                        );
                    })}
                </Menu.MenuItem>
            ))}
        </Menu.Menu>
    );
}

const EncryptButton: ChatBarButtonFactory = ({ type }) => {
    const [enabled, setEnabled] = React.useState(encryptionEnabled);
    const [, forceUpdate] = React.useReducer((x: number) => x + 1, 0);

    if (!["normal", "sidebar"].some(n => type.analyticsName === n)) return null;

    const isRc = currentTechnique === TECHNIQUE_RAINCORD;
    const tooltip = enabled
        ? isRc ? "RAINCORD Encrypt ON" : `Encryption active — Technique ${currentTechnique}`
        : "Encryption disabled (right-click: select mode)";

    return (
        <span
            onContextMenu={e => {
                e.preventDefault();
                e.stopPropagation();
                const { ContextMenuApi } = Vencord.Webpack.Common as any;
                ContextMenuApi?.openContextMenu?.(e, () => <TechniqueMenu />);
            }}
        >
            <ChatBarButton
                tooltip={tooltip}
                onClick={() => {
                    encryptionEnabled = !encryptionEnabled;
                    setEnabled(encryptionEnabled);
                    forceUpdate();
                }}
            >
                <LockIcon enabled={enabled} />
            </ChatBarButton>
        </span>
    );
};

/* ── Inline decryption accessory ── */
const DecryptionSetters = new Map<string, (v: { text: string; mode: string; } | undefined) => void>();

function DecryptionAccessory({ message }: { message: Message; }) {
    const [decrypted, setDecrypted] = useState<{ text: string; mode: string; }>();

    useEffect(() => {
        if ((message as any).vencordEmbeddedBy) return;
        DecryptionSetters.set(message.id, setDecrypted);

        if (settings.store.autoDecrypt && isEncrypted(message.content)) {
            if (isRcEncrypted(message.content)) {
                rcDecrypt(message.content).then(r => { if (r) setDecrypted({ text: r, mode: "RAINCORD" }); });
            } else {
                const found = autoDecrypt(message.content);
                if (found) setDecrypted({ text: found.text, mode: `Technique ${found.technique}` });
            }
        }

        return () => void DecryptionSetters.delete(message.id);
    }, []);

    if (!decrypted) return null;

    const isRc = decrypted.mode === "RAINCORD";

    return (
        <span style={{ color: "var(--text-muted)", fontStyle: "italic", fontSize: "0.9em", lineHeight: "1.2rem", display: "block", marginTop: 4 }}>
            <LockIcon enabled={true} width={16} height={16} />
            {" "}
            {Parser.parse(decrypted.text)}
            <br />
            <span style={{ fontSize: "0.8em", opacity: 0.7 }}>
                ({isRc ? "exclusive" : decrypted.mode} —{" "}
                <button
                    onClick={() => setDecrypted(undefined)}
                    style={{ background: "none", border: "none", color: "var(--text-link)", cursor: "pointer", padding: 0, font: "inherit", fontStyle: "italic" }}
                >
                    dismiss
                </button>
                {" | "}
                <button
                    onClick={() => { navigator.clipboard.writeText(decrypted.text); Toasts.show({ message: "Copied!", type: Toasts.Type.SUCCESS, id: Toasts.genId() }); }}
                    style={{ background: "none", border: "none", color: "var(--text-link)", cursor: "pointer", padding: 0, font: "inherit", fontStyle: "italic" }}
                >
                    copy
                </button>
                )
            </span>
        </span>
    );
}

const messageContextPatch = (children: any, { message }: { message: any; }) => {
    if (!children || !Array.isArray(children)) return;
    try {
        if (!message?.content || !isEncrypted(message.content)) return;
        children.splice(-1, 0, (
            <Menu.MenuGroup key="nc-encryption-group">
                <Menu.MenuItem
                    id="nc-decrypt-message"
                    label="🔓 Decrypt message"
                    action={async () => {
                        let result: { text: string; mode: string; } | null = null;

                        if (isRcEncrypted(message.content)) {
                            const r = await rcDecrypt(message.content);
                            if (r) result = { text: r, mode: "RAINCORD" };
                        } else {
                            const found = autoDecrypt(message.content);
                            if (found) result = { text: found.text, mode: `Technique ${found.technique}` };
                        }

                        if (result) {
                            const setter = DecryptionSetters.get(message.id);
                            if (setter) setter(result);
                            else Toasts.show({ message: `🔓 ${result.text}`, type: Toasts.Type.SUCCESS, id: Toasts.genId() });
                            Toasts.show({ message: `Mode: ${result.mode}`, type: Toasts.Type.MESSAGE, id: Toasts.genId() });
                        } else {
                            Toasts.show({ message: "❌ Cannot decrypt — unknown encryption", type: Toasts.Type.FAILURE, id: Toasts.genId() });
                        }
                    }}
                />
            </Menu.MenuGroup>
        ));
    } catch (e) {
        console.error("[EncryptedMessage] Context menu patch error:", e);
    }
};

export default definePlugin({
    name: "EncryptedMessage",
    description: "Encrypt messages with 400 techniques OR exclusive RAINCORD mode (AES-256-GCM — only RAINCORD users can decrypt).",
    authors: [{ name: "RAINCORD", id: 0n }],
    dependencies: ["ChatInputButtonAPI", "MessageEventsAPI", "MessageAccessoriesAPI"],
    settings,

    chatBarButton: {
        icon: () => <LockIcon enabled={encryptionEnabled} />,
        render: EncryptButton,
    },

    renderMessageAccessory: (props: any) => props?.message ? <DecryptionAccessory message={props.message} /> : null,

    start() {
        addContextMenuPatch("message", messageContextPatch);
        currentTechnique = settings.store.defaultTechnique;
    },

    stop() {
        removeContextMenuPatch("message", messageContextPatch);
        encryptionEnabled = false;
    },

    async onBeforeMessageSend(_channelId: string, messageObj: { content: string; }) {
        const shouldEncrypt = encryptionEnabled || settings.store.autoEncrypt;
        if (!shouldEncrypt || !messageObj.content || messageObj.content.trim().length === 0) return;

        let encrypted: string;
        if (currentTechnique === TECHNIQUE_RAINCORD) {
            encrypted = await rcEncrypt(messageObj.content);
        } else {
            encrypted = encrypt(messageObj.content, currentTechnique);
        }

        if (encrypted.length > 2000) {
            Toasts.show({
                message: `❌ Message too long to encrypt (${encrypted.length}/2000)`,
                type: Toasts.Type.FAILURE,
                id: Toasts.genId(),
            });
            return { cancel: true };
        }
        messageObj.content = encrypted;
    },
});
