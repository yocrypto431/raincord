// RainCord 04a14ca07898366610b266109cfb1c026e2eccba
// Standalone: false
// Platform: win32
// Updater Disabled: false
"use strict";function l(e,t=300){let r;return function(...s){clearTimeout(r),r=setTimeout(()=>{e(...s)},t)}}var i=require("electron/renderer");var n=require("electron/renderer");function o(e,...t){return n.ipcRenderer.invoke(e,...t)}function d(e,...t){return n.ipcRenderer.sendSync(e,...t)}var R={},u=d("VencordGetPluginIpcMethodMap");for(let[e,t]of Object.entries(u)){let r=R[e]={};for(let[s,_]of Object.entries(t))r[s]=(...T)=>o(_,...T)}var a={themes:{uploadTheme:async(e,t)=>{throw new Error("uploadTheme is WEB only")},deleteTheme:e=>o("VencordDeleteTheme",e),getThemesDir:()=>o("VencordGetThemesDir"),getThemesList:()=>o("VencordGetThemesList"),getThemeData:e=>o("VencordGetThemeData",e),getSystemValues:()=>o("VencordGetThemeSystemValues"),openFolder:()=>o("VencordOpenThemesFolder")},updater:{getUpdates:()=>o("VencordGetUpdates"),update:()=>o("VencordUpdate"),rebuild:()=>o("VencordBuild"),getRepo:()=>o("VencordGetRepo"),downloadAndRun:e=>o("RAINCORDDownloadAndRun",e)},settings:{get:()=>d("VencordGetSettings"),set:(e,t)=>o("VencordSetSettings",e,t),getSettingsDir:()=>o("VencordGetSettingsDir"),openFolder:()=>o("VencordOpenSettingsFolder")},quickCss:{get:()=>o("VencordGetQuickCss"),set:e=>o("VencordSetQuickCss",e),addChangeListener(e){n.ipcRenderer.on("VencordQuickCssUpdate",(t,r)=>e(r))},addThemeChangeListener(e){n.ipcRenderer.on("VencordThemeUpdate",()=>e())},openFile:()=>o("VencordOpenQuickCss"),openEditor:()=>o("VencordOpenMonacoEditor"),getEditorTheme:()=>d("VencordGetMonacoTheme")},native:{getVersions:()=>process.versions,openExternal:e=>o("VencordOpenExternal",e),getRendererCss:()=>o("VencordGetRendererCss"),onRendererCssUpdate:e=>{}},csp:{isDomainAllowed:(e,t)=>o("VencordCspIsDomainAllowed",e,t),removeOverride:e=>o("VencordCspRemoveOverride",e),requestAddOverride:(e,t,r)=>o("VencordCspRequestAddOverride",e,t,r)},tray:{setUpdateState:e=>n.ipcRenderer.send("VencordSetTrayUpdateState",e),onCheckUpdates:e=>{n.ipcRenderer.on("VencordTrayCheckUpdates",e)},onRepair:e=>{n.ipcRenderer.on("VencordTrayRepair",e)}},desktopCapture:{getSources:()=>o("VencordGetDesktopSources")},RAINCORD:{checkVBCable:()=>o("RAINCORDCheckVBCable"),installVBCable:()=>o("RAINCORDInstallVBCable"),importPlugins:e=>o("RAINCORDImportPlugins",e),relaunch:()=>o("RAINCORDRelaunchApp")},pluginHelpers:R,window:{setBackgroundMaterial:e=>o("RAINCORDSetWindowBackgroundMaterial",e),setThumbarButtons:e=>o("SoundCordSetThumbarButtons",e),onThumbarClick:e=>{n.ipcRenderer.on("SoundCordThumbarButtonClick",(t,r)=>e(r))},removeThumbarClickListener:()=>{n.ipcRenderer.removeAllListeners("SoundCordThumbarButtonClick")}},worldBomb:{type:(e,t)=>o("WorldBombType",e,t),pressEnter:()=>o("WorldBombPressEnter"),pressBackspace:()=>o("WorldBombPressBackspace"),sequence:(e,t,r,s=-1,_=-1)=>o("WorldBombSequence",e,t,r,s,_),openWindow:(e,t,r,s,_,T,O)=>o("WorldBombOpenWindow",e,t,r,s,_,T,O),getCursorPos:()=>o("WorldBombGetCursorPos")},keyboardSounds:{startGlobalHook:()=>o("KeyboardSoundsStartGlobal"),stopGlobalHook:()=>o("KeyboardSoundsStopGlobal"),onGlobalKeyDown:e=>{n.ipcRenderer.on("GlobalKeyDown",(t,r)=>e(r))},removeGlobalKeyDownListener:()=>{n.ipcRenderer.removeAllListeners("GlobalKeyDown")}}};i.contextBridge.exposeInMainWorld("VencordNative",a);location.protocol!=="data:"?(o("VencordInitFileWatchers"),i.webFrame.executeJavaScript(`
            window.addEventListener('unhandledrejection', function(event) {
                const reason = event.reason;
                if (reason && (
                    (reason.name === 'AbortError') ||
                    (reason instanceof DOMException && reason.name === 'AbortError') ||
                    (typeof reason.message === 'string' && reason.message.includes('play() request was interrupted'))
                )) {
                    event.preventDefault();
                }
            });
        `),i.webFrame.executeJavaScript(d("VencordPreloadGetRendererJs")),require(process.env.DISCORD_PRELOAD),i.webFrame.executeJavaScript(`
            (function() {
                function patchTitle(t) {
                    return t ? t.replace(/Discord/g, 'RAINCORD') : t;
                }
                // Patch initial
                if (document.title) document.title = patchTitle(document.title);
                // Observe les changements futurs
                const titleEl = document.querySelector('title');
                if (titleEl) {
                    new MutationObserver(() => {
                        const cur = document.title;
                        const patched = patchTitle(cur);
                        if (cur !== patched) document.title = patched;
                    }).observe(titleEl, { childList: true });
                } else {
                    // Si <title> n'existe pas encore, attend le DOM
                    new MutationObserver((_, obs) => {
                        const el = document.querySelector('title');
                        if (!el) return;
                        obs.disconnect();
                        if (document.title) document.title = patchTitle(document.title);
                        new MutationObserver(() => {
                            const cur = document.title;
                            const patched = patchTitle(cur);
                            if (cur !== patched) document.title = patched;
                        }).observe(el, { childList: true });
                    }).observe(document.documentElement || document, { childList: true, subtree: true });
                }
            })()
        `)):(i.contextBridge.exposeInMainWorld("setCss",l(a.quickCss.set)),i.contextBridge.exposeInMainWorld("getCurrentCss",a.quickCss.get),i.contextBridge.exposeInMainWorld("getTheme",a.quickCss.getEditorTheme));
//# sourceURL=file:///VencordPreload
//# sourceMappingURL=vencord://preload.js.map
