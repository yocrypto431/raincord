/*
 * Vencord, a modification for Discord's desktop app
 * Copyright (c) 2022 Vendicated and contributors
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/

import { downloadSettingsBackup, uploadSettingsBackup } from "@api/SettingsSync/offline";
import { Button } from "@components/Button";
import { Divider } from "@components/Divider";
import { Flex } from "@components/Flex";
import { Heading } from "@components/Heading";
import { Notice } from "@components/Notice";
import { Paragraph } from "@components/Paragraph";
import { SettingsTab, wrapTab } from "@components/settings/tabs/BaseTab";
import { Margins } from "@utils/margins";
import { PluginNative } from "@utils/types";
import { React, Toasts, useEffect, useState } from "@webpack/common";

interface DetectedInstallation {
    id: string;
    name: string;
    path: string;
    hasSettings: boolean;
    hasQuickCss: boolean;
    themeCount: number;
    pluginCount: number;
}

interface MigrationResult {
    ok: boolean;
    pluginsImported: number;
    quickCssBytes: number;
    themesImported: string[];
    error?: string;
}

interface PerClientChoice {
    importSettings: boolean;
    importQuickCss: boolean;
    importThemes: boolean;
    quickCssMode: "replace" | "append";
}

const MigrateNative = (VencordNative as any)?.pluginHelpers?.MigrateFromOtherClients as PluginNative<typeof import("../../../../raincordplugins/migrateFromOtherClients/native")> | undefined;

function MigrateSection() {
    const [installations, setInstallations] = useState<DetectedInstallation[] | null>(null);
    const [choices, setChoices] = useState<Record<string, PerClientChoice>>({});
    const [busy, setBusy] = useState<string | null>(null);
    const [results, setResults] = useState<Record<string, MigrationResult>>({});
    const [expanded, setExpanded] = useState(false);

    async function refresh() {
        if (!MigrateNative) return;
        setInstallations(null);
        try {
            const list = await MigrateNative.detectInstallations();
            setInstallations(list);
            const next: Record<string, PerClientChoice> = {};
            for (const inst of list) {
                next[inst.id] = {
                    importSettings: inst.hasSettings,
                    importQuickCss: inst.hasQuickCss,
                    importThemes: inst.themeCount > 0,
                    quickCssMode: "append",
                };
            }
            setChoices(next);
        } catch (e: any) {
            Toasts.show({
                message: `Erro ao buscar instalações: ${String(e?.message ?? e)}`,
                type: Toasts.Type.FAILURE,
                id: Toasts.genId(),
            });
            setInstallations([]);
        }
    }

    useEffect(() => {
        if (expanded) void refresh();
    }, [expanded]);

    async function migrate(inst: DetectedInstallation) {
        if (!MigrateNative) return;
        const choice = choices[inst.id];
        if (!choice) return;
        if (!choice.importSettings && !choice.importQuickCss && !choice.importThemes) {
            Toasts.show({
                message: "Selecione ao menos uma opção para migrar",
                type: Toasts.Type.MESSAGE,
                id: Toasts.genId(),
            });
            return;
        }
        setBusy(inst.id);
        try {
            const result = await MigrateNative.applyMigration({
                sourcePath: inst.path,
                importSettings: choice.importSettings,
                importQuickCss: choice.importQuickCss,
                importThemes: choice.importThemes,
                quickCssMode: choice.quickCssMode,
            });
            setResults(prev => ({ ...prev, [inst.id]: result }));
            if (result.ok) {
                Toasts.show({
                    message: `Migrado de ${inst.name}: ${result.pluginsImported} plugins, ${result.themesImported.length} temas. Reinicie o Discord.`,
                    type: Toasts.Type.SUCCESS,
                    id: Toasts.genId(),
                });
            } else {
                Toasts.show({
                    message: `Falha na migração: ${result.error ?? "erro desconhecido"}`,
                    type: Toasts.Type.FAILURE,
                    id: Toasts.genId(),
                });
            }
        } catch (e: any) {
            Toasts.show({
                message: `Erro: ${String(e?.message ?? e)}`,
                type: Toasts.Type.FAILURE,
                id: Toasts.genId(),
            });
        } finally {
            setBusy(null);
        }
    }

    function setChoice(id: string, patch: Partial<PerClientChoice>) {
        setChoices(prev => ({ ...prev, [id]: { ...prev[id], ...patch } }));
    }

    if (!MigrateNative) {
        return (
            <Notice.Warning className={Margins.bottom20}>
                Backend de migração indisponível. Reinstale o RAINCORD.
            </Notice.Warning>
        );
    }

    return (
        <>
            <Heading>Migrate from other clients</Heading>
            <Paragraph className={Margins.bottom16}>
                Importe settings de plugins, QuickCSS e temas de outros mods do Discord
                (Vencord, Equicord, Plexcord, Suncord, Shelter) para o RAINCORD. Suas
                configurações atuais recebem um backup <code>.bak</code> antes de
                qualquer alteração.
            </Paragraph>

            {!expanded ? (
                <Flex gap="8px" className={Margins.bottom20} style={{ flexWrap: "wrap" }}>
                    <Button
                        onClick={() => setExpanded(true)}
                        size="small"
                        variant="secondary"
                    >
                        Procurar outros clientes
                    </Button>
                </Flex>
            ) : installations === null ? (
                <Paragraph className={Margins.bottom20} style={{ color: "var(--text-muted)" }}>
                    Procurando instalações...
                </Paragraph>
            ) : installations.length === 0 ? (
                <>
                    <Notice.Note className={Margins.bottom16}>
                        Nenhuma instalação Vencord/Equicord/Plexcord/Suncord/Shelter encontrada nos diretórios padrão.
                    </Notice.Note>
                    <Flex gap="8px" className={Margins.bottom20} style={{ flexWrap: "wrap" }}>
                        <Button onClick={() => void refresh()} size="small" variant="secondary">
                            Procurar de novo
                        </Button>
                    </Flex>
                </>
            ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 20 }}>
                    {installations.map(inst => {
                        const choice = choices[inst.id] ?? { importSettings: true, importQuickCss: true, importThemes: true, quickCssMode: "append" as const };
                        const result = results[inst.id];
                        const isBusy = busy === inst.id;
                        return (
                            <div
                                key={inst.id}
                                style={{
                                    background: "var(--background-secondary)",
                                    border: "1px solid var(--background-tertiary)",
                                    borderRadius: 8,
                                    padding: 14,
                                    display: "flex",
                                    flexDirection: "column",
                                    gap: 10,
                                }}
                            >
                                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                                    <div style={{ fontWeight: 700, fontSize: 16, color: "var(--header-primary)" }}>{inst.name}</div>
                                    <div style={{ fontSize: 12, color: "var(--text-muted)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{inst.path}</div>
                                </div>
                                <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
                                    <label style={{ display: "flex", alignItems: "center", gap: 6, color: inst.hasSettings ? "var(--text-normal)" : "var(--text-muted)" }}>
                                        <input
                                            type="checkbox"
                                            checked={choice.importSettings}
                                            disabled={!inst.hasSettings || isBusy}
                                            onChange={e => setChoice(inst.id, { importSettings: e.currentTarget.checked })}
                                        />
                                        Settings ({inst.pluginCount} plugins)
                                    </label>
                                    <label style={{ display: "flex", alignItems: "center", gap: 6, color: inst.hasQuickCss ? "var(--text-normal)" : "var(--text-muted)" }}>
                                        <input
                                            type="checkbox"
                                            checked={choice.importQuickCss}
                                            disabled={!inst.hasQuickCss || isBusy}
                                            onChange={e => setChoice(inst.id, { importQuickCss: e.currentTarget.checked })}
                                        />
                                        QuickCSS
                                    </label>
                                    <label style={{ display: "flex", alignItems: "center", gap: 6, color: inst.themeCount > 0 ? "var(--text-normal)" : "var(--text-muted)" }}>
                                        <input
                                            type="checkbox"
                                            checked={choice.importThemes}
                                            disabled={inst.themeCount === 0 || isBusy}
                                            onChange={e => setChoice(inst.id, { importThemes: e.currentTarget.checked })}
                                        />
                                        Themes ({inst.themeCount})
                                    </label>
                                </div>
                                {choice.importQuickCss && inst.hasQuickCss ? (
                                    <div style={{ display: "flex", gap: 12, fontSize: 12, color: "var(--text-muted)" }}>
                                        <span>QuickCSS:</span>
                                        <label style={{ display: "flex", alignItems: "center", gap: 4 }}>
                                            <input
                                                type="radio"
                                                name={`qcssmode-${inst.id}`}
                                                checked={choice.quickCssMode === "append"}
                                                disabled={isBusy}
                                                onChange={() => setChoice(inst.id, { quickCssMode: "append" })}
                                            />
                                            Anexar ao atual
                                        </label>
                                        <label style={{ display: "flex", alignItems: "center", gap: 4 }}>
                                            <input
                                                type="radio"
                                                name={`qcssmode-${inst.id}`}
                                                checked={choice.quickCssMode === "replace"}
                                                disabled={isBusy}
                                                onChange={() => setChoice(inst.id, { quickCssMode: "replace" })}
                                            />
                                            Substituir
                                        </label>
                                    </div>
                                ) : null}
                                <Flex gap="8px" style={{ alignItems: "center", flexWrap: "wrap" }}>
                                    <Button
                                        size="small"
                                        variant="primary"
                                        disabled={isBusy}
                                        onClick={() => void migrate(inst)}
                                    >
                                        {isBusy ? "Migrando..." : `Migrar de ${inst.name}`}
                                    </Button>
                                    {result?.ok ? (
                                        <span style={{ fontSize: 12, color: "var(--text-positive)" }}>
                                            ✓ {result.pluginsImported} plugins · {result.themesImported.length} temas · {(result.quickCssBytes / 1024).toFixed(1)}kb CSS
                                        </span>
                                    ) : result?.error ? (
                                        <span style={{ fontSize: 12, color: "var(--text-danger)" }}>✗ {result.error}</span>
                                    ) : null}
                                </Flex>
                            </div>
                        );
                    })}
                    <Flex gap="8px" style={{ justifyContent: "flex-end" }}>
                        <Button size="small" variant="secondary" onClick={() => void refresh()}>
                            Procurar de novo
                        </Button>
                    </Flex>
                </div>
            )}
        </>
    );
}

function BackupAndRestoreTab() {
    return (
        <SettingsTab>
            <Heading className={Margins.top16}>Backup & Restore</Heading>
            <Paragraph className={Margins.bottom20}>
                Import and export your RainCord settings as a JSON file. This allows you to easily transfer your settings to another device, or recover them after reinstalling RainCord or Discord.
            </Paragraph>

            <Notice.Warning className={Margins.bottom20}>
                Importing a settings file will overwrite your current settings. Make sure to export a backup first if you want to keep your current configuration.
            </Notice.Warning>

            <Heading>What's included in a backup</Heading>
            <Paragraph className={Margins.bottom20}>
                • Custom QuickCSS<br />
                • Theme Links<br />
                • Plugin Settings<br />
                • DataStore Data
            </Paragraph>

            <Divider className={Margins.bottom20} />

            <Heading>Import Settings</Heading>
            <Paragraph className={Margins.bottom16}>
                Select a previously exported settings file to restore your configuration. This will replace all your current settings with the ones from the backup.
            </Paragraph>

            <Flex gap="8px" className={Margins.bottom20} style={{ flexWrap: "wrap" }}>
                <Button
                    onClick={() => uploadSettingsBackup("all")}
                    size="small"
                    variant="secondary"
                >
                    Import All Settings
                </Button>
                <Button
                    onClick={() => uploadSettingsBackup("css")}
                    size="small"
                >
                    Import QuickCSS
                </Button>
                <Button
                    onClick={() => uploadSettingsBackup("datastore")}
                    size="small"
                >
                    Import DataStore
                </Button>
            </Flex>

            <Divider className={Margins.bottom20} />

            <Heading>Export Settings</Heading>
            <Paragraph className={Margins.bottom16}>
                Download your current settings as a backup file. You can export everything at once, or choose to export only specific parts of your configuration.
            </Paragraph>

            <Flex gap="8px" className={Margins.bottom20} style={{ flexWrap: "wrap" }}>
                <Button
                    onClick={() => downloadSettingsBackup("all")}
                    size="small"
                    variant="secondary"
                >
                    Export All Settings
                </Button>
                <Button
                    onClick={() => downloadSettingsBackup("plugins")}
                    size="small"
                >
                    Export Plugins
                </Button>
                <Button
                    onClick={() => downloadSettingsBackup("css")}
                    size="small"
                >
                    Export QuickCSS
                </Button>
                <Button
                    onClick={() => downloadSettingsBackup("datastore")}
                    size="small"
                >
                    Export DataStore
                </Button>
            </Flex>

            <Divider className={Margins.bottom20} />

            <MigrateSection />
        </SettingsTab>
    );
}

export default wrapTab(BackupAndRestoreTab, "Backup & Restore");
