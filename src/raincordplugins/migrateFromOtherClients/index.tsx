import definePlugin from "@utils/types";

export default definePlugin({
    name: "MigrateFromOtherClients",
    description: "Backend para migrar settings de plugins, QuickCSS e temas de outros mods do Discord (Vencord, Equicord, Plexcord, Suncord, Shelter). UI fica em Backup & Restore.",
    authors: [{ name: "RAINCORD", id: 0n }],
    required: true,
});
