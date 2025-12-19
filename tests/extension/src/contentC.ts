import { connect } from "crann-fork";
import { config } from "./config";

function createTestUI(label, topOffset) {
  const container = document.createElement("div");
  container.id = `crann-test-container-${label}`;
  container.style.position = "fixed";
  container.style.top = `${topOffset}px`;
  container.style.left = "10px";
  container.style.padding = "10px";
  container.style.backgroundColor = "#e0ffe0";
  container.style.border = "1px solid #0c0";
  container.style.borderRadius = "5px";
  container.style.zIndex = (12000 + topOffset).toString();

  const header = document.createElement("div");
  header.textContent = `Crann Test Panel (${label})`;
  header.style.fontWeight = "bold";
  header.style.color = "#0a0";
  container.appendChild(header);

  const stateDisplay = document.createElement("div");
  stateDisplay.id = `state-display-${label}`;
  stateDisplay.style.color = "#0a0";
  stateDisplay.textContent = "State: {}";
  container.appendChild(stateDisplay);

  const setNameButton = document.createElement("button");
  setNameButton.textContent = "Set Name";
  setNameButton.style.margin = "5px";
  container.appendChild(setNameButton);

  const resetButton = document.createElement("button");
  resetButton.textContent = "Reset Counter";
  resetButton.style.margin = "5px";
  container.appendChild(resetButton);

  const resultDisplay = document.createElement("div");
  resultDisplay.id = `result-display-${label}`;
  resultDisplay.style.marginTop = "10px";
  resultDisplay.style.color = "#0a0";
  container.appendChild(resultDisplay);

  document.body.appendChild(container);

  return {
    updateState: (state) => {
      stateDisplay.textContent = `State: ${JSON.stringify(state)}`;
    },
    updateResult: (text) => {
      resultDisplay.textContent = text;
    },
    setNameButton,
    resetButton,
  };
}

function createCrannClient(label, topOffset) {
  const { get, subscribe, onReady, callAction } = connect(config, { debug: true });
  const ui = createTestUI(label, topOffset);

  onReady((status) => {
    if (status.connected) {
      ui.updateState(get());
      subscribe((changes) => {
        ui.updateState(get());
      });
      ui.setNameButton.addEventListener("click", async () => {
        const name = prompt("Enter new name:");
        if (name) {
          await callAction("setName", name);
          ui.updateResult(`Name set to ${name}`);
        }
      });
      ui.resetButton.addEventListener("click", async () => {
        await callAction("increment", -get().timesUsed);
        ui.updateResult("Counter reset");
      });
    } else {
      ui.updateResult("Failed to connect to Crann");
    }
  });
}

createCrannClient("C", 330);
