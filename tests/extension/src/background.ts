import { create } from "crann";
import { config } from "./config";
import { PorterContext } from "porter-source-fork";

// Initialize Crann in the service worker
const crann = create(config, { debug: true });

// Subscribe to state changes
crann.subscribe((state, changes, agent) => {
  console.log("State changed:", changes);
  if (agent) {
    console.log("Change made by:", agent.id);
  }
});

// Subscribe to instance ready events
// crann.onInstanceReady((agent) => {
//   console.log("New instance ready:", agent);
//   console.log("Agent info:", agent);
// });

// Example of finding an instance
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete") {
    const instanceId = crann.findInstance({
      context: PorterContext.ContentScript,
      tabId,
      frameId: 0,
    });
  }
});

// Example of querying agents
setInterval(() => {
  const contentScripts = crann.queryAgents({
    context: PorterContext.ContentScript,
  });
  console.log("Active content scripts:", contentScripts);
}, 60000);

// Keep the service worker alive
chrome.runtime.onConnect.addListener((port) => {
  port.onDisconnect.addListener(() => {
    console.log("Port disconnected");
  });
});

// Log service worker startup
console.log(
  "[Crann:Test:BG] Service worker started at:",
  new Date().toISOString()
);

// Configure side panel to open on action click
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.error(error));

let originalTabId: number | null = null;
let isShutdown = false;

// Store original tab ID when side panel is opened
chrome.sidePanel.open = ((originalOpen) => {
  return async (options) => {
    if (options.tabId) {
      originalTabId = options.tabId;
    }
    return originalOpen(options);
  };
})(chrome.sidePanel.open);

// Reset when the side panel is closed
chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === originalTabId) {
    originalTabId = null;
  }
});

// Handle tab switching
chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  if (!originalTabId) return;

  if (tabId === originalTabId) {
    // Enable side panel on original tab
    await chrome.sidePanel.setOptions({
      tabId,
      enabled: true,
      path: "sidepanel/sidepanel.html",
    });
  } else {
    // Disable side panel on other tabs
    await chrome.sidePanel.setOptions({
      tabId,
      enabled: false,
    });
  }
});
