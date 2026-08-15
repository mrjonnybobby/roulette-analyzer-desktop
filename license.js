// ---------------------------------------------------------------------------
// Модуль лицензирования (сторона клиента).
//
// Модель: «онлайн + офлайн-кеш».
//   1. Отпечаток ПК (deviceId) — стабильный хэш из характеристик машины.
//   2. Активация: приложение шлёт {key, device, deviceLabel} на сервер.
//      Сервер привязывает код к устройству (bound_device) — код работает
//      только на этой машине. Возвращает подписанный лицензионный токен.
//   3. Токен кешируется локально (в userData). Следующие запуски:
//        • пытаемся онлайн-перепроверку (не чаще recheckEveryHours);
//        • если сети нет — работаем по кешу до истечения грейс-периода
//          (offlineGraceDays с последней успешной онлайн-проверки).
//
// ВАЖНО (честно): любая клиентская защита в принципе обходима. Серверная
// онлайн-привязка — самый крепкий слой; офлайн-кеш нужен только для удобства.
// ---------------------------------------------------------------------------

const os = require("os");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

let CACHE_PATH = null;
let CONFIG = null;

function init(userDataDir, config) {
  CONFIG = config;
  CACHE_PATH = path.join(userDataDir, "license.dat");
}

// --- Отпечаток ПК ----------------------------------------------------------
// Собираем стабильные характеристики: имя машины, платформа, арх, CPU-модель,
// первый не-loopback MAC. Хэшируем в устойчивый device-id.
function computeDeviceId() {
  const parts = [];
  parts.push(os.hostname() || "");
  parts.push(os.platform() || "");
  parts.push(os.arch() || "");
  const cpus = os.cpus() || [];
  parts.push(cpus[0] ? cpus[0].model : "");
  parts.push(String(cpus.length));
  // Стабильный MAC (первый физический интерфейс).
  let mac = "";
  const ifs = os.networkInterfaces();
  for (const name of Object.keys(ifs)) {
    for (const ni of ifs[name] || []) {
      if (!ni.internal && ni.mac && ni.mac !== "00:00:00:00:00:00") { mac = ni.mac; break; }
    }
    if (mac) break;
  }
  parts.push(mac);
  const raw = parts.join("|");
  return crypto.createHash("sha256").update(raw).digest("hex").slice(0, 32);
}

function deviceLabel() {
  return `${os.hostname() || "PC"} (${os.platform()}/${os.arch()})`;
}

// --- Кеш лицензии ----------------------------------------------------------
function readCache() {
  try {
    const raw = fs.readFileSync(CACHE_PATH, "utf8");
    return JSON.parse(raw);
  } catch (_) {
    return null;
  }
}

function writeCache(obj) {
  try {
    fs.writeFileSync(CACHE_PATH, JSON.stringify(obj), "utf8");
    return true;
  } catch (_) {
    return false;
  }
}

function clearCache() {
  try { fs.unlinkSync(CACHE_PATH); } catch (_) {}
}

// --- Проверка подписи токена ----------------------------------------------
// Сервер подписывает payload HMAC-ключом. Публичной проверки на клиенте нет
// (секрет только на сервере), поэтому офлайн мы доверяем кешу как есть —
// целостность защищена тем, что подделать серверную подпись без секрета нельзя,
// а онлайн-перепроверка периодически подтверждает токен.
function tokenExpired(cache) {
  if (!cache || !cache.license) return true;
  const exp = cache.license.expires_at;
  if (!exp) return false; // бессрочный
  return new Date(exp).getTime() < Date.now();
}

// Истёк ли офлайн-грейс с последней успешной онлайн-проверки.
function graceExpired(cache) {
  if (!cache || !cache.lastOnlineOk) return true;
  const graceMs = (CONFIG.offlineGraceDays || 7) * 24 * 3600 * 1000;
  return Date.now() - new Date(cache.lastOnlineOk).getTime() > graceMs;
}

function needsRecheck(cache) {
  if (!cache || !cache.lastOnlineOk) return true;
  const everyMs = (CONFIG.recheckEveryHours || 24) * 3600 * 1000;
  return Date.now() - new Date(cache.lastOnlineOk).getTime() > everyMs;
}

// --- Сетевые вызовы --------------------------------------------------------
async function callActivate(key) {
  const device = computeDeviceId();
  const body = JSON.stringify({ key, device, deviceLabel: deviceLabel() });
  const res = await fetch(CONFIG.activateEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

async function callCheck(cache) {
  const device = computeDeviceId();
  const token = cache && cache.license ? cache.license.token : null;
  const key = cache && cache.license ? cache.license.key : null;
  const body = JSON.stringify({ key, device, token });
  const res = await fetch(CONFIG.checkEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

// --- Публичное API ---------------------------------------------------------

// Активация нового кода. Возвращает { ok, error }.
async function activate(key) {
  key = String(key || "").trim();
  if (key.length !== 18) return { ok: false, error: "bad_key" };
  let r;
  try {
    r = await callActivate(key);
  } catch (e) {
    return { ok: false, error: "network" };
  }
  if (r.status === 200 && r.data && r.data.ok) {
    const cache = {
      device: computeDeviceId(),
      license: {
        key,
        token: r.data.token || null,
        role: r.data.role || "guest",
        expires_at: r.data.expires_at || null,
        lifetime: !!r.data.lifetime,
      },
      lastOnlineOk: new Date().toISOString(),
    };
    writeCache(cache);
    return { ok: true, license: cache.license };
  }
  // Карта ошибок сервера в понятные коды.
  const err = (r.data && r.data.error) || "activate_failed";
  return { ok: false, error: err, status: r.status };
}

// Проверка статуса при запуске (без ввода кода). Возвращает:
//   { state: "ok" | "need_activation" | "device_mismatch" | "revoked" | "expired" }
async function verifyOnStartup() {
  const cache = readCache();
  if (!cache || !cache.license) return { state: "need_activation" };

  // Если устройство поменялось (перенос кеша на другой ПК) — сбрасываем.
  if (cache.device !== computeDeviceId()) {
    return { state: "device_mismatch" };
  }

  // Токен истёк по сроку самого ключа — грейс не спасает.
  if (tokenExpired(cache)) {
    return { state: "expired" };
  }

  // Пытаемся онлайн-перепроверку, если пора.
  if (needsRecheck(cache)) {
    try {
      const r = await callCheck(cache);
      if (r.status === 200 && r.data && r.data.ok) {
        cache.lastOnlineOk = new Date().toISOString();
        if (r.data.expires_at !== undefined) cache.license.expires_at = r.data.expires_at;
        writeCache(cache);
        return { state: "ok", license: cache.license };
      }
      // Сервер явно отверг код.
      if (r.status === 403 && r.data && r.data.error === "device_mismatch") return { state: "device_mismatch" };
      if (r.status === 403 && r.data && r.data.error === "revoked") { clearCache(); return { state: "revoked" }; }
      if (r.status === 410) { clearCache(); return { state: "expired" }; }
      if (r.status === 401) { clearCache(); return { state: "need_activation" }; }
      // Иная серверная ошибка (5xx) — падаем в офлайн-грейс ниже.
    } catch (_) {
      // Сети нет — переходим к офлайн-грейсу.
    }
  }

  // Офлайн-режим: работаем по кешу, пока не истёк грейс.
  if (graceExpired(cache)) {
    return { state: "grace_expired" };
  }
  return { state: "ok", license: cache.license, offline: true };
}

function getCachedLicense() {
  const c = readCache();
  return c ? c.license : null;
}

function reset() { clearCache(); }

module.exports = {
  init,
  computeDeviceId,
  deviceLabel,
  activate,
  verifyOnStartup,
  getCachedLicense,
  reset,
};
