/*
 * RAINCORD — Updater utilities (renderer-side)
 * Wraps IPC calls para o main process (http.ts)
 */

import { Logger } from "./Logger";
import { IpcRes } from "./types";

export const UpdateLogger = /* #__PURE__ */ new Logger("Updater", "white");
export let isOutdated  = false;
export let isNewer     = false;
export let updateError: any;
export let changes: Record<"hash" | "author" | "message", string>[] = [];

async function Unwrap<T>(p: Promise<IpcRes<T>>): Promise<T> {
    const res = await p;
    if (res.ok) return res.value as T;
    updateError = res.error;
    throw res.error;
}

/**
 * Solicita ao main process se há uma versão mais recente.
 * Atualiza isOutdated e changes.
 */
export async function checkForUpdates(): Promise<boolean> {
    changes = await Unwrap(VencordNative.updater.getUpdates());
    return (isOutdated = changes.length > 0);
}

/**
 * Baixa o Setup.exe (etapa 1).
 * Retorna true se o download foi bem-sucedido.
 */
export async function update(): Promise<boolean> {
    if (!isOutdated) return true;
    const ok = await Unwrap(VencordNative.updater.update());
    if (ok) isOutdated = false;
    return ok;
}

/**
 * Executa o instalador baixado (etapa 2).
 * O app vai fechar e reiniciar automaticamente após a instalação.
 */
export async function rebuild(): Promise<boolean> {
    return Unwrap(VencordNative.updater.rebuild());
}

export const getRepo = () => Unwrap(VencordNative.updater.getRepo());

/**
 * Verifica atualizações na inicialização e propõe ao usuário atualizar.
 */
export async function maybePromptToUpdate(confirmMessage: string, checkForDev = false) {
    if (IS_WEB || IS_UPDATER_DISABLED) return;
    if (checkForDev && IS_DEV) return;

    try {
        const outdated = await checkForUpdates();
        if (outdated) {
            // Atualização automática sem confirmação
            const downloaded = await update();
            if (downloaded) await rebuild();
        }
    } catch (err) {
        UpdateLogger.error(err);
        alert("A verificação de atualizações falhou. Verifique sua conexão ou reinstale o RAINCORD.");
    }
}
