/*
 * RAINCORD — USDC Encrypter
 * Criptografia exclusiva para usuários RAINCORD.
 * Mensagens são automaticamente descriptografadas por quem tem o plugin.
 * Auto-delete configurável de 30s a 12h.
 */

import { addContextMenuPatch, removeContextMenuPatch } from "@api/ContextMenu";
import { ChatBarButton, ChatBarButtonFactory } from "@api/ChatButtons";
import { definePluginSettings } from "@api/Settings";
import definePlugin, { OptionType } from "@utils/types";
import { Menu, Parser, Toasts, useState, useEffect, React } from "@webpack/common";
import { RestAPI } from "@webpack/common";
import type { Message } from "@vencord/discord-types";

// ── Marcador invisível único para USDC ──
const USDC_MARKER = "\u200D\u200B\u200D\u200C";

// ── Derivação de chave ofuscada (AES-256 via Web Crypto) ──
// A chave é derivada em runtime a partir de múltiplas transformações
// para dificultar extração estática do source code.
const _0x4a = [0x52, 0x41, 0x49, 0x4e, 0x43, 0x4f, 0x52, 0x44]; // fragmento 1
const _0x7b = [0x2d, 0x55, 0x53, 0x44, 0x43, 0x2d, 0x45, 0x4e]; // fragmento 2
const _0x9c = [0x43, 0x52, 0x59, 0x50, 0x54, 0x2d, 0x56, 0x31]; // fragmento 3
const _0xe1 = [0x2d, 0x41, 0x45, 0x53, 0x32, 0x35, 0x36, 0x47]; // fragmento 4

function _dk(): Uint8Array {
    const p = new Uint8Array(32);
    const s = [..._0x4a, ..._0x7b, ..._0x9c, ..._0xe1];
    for (let i = 0; i < 32; i++) {
        p[i] = s[i] ^ ((i * 0x5F + 0x3B) & 0xFF);
        p[i] = ((p[i] << 3) | (p[i] >>> 5)) & 0xFF;
        p[i] ^= ((i * i + 0x7E) & 0xFF);
    }
    // Múltiplas rodadas de mixing
    for (let r = 0; r < 4; r++) {
        for (let i = 0; i < 32; i++) {
            p[i] ^= p[(i + 13) % 32];
            p[i] = ((p[i] + 0xA7) & 0xFF);
            p[i] ^= ((i * 0x1F + r * 0x4D) & 0xFF);
        }
    }
    return p;
}

// Salt fixo ofuscado para PBKDF2
function _ds(): Uint8Array {
    const s = new Uint8Array(16);
    const base = 0xDEAD_BEEF;
    for (let i = 0; i < 16; i++) {
        s[i] = ((base >>> ((i % 4) * 8)) ^ (i * 0x37 + 0x5C)) & 0xFF;
    }
    return s;
}

let _cachedKey: CryptoKey | null = null;

async function _getKey(): Promise<CryptoKey> {
    if (_cachedKey) return _cachedKey;
    const rawKey = _dk();
    const salt = _ds();
    // Importar como material para PBKDF2
    const keyMaterial = await crypto.subtle.importKey("raw", rawKey, "PBKDF2", false, ["deriveKey"]);
    // Derivar chave AES-256-GCM via PBKDF2 com 310000 iterações
    _cachedKey = await crypto.subtle.deriveKey(
        { name: "PBKDF2", salt, iterations: 310000, hash: "SHA-256" },
        keyMaterial,
        { name: "AES-GCM", length: 256 },
        false,
        ["encrypt", "decrypt"]
    );
    return _cachedKey;
}

// ── Charsets de ruído visual ──
const NOISE_CHARS = "₿Ξ◈◆◇●○□■△▽⬡⬢⟐⟡⊕⊗⊘⊙⊚⊛⊜⊝";

// ── Encrypt (AES-256-GCM) ──
async function encrypt(plaintext: string): Promise<string> {
    const key = await _getKey();
    const iv = crypto.getRandomValues(new Uint8Array(12)); // IV aleatório por mensagem
    const encoded = new TextEncoder().encode(plaintext);

    const cipherBuf = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv },
        key,
        encoded
    );

    // Formato: IV (12 bytes) + ciphertext
    const combined = new Uint8Array(iv.length + cipherBuf.byteLength);
    combined.set(iv, 0);
    combined.set(new Uint8Array(cipherBuf), iv.length);

    // Converter para hex com ruído visual
    let hex = "";
    const noiseRng = _simpleRng(iv[0] + iv[1] * 256);
    for (let i = 0; i < combined.length; i++) {
        hex += combined[i].toString(16).padStart(2, "0");
        if (noiseRng() < 0.25) hex += NOISE_CHARS[Math.floor(noiseRng() * NOISE_CHARS.length)];
    }

    return USDC_MARKER + hex;
}

// ── Decrypt (AES-256-GCM) ──
async function decrypt(ciphertext: string): Promise<string | null> {
    if (!ciphertext.startsWith(USDC_MARKER)) return null;
    const stripped = ciphertext.slice(USDC_MARKER.length).replace(/[^0-9a-fA-F]/g, "");
    if (stripped.length < 26 || stripped.length % 2 !== 0) return null; // mínimo: 12 IV + 1 byte + 16 tag

    const bytes = new Uint8Array(stripped.length / 2);
    for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(stripped.slice(i * 2, i * 2 + 2), 16);

    const iv = bytes.slice(0, 12);
    const cipherData = bytes.slice(12);

    try {
        const key = await _getKey();
        const plainBuf = await crypto.subtle.decrypt(
            { name: "AES-GCM", iv },
            key,
            cipherData
        );
        return new TextDecoder().decode(plainBuf);
    } catch {
        return null;
    }
}

function _simpleRng(seed: number) {
    return () => {
        seed = (seed + 0x6D2B79F5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function isUsdcEncrypted(text: string): boolean {
    return text.startsWith(USDC_MARKER);
}

// ── Auto-delete scheduler ──
const deleteQueue = new Map<string, { channelId: string; timeout: ReturnType<typeof setTimeout>; }>();

function scheduleDelete(messageId: string, channelId: string, delayMs: number) {
    // Cancelar timeout anterior se existir
    const existing = deleteQueue.get(messageId);
    if (existing) clearTimeout(existing.timeout);

    const timeout = setTimeout(async () => {
        try {
            await RestAPI.del({ url: `/channels/${channelId}/messages/${messageId}` });
            deleteQueue.delete(messageId);
        } catch (e) {
            console.error("[USDCEncrypter] Falha ao deletar mensagem:", messageId, e);
            deleteQueue.delete(messageId);
        }
    }, delayMs);

    deleteQueue.set(messageId, { channelId, timeout });
}

// ── Settings ──
const settings = definePluginSettings({
    autoDecrypt: {
        type: OptionType.BOOLEAN,
        description: "Descriptografar automaticamente mensagens USDC",
        default: true,
    },
    autoDelete: {
        type: OptionType.BOOLEAN,
        description: "Auto-deletar mensagens criptografadas após o timeout",
        default: true,
    },
    deleteTimeout: {
        type: OptionType.SELECT,
        description: "Tempo para auto-deletar mensagens",
        default: "30",
        options: [
            { label: "30 segundos", value: "30" },
            { label: "1 minuto", value: "60" },
            { label: "2 minutos", value: "120" },
            { label: "5 minutos", value: "300" },
            { label: "10 minutos", value: "600" },
            { label: "15 minutos", value: "900" },
            { label: "30 minutos", value: "1800" },
            { label: "1 hora", value: "3600" },
            { label: "2 horas", value: "7200" },
            { label: "6 horas", value: "21600" },
            { label: "12 horas", value: "43200" },
        ],
    },
});

// ── State ──
let encryptionEnabled = false;

// ── Icons ──
function UsdcIcon({ enabled, width = 20, height = 20 }: { enabled: boolean; width?: number; height?: number; }) {
    return (
        <svg width={width} height={height} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            {enabled ? (
                <g>
                    <circle cx="12" cy="12" r="10" fill="currentColor" opacity="0.2" />
                    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.5" fill="none" />
                    <path d="M12 6v1.5M12 16.5V18M9.17 9.17a4 4 0 0 1 5.66 0M9.17 14.83a4 4 0 0 0 5.66 0" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                    <text x="12" y="13.5" textAnchor="middle" fontSize="5" fontWeight="bold" fill="currentColor">$</text>
                </g>
            ) : (
                <g opacity="0.5">
                    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.5" fill="none" />
                    <text x="12" y="13.5" textAnchor="middle" fontSize="5" fontWeight="bold" fill="currentColor">$</text>
                    <line x1="4" y1="4" x2="20" y2="20" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </g>
            )}
        </svg>
    );
}

// ── ChatBar Button ──
const UsdcButton: ChatBarButtonFactory = ({ type }) => {
    const [enabled, setEnabled] = React.useState(encryptionEnabled);

    if (!["normal", "sidebar"].some(n => type.analyticsName === n)) return null;

    const timeoutLabel = settings.store.autoDelete
        ? ` | Auto-delete: ${settings.store.deleteTimeout}s`
        : "";

    const tooltip = enabled
        ? `USDC Encrypter ATIVO${timeoutLabel}`
        : "USDC Encrypter desativado";

    return (
        <ChatBarButton
            tooltip={tooltip}
            onClick={() => {
                encryptionEnabled = !encryptionEnabled;
                setEnabled(encryptionEnabled);
                Toasts.show({
                    message: encryptionEnabled ? "🔒 USDC Encrypter ativado" : "🔓 USDC Encrypter desativado",
                    type: Toasts.Type.SUCCESS,
                    id: Toasts.genId(),
                });
            }}
        >
            <UsdcIcon enabled={enabled} />
        </ChatBarButton>
    );
};

// ── Inline decryption accessory ──
const DecryptionSetters = new Map<string, (v: string | undefined) => void>();

function UsdcDecryptionAccessory({ message }: { message: Message; }) {
    const [decrypted, setDecrypted] = useState<string>();

    useEffect(() => {
        if ((message as any).vencordEmbeddedBy) return;
        DecryptionSetters.set(message.id, setDecrypted);

        if (settings.store.autoDecrypt && isUsdcEncrypted(message.content)) {
            decrypt(message.content).then(result => {
                if (result) setDecrypted(result);
            });
        }

        return () => void DecryptionSetters.delete(message.id);
    }, []);

    if (!decrypted) return null;

    return (
        <span style={{
            color: "var(--text-normal)",
            fontSize: "0.9em",
            lineHeight: "1.3rem",
            display: "block",
            marginTop: 4,
            padding: "6px 10px",
            background: "var(--background-secondary)",
            borderRadius: 6,
            borderLeft: "3px solid #2775CA",
        }}>
            <span style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 2 }}>
                <UsdcIcon enabled={true} width={14} height={14} />
                <span style={{ fontSize: "0.75em", color: "#2775CA", fontWeight: 600 }}>USDC ENCRYPTED</span>
            </span>
            {Parser.parse(decrypted)}
        </span>
    );
}

// ── Context menu ──
const messageContextPatch = (children: any, { message }: { message: any; }) => {
    if (!children || !Array.isArray(children)) return;
    try {
        if (!message?.content || !isUsdcEncrypted(message.content)) return;
        children.splice(-1, 0, (
            <Menu.MenuGroup key="usdc-encryption-group">
                <Menu.MenuItem
                    id="usdc-decrypt-message"
                    label="🔓 Descriptografar (USDC)"
                    action={async () => {
                        const result = await decrypt(message.content);
                        if (result !== null) {
                            const setter = DecryptionSetters.get(message.id);
                            if (setter) {
                                setter(result);
                            } else {
                                Toasts.show({ message: `🔓 ${result}`, type: Toasts.Type.SUCCESS, id: Toasts.genId() });
                            }
                        } else {
                            Toasts.show({
                                message: "❌ Falha ao descriptografar",
                                type: Toasts.Type.FAILURE,
                                id: Toasts.genId(),
                            });
                        }
                    }}
                />
            </Menu.MenuGroup>
        ));
    } catch (e) {
        console.error("[USDCEncrypter] Context menu patch error:", e);
    }
};

// ── Plugin ──
export default definePlugin({
    name: "USDCEncrypter",
    description: "Criptografia exclusiva RAINCORD. Apenas usuários com RAINCORD descriptografam automaticamente. Auto-delete configurável de 30s a 12h.",
    authors: [{ name: "RAINCORD", id: 0n }],
    dependencies: ["ChatInputButtonAPI", "MessageEventsAPI", "MessageAccessoriesAPI"],
    settings,

    chatBarButton: {
        icon: () => <UsdcIcon enabled={encryptionEnabled} />,
        render: UsdcButton,
    },

    renderMessageAccessory: (props: any) => props?.message ? <UsdcDecryptionAccessory message={props.message} /> : null,

    start() {
        addContextMenuPatch("message", messageContextPatch);
    },

    stop() {
        removeContextMenuPatch("message", messageContextPatch);
        encryptionEnabled = false;
        // Limpar todos os timeouts pendentes
        for (const [, { timeout }] of deleteQueue) clearTimeout(timeout);
        deleteQueue.clear();
    },

    async onBeforeMessageSend(_channelId: string, messageObj: { content: string; }) {
        if (!encryptionEnabled || !messageObj.content || messageObj.content.trim().length === 0) return;

        const encrypted = await encrypt(messageObj.content);
        if (encrypted.length > 2000) {
            Toasts.show({
                message: `❌ Mensagem muito longa para criptografar (${encrypted.length}/2000)`,
                type: Toasts.Type.FAILURE,
                id: Toasts.genId(),
            });
            return { cancel: true };
        }
        messageObj.content = encrypted;
    },

    onMessageCreate(event: any) {
        // Agendar auto-delete para mensagens USDC enviadas por nós
        if (!settings.store.autoDelete) return;
        const message = event?.message;
        if (!message?.content || !message?.id || !message?.channel_id) return;
        if (!isUsdcEncrypted(message.content)) return;

        // Verificar se a mensagem é nossa (author.id === current user)
        const currentUserId = (window as any).Vencord?.Webpack?.Common?.UserStore?.getCurrentUser?.()?.id;
        if (!currentUserId || message.author?.id !== currentUserId) return;

        const delayMs = parseInt(settings.store.deleteTimeout) * 1000;
        scheduleDelete(message.id, message.channel_id, delayMs);
    },
});
