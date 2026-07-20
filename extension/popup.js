const status = document.querySelector("#status");
const buttons = [...document.querySelectorAll("button")];

async function send(mode) {
  buttons.forEach((button) => (button.disabled = true));
  const cookies = document.querySelector("#cookies").checked;
  status.className = "opening";
  status.textContent = cookies
    ? "Opening MacTube with Chrome sign-in…"
    : "Opening MacTube…";
  try {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    if (!tab?.url) throw new Error("No active page was found.");
    const auth = cookies ? "&cookies=chrome" : "";
    await chrome.tabs.update(tab.id, {
      url: `mactube://add?mode=${mode}${auth}&url=${encodeURIComponent(tab.url)}`,
    });
    window.setTimeout(() => window.close(), 250);
  } catch (error) {
    status.className = "error";
    status.textContent = "Couldn’t open MacTube. Is the app installed?";
    buttons.forEach((button) => (button.disabled = false));
  }
}

document.querySelector("#video").addEventListener("click", () => send("video"));
document.querySelector("#audio").addEventListener("click", () => send("audio"));
