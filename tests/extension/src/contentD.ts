import { connect } from "crann-fork";
import { config } from "./config";

function createTestUI(label, topOffset) {
  const container = document.createElement("div");
  container.id = `crann-test-container-${label}`;
  container.style.position = "fixed";
  container.style.top = `${topOffset}px`;
  container.style.left = "220px";
  container.style.padding = "10px";
  container.style.backgroundColor = "#ffe0e0";
  container.style.border = "1px solid #c00";
  container.style.borderRadius = "5px";
  container.style.zIndex = (13000 + topOffset).toString();

  const header = document.createElement("div");
  header.textContent = `Crann Test Panel (${label})`;
  header.style.fontWeight = "bold";
  header.style.color = "#a00";
  container.appendChild(header);

  const sessionDisplay = document.createElement("div");
  sessionDisplay.id = `session-display-${label}`;
  sessionDisplay.style.color = "#a00";
  sessionDisplay.textContent = "Session: {}";
  container.appendChild(sessionDisplay);

  const sessionButton = document.createElement("button");
  sessionButton.textContent = "Show Session Start";
  sessionButton.style.margin = "5px";
  container.appendChild(sessionButton);

  const incButton = document.createElement("button");
  incButton.textContent = "Increment by 5";
  incButton.style.margin = "5px";
  container.appendChild(incButton);

  const resultDisplay = document.createElement("div");
  resultDisplay.id = `result-display-${label}`;
  resultDisplay.style.marginTop = "10px";
  resultDisplay.style.color = "#a00";
  container.appendChild(resultDisplay);

  document.body.appendChild(container);

  return {
    updateSession: (session) => {
      sessionDisplay.textContent = `Session: ${JSON.stringify(session)}`;
    },
    updateResult: (text) => {
      resultDisplay.textContent = text;
    },
    sessionButton,
    incButton,
  };
}

function createCrannClient(label, topOffset) {
  const { get, subscribe, onReady, callAction } = connect(config, { debug: true });
  const ui = createTestUI(label, topOffset);

  onReady((status) => {
    if (status.connected) {
      ui.updateSession(get().sessionStart);
      subscribe((changes) => {
        if ("sessionStart" in changes) {
          ui.updateSession(changes.sessionStart);
        }
      });
      ui.sessionButton.addEventListener("click", async () => {
        ui.updateResult(`Session started at: ${get().sessionStart}`);
      });
      ui.incButton.addEventListener("click", async () => {
        const result = await callAction("increment", 5);
        ui.updateResult(`Incremented by 5, new value: ${result}`);
      });
    } else {
      ui.updateResult("Failed to connect to Crann");
    }
  });
}

createCrannClient("D", 490);
