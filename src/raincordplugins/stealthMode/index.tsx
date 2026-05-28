/*
 * RAINCORD - StealthMode plugin
 * Esconde todos os botões de plugins (barra superior, área de texto, área do usuário)
 * Toggle : Ctrl+Shift+H ou botão nas Configurações RAINCORD.
 *
 * NOTA: A lógica real (keydown, DOM hide, toggle) está em src/api/HeaderBar.tsx
 * e é executada no carregamento do módulo webpack, ANTES da inicialização dos plugins.
 */

import { isStealthModeEnabled, syncStealthBodyClass, toggleStealthMode } from "@api/HeaderBar";
import definePlugin from "@utils/types";

import style from "./style.css?managed";

export { toggleStealthMode as doToggle };

export function isStealthEnabled(): boolean {
    return isStealthModeEnabled();
}

export default definePlugin({
    name: "StealthMode",
    enabledByDefault: true,
    description: "Hides all plugin buttons without disabling them. Shortcut: Ctrl+Shift+H. The toggle is in RAINCORD Settings.",
    authors: [{ name: "RAINCORD", id: 0n }],
    managedStyle: style,

    start() {
        syncStealthBodyClass();
    },

    stop() {
        document.body.classList.remove("RAINCORD-stealth");
    },
});
