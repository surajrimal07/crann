import { connect } from "crann-fork";

import { config } from '../config';


const { get, subscribe, onReady, callAction } = connect(config, { debug: true });

let messageCount = 0;
let messageInterval: NodeJS.Timeout | null = null;
let isTestRunning = false;


function log(message: string) {
  const logElement = document.getElementById('log');
  if (logElement) {
    const timestamp = new Date().toISOString();
    logElement.innerHTML += `[${timestamp}] ${message}<br>`;
    logElement.scrollTop = logElement.scrollHeight;
  }
}

function updateStatus(message: string) {
  const statusElement = document.getElementById('status');
  if (statusElement) {
    statusElement.textContent = `Status: ${message}`;
  }
}

function sendTestMessage() {
  messageCount++;
  const message = {
    action: 'test-echo',
    payload: `Test message ${messageCount} at ${new Date().toISOString()}`,
  };

  try {
    callAction(message.action, message.payload);
    log(`Sent message: ${JSON.stringify(message)}`);
  } catch (error) {
    log(`Failed to send message: ${error}`);
  }
}

function startTest() {
  if (isTestRunning) return;

  isTestRunning = true;
  messageCount = 0;
  updateStatus('Running test - sending messages...');

  // Send messages every second for 5 seconds
  messageInterval = setInterval(() => {
    sendTestMessage();
  }, 1000);

  // Stop after 5 seconds
  setTimeout(() => {
    if (messageInterval) {
      clearInterval(messageInterval);
      messageInterval = null;
    }
    isTestRunning = false;
    updateStatus('Test complete - waiting for service worker shutdown...');

    // Enable the send message button
    const sendButton = document.getElementById(
      'send-message'
    ) as HTMLButtonElement;
    if (sendButton) {
      sendButton.disabled = false;
    }
  }, 5000);
}

function sendSingleMessage() {
  if (!isTestRunning) {
    sendTestMessage();
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const startButton = document.getElementById('start-test');
  if (startButton) {
    startButton.addEventListener('click', startTest);
  }

  const sendButton = document.getElementById('send-message');
  if (sendButton) {
    sendButton.addEventListener('click', sendSingleMessage);
  }

  // Log initial connection
  log('Sidepanel connected');

  // Crann state and reactivity tests
  log('Initial state: ' + JSON.stringify(get()));
  subscribe((changes) => {
    log('State changed: ' + JSON.stringify(changes));
  });

  // Test increment action
  callAction('increment', 1).then((result) => {
    log('Incremented: ' + result);
  });

  // Test getCurrentTime
  callAction('getCurrentTime').then((result) => {
    log('Current time: ' + result.time);
  });

  // Test fetchData
  callAction('fetchData', 'https://example.com').then((result) => {
    log('Fetched data: ' + JSON.stringify(result.data));
  });

  // Test error handling
  callAction('non-existent').catch((err) => {
    log('Expected error: ' + err);
  });
});
