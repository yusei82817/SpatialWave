const OFFSCREEN_URL = "offscreen.html";

async function ensureOffscreen() {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
    documentUrls: [chrome.runtime.getURL(OFFSCREEN_URL)]
  });

  if (contexts.length === 0) {
    await chrome.offscreen.createDocument({
      url: OFFSCREEN_URL,
      reasons: ["USER_MEDIA"],
      justification: "タブ音声をリアルタイムで空間音響処理するため"
    });
  }
}

async function sendToOffscreen(message) {
  await ensureOffscreen();
  return chrome.runtime.sendMessage({ ...message, target: "offscreen" });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.target === "offscreen") return;

  (async () => {
    try {
      if (message.type === "START") {
        const [tab] = await chrome.tabs.query({
          active: true,
          currentWindow: true
        });

        if (!tab?.id || !tab.url || !/^https?:/.test(tab.url)) {
          throw new Error("音声を再生している通常のWebページを開いてください。");
        }

        await ensureOffscreen();
        const streamId = await chrome.tabCapture.getMediaStreamId({
          targetTabId: tab.id
        });

        sendResponse(await sendToOffscreen({
          type: "START_AUDIO",
          streamId
        }));
        return;
      }

      if (message.type === "STOP") {
        sendResponse(await sendToOffscreen({ type: "STOP_AUDIO" }));
        return;
      }

      if (message.type === "SETTINGS") {
        sendResponse(await sendToOffscreen({
          type: "SETTINGS",
          settings: message.settings
        }));
        return;
      }

      if (message.type === "GET_STATUS") {
        const contexts = await chrome.runtime.getContexts({
          contextTypes: ["OFFSCREEN_DOCUMENT"],
          documentUrls: [chrome.runtime.getURL(OFFSCREEN_URL)]
        });

        if (contexts.length === 0) {
          sendResponse({ ok: true, running: false });
          return;
        }

        sendResponse(await chrome.runtime.sendMessage({
          type: "GET_STATUS",
          target: "offscreen"
        }));
      }
    } catch (error) {
      sendResponse({
        ok: false,
        error: error?.message || "処理に失敗しました。"
      });
    }
  })();

  return true;
});
