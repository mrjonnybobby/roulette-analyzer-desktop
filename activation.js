// Логика экрана активации. Общается с главным процессом через window.licenseAPI.

const $ = (id) => document.getElementById(id);

const REASONS = {
  device_mismatch: "Код был активирован на другом компьютере. Введите код заново для этого ПК или обратитесь к администратору для перепривязки.",
  expired: "Срок действия кода истёк. Введите новый код.",
  revoked: "Код был отозван администратором.",
  grace_expired: "Истёк офлайн-период. Подключитесь к интернету для повторной проверки лицензии.",
  need_activation: null,
};

const ERRORS = {
  bad_key: "Код должен содержать ровно 18 символов.",
  invalid_key: "Код не найден. Проверьте правильность ввода.",
  revoked: "Этот код отозван администратором.",
  expired: "Срок действия кода истёк.",
  device_mismatch: "Этот код уже привязан к другому компьютеру. Обратитесь к администратору для перепривязки.",
  network: "Нет связи с сервером. Проверьте интернет-соединение и попробуйте снова.",
  activate_failed: "Не удалось активировать код. Попробуйте позже.",
  too_many_attempts: "Слишком много попыток. Подождите несколько минут.",
};

function showMsg(text, kind) {
  const el = $("msg");
  el.textContent = text;
  el.className = "msg " + (kind || "");
  el.hidden = false;
}

async function loadDevice() {
  try {
    const info = await window.licenseAPI.deviceInfo();
    $("deviceLabel").textContent = info.label || "—";
    $("deviceId").textContent = "ID: " + (info.deviceId || "");
  } catch (_) {}
}

window.licenseAPI.onReason((reason) => {
  const text = REASONS[reason];
  if (text) {
    const box = $("reasonBox");
    box.textContent = text;
    box.hidden = false;
  }
});

$("form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const key = $("key").value.trim();
  const btn = $("btn");
  $("msg").hidden = true;

  if (key.length !== 18) {
    showMsg(ERRORS.bad_key, "error");
    return;
  }

  btn.disabled = true;
  btn.textContent = "Проверка…";

  const r = await window.licenseAPI.activate(key);

  if (r.ok) {
    showMsg("Код активирован. Запускаю приложение…", "ok");
    setTimeout(() => window.licenseAPI.continueToApp(), 900);
    return;
  }

  btn.disabled = false;
  btn.textContent = "Активировать";
  showMsg(ERRORS[r.error] || ERRORS.activate_failed, "error");
});

loadDevice();
