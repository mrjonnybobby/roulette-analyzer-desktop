// Безопасный мост между экраном активации и главным процессом.
// Сайт (appUrl) НЕ получает доступ к этим API — они нужны только activation.html.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("licenseAPI", {
  activate: (key) => ipcRenderer.invoke("license:activate", key),
  deviceInfo: () => ipcRenderer.invoke("license:deviceInfo"),
  continueToApp: () => ipcRenderer.invoke("license:continue"),
  reset: () => ipcRenderer.invoke("license:reset"),
  onReason: (cb) => ipcRenderer.on("activation:reason", (_e, reason) => cb(reason)),
});
