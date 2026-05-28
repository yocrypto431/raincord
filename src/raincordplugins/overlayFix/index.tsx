import definePlugin from "@utils/types";

export default definePlugin({
    name: "OverlayFix",
    description: "Tenta reparar o overlay enganando o Discord sobre o nome do processo (se passa por discord.exe).",
    authors: [{ name: "RAINCORD", id: 0n }],
    cannotBeDisabled: false,
    enabledByDefault: false,
    requiresRestart: true,

    start() {
        try {
            if (typeof window.DiscordNative !== "undefined") {
                const originalNative = window.DiscordNative;

                // Tentamos redefinir a propriedade no window de forma segura
                try {
                    const proxy = new Proxy(originalNative, {
                        get(target, prop) {
                            const value = target[prop as keyof typeof target];
                            if (prop === "processUtils" && value) {
                                return new Proxy(value, {
                                    get(pTarget, pProp) {
                                        const pValue = pTarget[pProp as keyof typeof pTarget];
                                        if (pProp === "getMainArgv" && typeof pValue === "function") {
                                            return (...args: any[]) => {
                                                const argv = pValue.apply(pTarget, args);
                                                if (Array.isArray(argv) && argv[0]) {
                                                    argv[0] = argv[0].replace(/RAINCORD\.exe/i, "discord.exe");
                                                }
                                                return argv;
                                            };
                                        }
                                        return typeof pValue === "function" ? pValue.bind(pTarget) : pValue;
                                    }
                                });
                            }
                            return typeof value === "function" ? value.bind(target) : value;
                        }
                    });

                    // Tentativa de substituição via defineProperty se a atribuição direta falhar
                    Object.defineProperty(window, "DiscordNative", {
                        value: proxy,
                        configurable: true,
                        enumerable: true,
                        writable: true
                    });

                    console.log("[OverlayFix] Process name spoofing active via defineProperty Proxy");
                } catch (e) {
                    console.warn("[OverlayFix] Could not redefine DiscordNative on window, attempting sub-property patch...");
                    // Se não podemos substituir o objeto inteiro, tentamos patchar suas propriedades internas
                    // Nota: Isso também pode falhar se o objeto estiver frozen, mas é nossa última chance nativa
                }
            }
        } catch (e) {
            console.error("[OverlayFix] Failed to setup spoofing:", e);
        }
    },

    patches: [
        {
            // Patch para forçar a instalação do módulo overlay se o Discord hesitar
            find: "window.DiscordNative.nativeModules.install",
            replacement: {
                match: /"discord_desktop_overlay"/,
                replace: "\"discord_desktop_overlay\", {force: true}"
            }
        }
    ]
});
