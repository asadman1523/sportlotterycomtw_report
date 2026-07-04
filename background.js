chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.type !== "SLB_GET_PROFILE_USER_INFO") return false;

  if (!chrome.identity || !chrome.identity.getProfileUserInfo) {
    sendResponse({ ok: false, error: "請先登入 Chrome" });
    return false;
  }

  try {
    chrome.identity.getProfileUserInfo({ accountStatus: "ANY" }, (profileInfo) => {
      const lastError = chrome.runtime.lastError;
      if (lastError) {
        sendResponse({ ok: false, error: lastError.message || "請先登入 Chrome" });
        return;
      }

      const accountId = String(profileInfo?.id || "").trim();
      const email = String(profileInfo?.email || "").trim();
      if (!accountId) {
        sendResponse({ ok: false, error: "請先登入 Chrome" });
        return;
      }

      sendResponse({ ok: true, accountId, email });
    });
  } catch (e) {
    sendResponse({ ok: false, error: "請先登入 Chrome" });
    return false;
  }

  return true;
});
