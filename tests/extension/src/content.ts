import { connect } from "crann";
import { config } from "./config";

// Create a simple UI to test our actions
function createTestUI() {
  const container = document.createElement("div");
  container.style.position = "fixed";
  container.style.top = "10px";
  container.style.right = "10px";
  container.style.padding = "10px";
  container.style.backgroundColor = "white";
  container.style.border = "1px solid #ccc";
  container.style.borderRadius = "5px";
  container.style.zIndex = "10000";

  const counterDisplay = document.createElement("div");
  counterDisplay.id = "counter-display";
  counterDisplay.style.color = "black";
  counterDisplay.textContent = "Counter: 0";
  container.appendChild(counterDisplay);

  const incrementButton = document.createElement("button");
  incrementButton.textContent = "Increment by 1";
  incrementButton.style.margin = "5px";
  incrementButton.style.cursor = "pointer";
  container.appendChild(incrementButton);

  const timeButton = document.createElement("button");
  timeButton.textContent = "Get Current Time";
  timeButton.style.margin = "5px";
  container.appendChild(timeButton);

  const fetchButton = document.createElement("button");
  fetchButton.textContent = "Fetch Data";
  fetchButton.style.margin = "5px";
  container.appendChild(fetchButton);

  const resultDisplay = document.createElement("div");
  resultDisplay.id = "result-display";
  resultDisplay.style.marginTop = "10px";
  resultDisplay.style.color = "black";
  container.appendChild(resultDisplay);

  document.body.appendChild(container);

  return {
    updateCounter: (value: number) => {
      counterDisplay.textContent = `Counter: ${value}`;
    },
    updateResult: (text: string) => {
      resultDisplay.textContent = text;
    },
    incrementButton,
    timeButton,
    fetchButton,
  };
}

// Initialize Crann and UI
const [useCrann, get, set, subscribe, getAgentInfo, onReady, callAction] =
  connect(config, { debug: true });
const ui = createTestUI();

// Wait for connection
onReady((status) => {
  console.log("MOC onReady", status);
  if (status.connected) {
    console.log("Connected to Crann");

    // Subscribe to counter changes
    subscribe((changes) => {
      if ("timesUsed" in changes) {
        ui.updateCounter(changes.timesUsed as number);
      }
    });

    // Set up button handlers
    ui.incrementButton.addEventListener("click", async () => {
      try {
        console.log("incrementButton click");
        const result = await callAction("increment", 1);
        console.log("incrementButton click result", result);
        ui.updateResult(`Increment counter to ${result}`);
      } catch (error) {
        if (error instanceof Error) {
          ui.updateResult(`Error: ${error.message}`);
        } else {
          ui.updateResult("An unknown error occurred");
        }
      }
    });

    ui.timeButton.addEventListener("click", async () => {
      try {
        const result = await callAction("getCurrentTime");
        ui.updateResult(`Current time: ${result.time}`);
      } catch (error) {
        if (error instanceof Error) {
          ui.updateResult(`Error: ${error.message}`);
        } else {
          ui.updateResult("An unknown error occurred");
        }
      }
    });

    ui.fetchButton.addEventListener("click", async () => {
      try {
        ui.updateResult("Fetching data...");
        const result = await callAction("fetchData", "https://example.com");
        ui.updateResult(
          `Fetched data: ${JSON.stringify(result.data, null, 2)}`
        );
      } catch (error) {
        if (error instanceof Error) {
          ui.updateResult(`Error: ${error.message}`);
        } else {
          ui.updateResult("An unknown error occurred");
        }
      }
    });

    // Set initial counter value
    const initialState = get();
    ui.updateCounter(initialState.timesUsed as number);
  } else {
    console.error("Failed to connect to Crann");
    ui.updateResult("Failed to connect to Crann");
  }
});
