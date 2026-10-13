const $ = id => document.getElementById(id);
const controls = ["enabled", "intensity", "width", "reverb", "direction", "volume"];
let running = false;
let busy = false;

function readSettings() {
  return {
    enabled: $("enabled").checked,
    intensity: Number($("intensity").value),
    width: Number($("width").value),
    reverb: Number($("reverb").value),
    direction: Number($("direction").value),
    volume: Number($("volume").value)
  };
}

function showSettings(settings) {
  if (!settings) return;
  for (const key of controls) {
    if (!(key in settings)) continue;
    if (key === "enabled") $(key).checked = Boolean(settings[key]);
    else $(key).value = settings[key];
  }
  updateLabels();
}

function updateLabels() {
  for (const key of ["intensity", "width", "reverb", "volume"]) {
    $(key + "Value").value = $(key).value + "%";
  }
  const direction = Number($("direction").value);
  $("directionValue").value = direction > 0 ? `+${direction}°` : `${direction}°`;
}

function renderStatus() {
  $("status").textContent = busy ? "PROCESSING..." : running ? "ACTIVE" : "STANDBY";
  $("liveDot").classList.toggle("active", running);
  document.body.classList.toggle("running", running);
  $("startButton").disabled = busy || running;
  $("stopButton").disabled = busy || !running;
}

function showError(message = "") {
  $("error").textContent = message;
}

async function send(message) {
  const response = await chrome.runtime.sendMessage(message);
  if (!response) throw new Error("拡張機能から応答がありません。");
  if (response.ok === false) throw new Error(response.error || "操作に失敗しました。");
  return response;
}

async function start() {
  if (busy || running) return;
  busy = true;
  showError();
  renderStatus();
  try {
    const response = await send({ type: "START" });
    running = response.running === true;
    if (running) {
      await send({ type: "SETTINGS", settings: readSettings() });
    }
  } catch (error) {
    showError(error.message);
  } finally {
    busy = false;
    renderStatus();
  }
}

async function stop() {
  if (busy || !running) return;
  busy = true;
  showError();
  renderStatus();
  try {
    await send({ type: "STOP" });
    running = false;
  } catch (error) {
    showError(error.message);
  } finally {
    busy = false;
    renderStatus();
  }
}

let settingsTimer;
function scheduleSettingsUpdate() {
  updateLabels();
  if (!running) return;
  clearTimeout(settingsTimer);
  settingsTimer = setTimeout(async () => {
    try {
      await send({ type: "SETTINGS", settings: readSettings() });
    } catch (error) {
      showError(error.message);
    }
  }, 35);
}

$("startButton").addEventListener("click", start);
$("stopButton").addEventListener("click", stop);
for (const key of controls) {
  $(key).addEventListener("input", scheduleSettingsUpdate);
  $(key).addEventListener("change", scheduleSettingsUpdate);
}

async function initialize() {
  updateLabels();
  renderStatus();
  try {
    const response = await send({ type: "GET_STATUS" });
    running = response.running === true;
    showSettings(response.settings);
  } catch (error) {
    showError(error.message);
  }
  renderStatus();
}

initialize();
