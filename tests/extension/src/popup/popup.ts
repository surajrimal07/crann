import { connect } from "crann-fork";
import { config } from "../config";

const { get, subscribe, onReady, callAction } = connect(config, { debug: true });

function log(msg) {
  const logDiv = document.getElementById("log") || (() => {
    const d = document.createElement("div");
    d.id = "log";
    d.style.fontSize = "12px";
    d.style.maxHeight = "200px";
    d.style.overflowY = "auto";
    document.body.appendChild(d);
    return d;
  })();
  logDiv.innerHTML += msg + "<br>";
  logDiv.scrollTop = logDiv.scrollHeight;
}

function runCrannTests() {
  // Test state get/set
  log("Initial state: " + JSON.stringify(get()));
  subscribe((changes) => {
    log("State changed: " + JSON.stringify(changes));
  });

  // Test increment action
  callAction("increment", 1).then((result) => {
    log("Incremented: " + result);
  });

  // Test getCurrentTime
  callAction("getCurrentTime").then((result) => {
    log("Current time: " + result.time);
  });

  // Test fetchData
  callAction("fetchData", "https://example.com").then((result) => {
    log("Fetched data: " + JSON.stringify(result.data));
  });

  // Test error handling
  callAction("non-existent").catch((err) => {
    log("Expected error: " + err);
  });
}

onReady((status) => {
  log("Crann popup ready: " + JSON.stringify(status));
  if (status.connected) {
    runCrannTests();
  } else {
    log("Failed to connect to Crann");
  }
});