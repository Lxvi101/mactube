const send = (url, mode = "video", cookies = false) => {
  if (!url) return;
  const auth = cookies ? "&cookies=chrome" : "";
  chrome.tabs
    .update({
      url: `mactube://add?mode=${mode}${auth}&url=${encodeURIComponent(url)}`,
    })
    .catch((error) => {
      console.error("MacTube could not be opened", error);
      chrome.action.setBadgeBackgroundColor({ color: "#d94d35" });
      chrome.action.setBadgeText({ text: "!" });
      chrome.action.setTitle({ title: "MacTube could not be opened" });
      setTimeout(() => {
        chrome.action.setBadgeText({ text: "" });
        chrome.action.setTitle({ title: "Open in MacTube" });
      }, 5000);
    });
};

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "mactube-video",
    title: "Download with MacTube",
    contexts: ["page", "link"],
    documentUrlPatterns: ["*://*.youtube.com/*", "*://youtu.be/*"],
  });
  chrome.contextMenus.create({
    id: "mactube-audio",
    title: "Download full-quality audio",
    contexts: ["page", "link"],
    documentUrlPatterns: ["*://*.youtube.com/*", "*://youtu.be/*"],
  });
  chrome.contextMenus.create({
    id: "mactube-private",
    title: "Download using Chrome sign-in",
    contexts: ["page", "link"],
    documentUrlPatterns: ["*://*.youtube.com/*", "*://youtu.be/*"],
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) =>
  send(
    info.linkUrl || info.pageUrl || tab?.url,
    info.menuItemId === "mactube-audio" ? "audio" : "video",
    info.menuItemId === "mactube-private",
  ),
);
