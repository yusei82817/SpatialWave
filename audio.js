let stream = null;
let audioContext = null;
let source = null;
let splitter = null;
let pannerL = null;
let pannerR = null;
let inputGainL = null;
let inputGainR = null;
let dryGain = null;
let wetGain = null;
let convolver = null;
let masterGain = null;
let compressor = null;
let running = false;

const settings = {
  enabled: true,
  intensity: 65,
  width: 55,
  reverb: 18,
  direction: 0,
  volume: 80
};

const clamp = (value, min, max) =>
  Math.min(max, Math.max(min, Number(value)));

function createPanner(ctx) {
  const panner = ctx.createPanner();
  panner.panningModel = "HRTF";
  panner.distanceModel = "inverse";
  panner.refDistance = 1;
  panner.maxDistance = 10000;
  panner.rolloffFactor = 0;
  panner.coneInnerAngle = 360;
  panner.coneOuterAngle = 360;
  return panner;
}

function setPosition(panner, azimuth) {
  const radians = azimuth * Math.PI / 180;
  const x = Math.sin(radians);
  const z = -Math.cos(radians);
  const now = audioContext.currentTime;

  if (panner.positionX) {
    panner.positionX.setTargetAtTime(x, now, 0.025);
    panner.positionY.setTargetAtTime(0, now, 0.025);
    panner.positionZ.setTargetAtTime(z, now, 0.025);
  } else {
    panner.setPosition(x, 0, z);
  }
}

function makeImpulseResponse(ctx, seconds = 1.3) {
  const length = Math.floor(ctx.sampleRate * seconds);
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate);

  for (let channel = 0; channel < 2; channel++) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < length; i++) {
      const fade = Math.pow(1 - i / length, 3.2);
      data[i] = (Math.random() * 2 - 1) * fade;
    }
  }
  return buffer;
}

function updateSettings() {
  if (!audioContext || !masterGain) return;

  const now = audioContext.currentTime;
  const enabled = settings.enabled ? 1 : 0;
  const intensity = settings.intensity / 100;
  const width = settings.width / 100;
  const reverb = settings.reverb / 100;

  // The two input channels are treated as nearby virtual sources.
  // This is a lightweight spatial effect, not a full binaural decoder.
  const spread = intensity * width * 65;
  setPosition(pannerL, settings.direction - spread);
  setPosition(pannerR, settings.direction + spread);

  inputGainL.gain.setTargetAtTime(1, now, 0.025);
  inputGainR.gain.setTargetAtTime(1, now, 0.025);

  // Disabling effects bypasses the wet path while preserving dry audio.
  dryGain.gain.setTargetAtTime(
    enabled ? 1 - reverb * 0.25 : 1,
    now,
    0.025
  );
  wetGain.gain.setTargetAtTime(
    enabled ? reverb * 0.35 : 0,
    now,
    0.025
  );
  masterGain.gain.setTargetAtTime(settings.volume / 100, now, 0.025);
}

function buildAudioGraph() {
  source = audioContext.createMediaStreamSource(stream);
  splitter = audioContext.createChannelSplitter(2);

  inputGainL = audioContext.createGain();
  inputGainR = audioContext.createGain();
  pannerL = createPanner(audioContext);
  pannerR = createPanner(audioContext);
  dryGain = audioContext.createGain();
  wetGain = audioContext.createGain();
  convolver = audioContext.createConvolver();
  convolver.buffer = makeImpulseResponse(audioContext);
  masterGain = audioContext.createGain();
  compressor = audioContext.createDynamicsCompressor();

  compressor.threshold.value = -8;
  compressor.knee.value = 12;
  compressor.ratio.value = 8;
  compressor.attack.value = 0.003;
  compressor.release.value = 0.18;

  source.connect(splitter);
  splitter.connect(inputGainL, 0);
  splitter.connect(inputGainR, 1);
  inputGainL.connect(pannerL);
  inputGainR.connect(pannerR);

  pannerL.connect(dryGain);
  pannerR.connect(dryGain);
  pannerL.connect(convolver);
  pannerR.connect(convolver);
  convolver.connect(wetGain);

  dryGain.connect(masterGain);
  wetGain.connect(masterGain);
  masterGain.connect(compressor);
  compressor.connect(audioContext.destination);

  updateSettings();
}

async function startAudio(streamId) {
  if (running) await stopAudio();

  stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      mandatory: {
        chromeMediaSource: "tab",
        chromeMediaSourceId: streamId
      }
    },
    video: false
  });

  try {
    audioContext = new AudioContext({ latencyHint: "interactive" });
    await audioContext.resume();
    buildAudioGraph();

    const track = stream.getAudioTracks()[0];
    track.addEventListener("ended", () => {
      stopAudio().catch(console.error);
    });

    running = true;
    return { ok: true, running: true, settings };
  } catch (error) {
    stream.getTracks().forEach(track => track.stop());
    stream = null;
    if (audioContext) {
      await audioContext.close().catch(() => {});
      audioContext = null;
    }
    throw error;
  }
}

async function stopAudio() {
  running = false;
  if (stream) {
    stream.getTracks().forEach(track => track.stop());
    stream = null;
  }
  if (audioContext) {
    await audioContext.close().catch(() => {});
    audioContext = null;
  }

  source = splitter = pannerL = pannerR = null;
  inputGainL = inputGainR = null;
  dryGain = wetGain = convolver = null;
  masterGain = compressor = null;

  return { ok: true, running: false };
}

function applySettings(next = {}) {
  for (const key of Object.keys(settings)) {
    if (Object.prototype.hasOwnProperty.call(next, key)) {
      settings[key] = next[key];
    }
  }

  settings.intensity = clamp(settings.intensity, 0, 100);
  settings.width = clamp(settings.width, 0, 100);
  settings.reverb = clamp(settings.reverb, 0, 100);
  settings.direction = clamp(settings.direction, -90, 90);
  settings.volume = clamp(settings.volume, 0, 100);
  settings.enabled = Boolean(settings.enabled);

  updateSettings();
  return { ok: true, settings };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.target !== "offscreen") return;

  (async () => {
    try {
      switch (message.type) {
        case "START_AUDIO":
          sendResponse(await startAudio(message.streamId));
          break;
        case "STOP_AUDIO":
          sendResponse(await stopAudio());
          break;
        case "SETTINGS":
          sendResponse(applySettings(message.settings));
          break;
        case "GET_STATUS":
          sendResponse({ ok: true, running, settings });
          break;
      }
    } catch (error) {
      sendResponse({
        ok: false,
        running,
        error: error?.message || "音声処理に失敗しました。"
      });
    }
  })();

  return true;
});
