// ---------------------------------------------------------------------------
// Главный процесс Electron.
// Поток запуска:
//   1. Проверяем лицензию (license.verifyOnStartup).
//   2. Если ok → грузим сайт (config.appUrl) в главное окно.
//   3. Иначе → показываем экран активации (activation.html). После успешной
//      активации перезагружаемся в сайт.
// ---------------------------------------------------------------------------

const { app, BrowserWindow, ipcMain, shell, dialog, Menu, globalShortcut } = require("electron");
const path = require("path");
const fs = require("fs");

const license = require("./license.js");

// Прод = упакованное приложение. В проде отключаем DevTools и инструменты
// разработчика (защита исходников от лёгкого копирования).
const IS_DEV = !app.isPackaged;

// Простое хранилище состояния окна (always-on-top, компактный режим).
const STATE_FILE = () => path.join(app.getPath("userData"), "win-state.json");
function readState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE(), "utf8")); } catch (_) { return {}; }
}
function writeState(patch) {
  try {
    const s = Object.assign(readState(), patch);
    fs.writeFileSync(STATE_FILE(), JSON.stringify(s));
  } catch (_) {}
}

let CONFIG = {};
try {
  CONFIG = JSON.parse(fs.readFileSync(path.join(__dirname, "config.json"), "utf8"));
} catch (_) {
  CONFIG = { appUrl: "https://rouletteanalyzer.app", offlineGraceDays: 7, recheckEveryHours: 24, windowWidth: 1280, windowHeight: 860 };
}

let win = null;

function createWindow() {
  const st = readState();
  win = new BrowserWindow({
    width: CONFIG.windowWidth || 1280,
    height: CONFIG.windowHeight || 860,
    // Компактное окно: минимум под мини-режим сайта (только сигнал крупно).
    minWidth: 300,
    minHeight: 380,
    backgroundColor: "#05070d",
    autoHideMenuBar: true,
    alwaysOnTop: !!st.alwaysOnTop,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      devTools: IS_DEV, // в проде DevTools отключены полностью
    },
  });

  if (st.alwaysOnTop) win.setAlwaysOnTop(true, "floating");

  // Внешние ссылки — в системном браузере, не внутри приложения.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(CONFIG.appUrl)) return { action: "allow" };
    shell.openExternal(url);
    return { action: "deny" };
  });

  // Защита: в проде блокируем горячие клавиши DevTools и контекстное меню.
  if (!IS_DEV) {
    win.webContents.on("before-input-event", (event, input) => {
      const k = (input.key || "").toLowerCase();
      const ctrlShift = input.control && input.shift;
      if (
        k === "f12" ||
        (ctrlShift && (k === "i" || k === "j" || k === "c")) ||
        (input.control && k === "u") // просмотр исходника
      ) {
        event.preventDefault();
      }
    });
    win.webContents.on("devtools-opened", () => { win.webContents.closeDevTools(); });
  }

  return win;
}

// Переключение «Поверх всех окон» + сохранение.
function toggleAlwaysOnTop() {
  if (!win) return;
  const on = !win.isAlwaysOnTop();
  win.setAlwaysOnTop(on, "floating");
  writeState({ alwaysOnTop: on });
  buildMenu(); // обновить галочку в меню
}

function loadActivation() {
  win.loadFile(path.join(__dirname, "activation.html"));
}

function loadApp() {
  win.loadURL(CONFIG.appUrl);
}

async function bootstrap() {
  createWindow();
  const status = await license.verifyOnStartup();
  if (status.state === "ok") {
    loadApp();
  } else {
    loadActivation();
    // Передадим экрану активации причину (для истёкших/сброшенных).
    win.webContents.once("did-finish-load", () => {
      win.webContents.send("activation:reason", status.state);
    });
  }
}

// --- IPC для экрана активации ----------------------------------------------
ipcMain.handle("license:activate", async (_evt, key) => {
  const r = await license.activate(key);
  return r;
});

ipcMain.handle("license:deviceInfo", async () => {
  return { deviceId: license.computeDeviceId(), label: license.deviceLabel() };
});

ipcMain.handle("license:continue", async () => {
  loadApp();
  return true;
});

ipcMain.handle("license:reset", async () => {
  license.reset();
  loadActivation();
  return true;
});

// Меню: вид (поверх всех окон, компактно), активация, обновления, справка.
function buildMenu() {
  const aot = win ? win.isAlwaysOnTop() : false;
  const fileSub = [
    { role: "reload", label: "Обновить" },
  ];
  // DevTools — только в dev-сборке (в проде скрыт для защиты).
  if (IS_DEV) fileSub.push({ role: "toggleDevTools", label: "Инструменты разработчика" });
  fileSub.push(
    { type: "separator" },
    {
      label: "Сбросить активацию (сменить ПК)",
      click: async () => {
        const res = await dialog.showMessageBox(win, {
          type: "warning",
          buttons: ["Отмена", "Сбросить"],
          defaultId: 0,
          cancelId: 0,
          message: "Сбросить активацию на этом ПК?",
          detail: "Код перестанет работать здесь. Чтобы перенести код на другой ПК, обратитесь к администратору для перепривязки.",
        });
        if (res.response === 1) {
          license.reset();
          loadActivation();
        }
      },
    },
    { type: "separator" },
    { role: "quit", label: "Выход" }
  );

  const template = [
    { label: "Файл", submenu: fileSub },
    {
      label: "Вид",
      submenu: [
        {
          label: "Поверх всех окон",
          type: "checkbox",
          checked: aot,
          accelerator: "CmdOrCtrl+Shift+T",
          click: toggleAlwaysOnTop,
        },
        {
          label: "Компактное окно",
          accelerator: "CmdOrCtrl+Shift+M",
          click: () => { if (win) win.setSize(340, 460); },
        },
        {
          label: "Обычный размер",
          click: () => { if (win) win.setSize(CONFIG.windowWidth || 1280, CONFIG.windowHeight || 860); },
        },
      ],
    },
    {
      label: "Обновления",
      submenu: [
        {
          label: "Проверить обновления",
          click: () => checkForUpdates(true),
        },
      ],
    },
    {
      label: "Справка",
      submenu: [
        {
          label: "О программе",
          click: () => {
            dialog.showMessageBox(win, {
              type: "info",
              message: "Roulette Analyzer",
              detail: `Версия ${app.getVersion()}\nОболочка сайта rouletteanalyzer.app.\nАктивация по коду с привязкой к ПК.`,
            });
          },
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// --- Автообновление (electron-updater, релизы на GitHub Releases) ------------
// Пакет подключается лениво: если не установлен, меню просто сообщит.
let autoUpdater = null;
function getUpdater() {
  if (autoUpdater) return autoUpdater;
  try {
    autoUpdater = require("electron-updater").autoUpdater;
    autoUpdater.autoDownload = true;
    autoUpdater.on("update-downloaded", async () => {
      const res = await dialog.showMessageBox(win, {
        type: "info",
        buttons: ["Позже", "Перезапустить и обновить"],
        defaultId: 1,
        message: "Обновление загружено",
        detail: "Новая версия готова к установке.",
      });
      if (res.response === 1) autoUpdater.quitAndInstall();
    });
  } catch (_) {
    autoUpdater = null;
  }
  return autoUpdater;
}

// verbose=true — показывать диалоги даже когда обновлений нет (ручная проверка).
async function checkForUpdates(verbose) {
  if (IS_DEV) {
    if (verbose) dialog.showMessageBox(win, { type: "info", message: "Обновления", detail: "Проверка обновлений доступна только в установленной версии." });
    return;
  }
  const u = getUpdater();
  if (!u) {
    if (verbose) dialog.showMessageBox(win, { type: "info", message: "Обновления", detail: "Модуль обновлений недоступен в этой сборке." });
    return;
  }
  try {
    const r = await u.checkForUpdates();
    if (verbose) {
      const cur = app.getVersion();
      const avail = r && r.updateInfo && r.updateInfo.version;
      if (!avail || avail === cur) {
        dialog.showMessageBox(win, { type: "info", message: "Обновлений нет", detail: `У вас актуальная версия ${cur}.` });
      }
      // если есть — загрузка пойдёт автоматически, дальше сработает update-downloaded.
    }
  } catch (e) {
    if (verbose) dialog.showMessageBox(win, { type: "warning", message: "Ошибка проверки", detail: String(e && e.message || e) });
  }
}

app.whenReady().then(() => {
  license.init(app.getPath("userData"), CONFIG);
  buildMenu();
  bootstrap();

  // Горячая клавиша «Поверх всех окон» (глобальная, работает даже вне фокуса).
  try { globalShortcut.register("CmdOrCtrl+Shift+T", toggleAlwaysOnTop); } catch (_) {}

  // Тихая автопроверка обновлений при старте (без диалогов, если всё актуально).
  setTimeout(() => checkForUpdates(false), 4000);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) bootstrap();
  });
});

app.on("will-quit", () => {
  try { globalShortcut.unregisterAll(); } catch (_) {}
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
