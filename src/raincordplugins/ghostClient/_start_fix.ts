
        setTimeout(() => {
            Native.init().catch(() => { });

            (async () => {
                if (savedAccounts.length === 0) return;
                console.log("[GhostClient] Pré-conexão de", savedAccounts.length, "account(s)...");
                for (const acc of savedAccounts) {
                    Native.preConnectGhost(acc.userId, acc.token, ghostMicLabel)
                        .then(r => console.log("[GhostClient] Pré-conectado:", acc.username, r?.ok))
                        .catch(() => { });
                    // FIX CRASH SCROLL DM: atraso aumentado de 800ms → 2000ms
                    // A pré-conexão em massa (20+ contas × 800ms) saturava o renderer
                    // exatamente na janela em que o usuário faz scroll nos DMs.
                    // Cada preConnectGhost dispara eventos IPC que forçam re-renders
                    // React → removeChild crash na lista virtualizada dos DMs.
                    // 2000ms entre cada conexão espaça suficientemente a carga.
                    await new Promise(r => setTimeout(r, 2000));
                }
            })();
        }, 30000); // FIX: atraso inicial 10s → 30s para deixar a UI estabilizar na inicialização
