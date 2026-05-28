/*
 * Equicord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * groqManager.ts — Gerenciador de chave Groq compartilhado entre os plugins
 *
 * Funcionalidades:
 * - Chave API armazenada no DataStore (um único lugar)
 * - Rotação automática de modelo em 429 (rate limit)
 *   llama-3.3-70b-versatile → llama-3.1-8b-instant → gemma2-9b-it
 * - Retry com backoff exponencial
 * - Fila de espera para evitar bursts simultâneos
 */

import { DataStore } from "@api/index";

// ── Chaves DataStore ─────────────────────────────────────────────────────────────

const DS_API_KEY = "groq-shared-api-key";

// Modelos em ordem de fallback (limites separados no Groq)
const GROQ_MODELS = [
    "llama-3.3-70b-versatile",    // O melhor — quota RPM: 30/min
    "llama3-70b-8192",            // Antigo estável performante
    "llama-3.1-8b-instant",       // Rápido — quota RPM: 30/min SEPARADO
    "gemma2-9b-it",               // Fallback — quota RPM: 30/min SEPARADO
];

// Índice do modelo atualmente utilizado (apenas em memória)
let currentModelIdx = 0;
// Tempo de cooldown por modelo (timestamp ms)
const modelCooldown: Record<string, number> = {};

// ── Leitura/escrita chave API ──────────────────────────────────────────────────

// Fallback settings importados dinamicamente para evitar imports circulares
let _settingsFallback: (() => string) | null = null;
export function registerSettingsFallback(fn: () => string) {
    _settingsFallback = fn;
}

export async function getGroqKey(): Promise<string> {
    const key = await DataStore.get(DS_API_KEY) as string | null;
    if (key?.trim()) return key.trim();
    // Fallback : ler dos Settings raincordAI se disponível
    if (_settingsFallback) {
        const fallback = _settingsFallback();
        if (fallback) return fallback;
    }
    return "";
}

export async function setGroqKey(key: string): Promise<void> {
    await DataStore.set(DS_API_KEY, key.trim());
}

// ── Seleção do modelo disponível ────────────────────────────────────────────

function getAvailableModel(): string {
    const now = Date.now();
    // Tentar primeiro o modelo atual
    for (let i = 0; i < GROQ_MODELS.length; i++) {
        const idx = (currentModelIdx + i) % GROQ_MODELS.length;
        const model = GROQ_MODELS[idx];
        const cooldownUntil = modelCooldown[model] ?? 0;
        if (now >= cooldownUntil) {
            currentModelIdx = idx;
            return model;
        }
    }
    // Todos em cooldown → esperar o menor tempo
    let minCooldown = Infinity;
    let bestIdx = 0;
    for (let i = 0; i < GROQ_MODELS.length; i++) {
        const cd = modelCooldown[GROQ_MODELS[i]] ?? 0;
        if (cd < minCooldown) { minCooldown = cd; bestIdx = i; }
    }
    currentModelIdx = bestIdx;
    return GROQ_MODELS[bestIdx];
}

function markModelRateLimited(model: string, retryAfterMs = 60_000): void {
    modelCooldown[model] = Date.now() + retryAfterMs;
    console.warn(`[GroqManager] Modelo ${model} em cooldown por ${retryAfterMs / 1000}s`);
    // Passar para o próximo modelo disponível
    currentModelIdx = (currentModelIdx + 1) % GROQ_MODELS.length;
}

// ── Fila de espera leve ─────────────────────────────────────────────────────

let queue = Promise.resolve();
const MIN_DELAY_MS = 200; // pelo menos 200ms entre duas requisições

function enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const result = queue.then(() => fn());
    queue = result.then(
        () => new Promise(r => setTimeout(r, MIN_DELAY_MS)),
        () => new Promise(r => setTimeout(r, MIN_DELAY_MS)),
    );
    return result;
}

// ── Chamada API principal ───────────────────────────────────────────────────────

export interface GroqChatMessage {
    role: "system" | "user" | "assistant";
    content: string | any[];
}

export interface GroqCallOptions {
    messages: GroqChatMessage[];
    temperature?: number;
    maxTokens?: number;
    /** Forçar um modelo específico (opcional) */
    forceModel?: string;
    /** Número máximo de retries em 429 (padrão: 3) */
    maxRetries?: number;
}

/**
 * Chama a API Groq com rotação automática de modelo em rate limit.
 * Retorna o conteúdo texto da resposta.
 */
export async function groqChat(opts: GroqCallOptions): Promise<string> {
    return enqueue(() => _groqChat(opts));
}

async function _groqChat(opts: GroqCallOptions, attempt = 0): Promise<string> {
    const { messages, temperature = 0.7, maxTokens = 1000, forceModel, maxRetries = 3 } = opts;

    const apiKey = await getGroqKey();
    if (!apiKey) throw new Error("Chave API Groq ausente — configure-a em Settings → raincordAI");

    const model = forceModel ?? getAvailableModel();

    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
            model,
            temperature,
            max_tokens: maxTokens,
            messages,
        }),
    });

    // Gerenciamento do rate limit
    if (res.status === 429) {
        if (attempt >= maxRetries) throw new Error("Rate limit Groq — tente novamente em alguns instantes");

        // Ler o header Retry-After se presente
        const retryAfterSec = parseInt(res.headers.get("retry-after") ?? "60", 10);
        const retryAfterMs = (isNaN(retryAfterSec) ? 60 : retryAfterSec) * 1000;

        markModelRateLimited(model, retryAfterMs);

        // Retry imediato com o próximo modelo (sem wait aqui)
        return _groqChat({ ...opts, forceModel: undefined }, attempt + 1);
    }

    if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`Groq API ${res.status}: ${body.slice(0, 200)}`);
    }

    const data = await res.json();
    return data.choices?.[0]?.message?.content?.trim() ?? "(resposta vazia)";
}

/**
 * Retorna o modelo atualmente ativo (útil para exibição)
 */
export function getCurrentModel(): string {
    return GROQ_MODELS[currentModelIdx] ?? GROQ_MODELS[0];
}
