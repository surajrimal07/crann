Crann: Effortless State Synchronization for Web Extensions

![crann_logo](img/crann_logo_smaller.png)

`npm i crann`

## Table of Contents

- [Core Features](#core-features)
- [Quick Start](#quick-start-a-simple-synchronization-example)
- [Core Usage](#getting-started-core-usage)
- [Advanced Features](#advanced-features)
  - [Complex Types](#handling-complex-types)
  - [Partitioned State](#understanding-partitioned-state)
  - [Persistence](#state-persistence-options)
  - [Advanced API](#advanced-api-functions)
  - [Remote Procedure Calls (RPC Actions)](#remote-procedure-calls-rpc-actions)
  - [React Integration](#react-integration)
- [What Was The Problem?](#what-was-the-problem)
- [Why Is This Better?](#why-is-this-better-how-crann-simplifies-synchronization)

## State Synchronization for Web Extensions

Crann synchronizes state across all parts of your Web Extension with full TypeScript support, eliminating the need for complex manual message passing. Focus on your extension's features, not the plumbing.

**Core Features:**

- Minimal size (< 5kb)
- Syncs state between any context (Content Scripts, Service Worker, Devtools, Sidepanels, Popup, etc.)
- Eliminates manual `chrome.runtime.sendMessage` / `onMessage` boilerplate
- Reactive state updates via subscriptions (`subscribe`)
- Optional state persistence (`Persistence.Local` / `Persistence.Session`)
- Strong TypeScript inference and support for type safety

### Quick Start: A Simple Synchronization Example

Let's see how easy it is. Imagine we want a toggle in the popup to control whether a border is applied to the current web page by a content script.

**1. Define the state in your Service Worker:**

```typescript
// service-worker.ts
import { create } from "crann";

const crann = create({
  isBorderEnabled: { default: false }, // Single shared state item
});

console.log("Crann hub initialized.");
// Keep the service worker alive if needed (e.g., using chrome.runtime.connect)
// Crann itself doesn't automatically keep the SW alive.
```

**2. Control the state from your Popup:**

```typescript
// popup.ts
import { connect } from "crann";

const { set, get } = connect(); // Connect to the Crann hub

const toggleButton = document.getElementById("toggleBorder");

// Set initial button state
const currentState = get();
toggleButton.textContent = currentState.isBorderEnabled
  ? "Disable Border"
  : "Enable Border";

// Add click listener to update state
toggleButton.addEventListener("click", () => {
  const newState = !get().isBorderEnabled; // Get current state before setting
  set({ isBorderEnabled: newState });
  // Update button text immediately (or subscribe to changes)
  toggleButton.textContent = newState ? "Disable Border" : "Enable Border";
});
```

**3. React to the state in your Content Script:**

```typescript
// content-script.ts
import { connect } from "crann";

const { subscribe } = connect(); // Connect to the Crann hub

console.log("Content script connected to Crann.");

// Subscribe to changes in 'isBorderEnabled'
subscribe(
  (state) => {
    console.log("Border state changed:", state.isBorderEnabled);
    document.body.style.border = state.isBorderEnabled ? "5px solid green" : "";
  },
  ["isBorderEnabled"]
); // Optional: Only trigger for specific key changes

// Apply initial state
const initialState = connect().get(); // Can call connect() again or store result
document.body.style.border = initialState.isBorderEnabled
  ? "5px solid green"
  : "";
```

**Notice:** We achieved synchronization between the popup and content script _without writing any `chrome.runtime.sendMessage` or `chrome.runtime.onMessage` code!_ Crann handled the communication behind the scenes.

## Getting Started: Core Usage

### Step 1: Create the State Hub (Service Worker)

The service worker is where you initialize your shared state. Here's a more detailed example showing how to define different types of state:

```typescript
// service-worker.ts
import { create, Partition, Persistence } from "crann";

const crann = create({
  // Basic state with default value
  active: { default: false },

  // State that's unique to each context
  name: {
    default: "",
    partition: Partition.Instance,
  },

  // State that persists between sessions
  timesUsed: {
    default: 0,
    persistence: Persistence.Local,
  },

  // State that resets when the browser closes
  sessionStart: {
    default: new Date(),
    persistence: Persistence.Session,
  },
});

// Get shared state (no instance state)
const { active, timesUsed } = crann.get();

// Optionally: Get state for a specific instance (includes instance state)
const { active, timesUsed, name } = crann.get("instanceKey");

// Subscribe to state changes
crann.subscribe((state, changes, key) => {
  // state contains all state (shared + relevant partition)
  // changes contains only the keys that changed
  // key identifies which context made the change (null if from service worker)
  console.log("State changed:", changes);
});
```

### Step 2: Connect from Other Contexts

Other parts of your extension connect to the state hub. They automatically get access to both shared and their own partitioned state:

```typescript
// popup.ts or content-script.ts
import { connect } from "crann";

const { get, set, subscribe } = connect();

// Get all state (shared + this context's partition)
const { active, name, timesUsed } = get();

// Set state
set({ name: "My Context's Name" });

// Subscribe to specific state changes
subscribe(
  (changes) => {
    console.log("Times used changed:", changes.timesUsed);
  },
  ["timesUsed"]
);
```

## Advanced Features

### Handling Complex Types

Sometimes the default value alone isn't enough for TypeScript to infer the full type. Use type assertions to specify the complete type:

```typescript
import { create } from "crann";

// Example 1: Custom object type with null default
type CustomType = { name: string; age: number };

// Example 2: Specific string literal union
type ConnectionStatus = "idle" | "connecting" | "connected" | "error";

const crann = create({
  person: {
    default: null as null | CustomType,
  },
  connectionStatus: {
    default: "idle" as ConnectionStatus,
  },
  userStatus: {
    default: "active" as "active" | "inactive",
    persistence: Persistence.Local,
  },
});

// Now TypeScript understands the full potential types
const state = crann.get();
// state.person could be null or { name: string; age: number }
// state.connectionStatus could be 'idle', 'connecting', 'connected', or 'error'
```

### Understanding Partitioned State

Partitioned state (`Partition.Instance`) is useful when you want each context to have its own version of a state variable. For example:

- Each content script might need its own `selectedElement` state
- Each popup might need its own `isOpen` state
- Each devtools panel might need its own `activeTab` state

The service worker can access any context's partitioned state using `get('instanceKey')`, but typically you'll let each context manage its own partitioned state.

### State Persistence Options

Crann offers two levels of persistence:

- **Session Storage** (`Persistence.Session`): State persists between page refreshes but resets when the browser closes
- **Local Storage** (`Persistence.Local`): State persists long-term until explicitly cleared

```typescript
const crann = create({
  // Will be remembered between browser sessions
  userPreferences: {
    default: { theme: "light" },
    persistence: Persistence.Local,
  },

  // Will reset when browser closes
  currentSession: {
    default: { startTime: new Date() },
    persistence: Persistence.Session,
  },
});
```

Remember: Persisted state is always shared state (not partitioned).

### Advanced API Functions

The `create` function returns an object with the following methods:

```typescript
const crann = create({
  // ... state config ...
});

// Get state
const state = crann.get(); // Get all state
const instanceState = crann.get("instanceKey"); // Get state for specific instance

// Set state
await crann.set({ key: "value" }); // Set service state
await crann.set({ key: "value" }, "instanceKey"); // Set instance state

// Subscribe to state changes
crann.subscribe((state, changes, agent) => {
  // state: The complete state
  // changes: Only the changed values
  // agent: Info about which context made the change
});

// Subscribe to instance ready events
const unsubscribe = crann.onInstanceReady((instanceId, agent) => {
  // Called when a new instance connects
  // Returned function can be called to unsubscribe
});

// Find an instance by location
const instanceId = crann.findInstance({
  context: "content-script",
  tabId: 123,
  frameId: 0,
});

// Query agents by location
const agents = crann.queryAgents({
  context: "content-script",
});

// Clear all state
await crann.clear();
```

### Remote Procedure Calls (RPC Actions)

Crann supports RPC-style actions that execute in the service worker context while being callable from any extension context. This is perfect for operations that need to run in the service worker, like making network requests or accessing extension APIs.

#### Defining Actions in the Service Worker

Actions are defined in your config alongside regular state items. The key difference is that actions have a `handler` property:

```typescript
// service-worker.ts
import { create } from "crann";
import { BrowserLocation } from "porter-source-fork";

const crann = create({
  // Regular state
  counter: {
    default: 0,
    persist: "local",
  },

  // RPC action
  increment: {
    handler: async (
      state: any,
      setState: (newState: Partial<any>) => Promise<void>,
      target: BrowserLocation,
      amount: number
    ) => {
      // This runs in the service worker
      const newCounter = state.counter + amount;
      await setState({ counter: newCounter });
      return { counter: newCounter };
    },
    validate: (amount: number) => {
      if (amount < 0) throw new Error("Amount must be positive");
    },
  },

  // Another action example
  fetchData: {
    handler: async (
      state: any,
      setState: (newState: Partial<any>) => Promise<void>,
      target: BrowserLocation,
      url: string
    ) => {
      // This runs in the service worker where we can make network requests
      const response = await fetch(url);
      const data = await response.json();
      return { data };
    },
    validate: (url: string) => {
      if (!url.startsWith("https://")) {
        throw new Error("URL must be HTTPS");
      }
    },
  },

  // Action that returns the current time
  getCurrentTime: {
    handler: async (
      state: any,
      setState: (newState: Partial<any>) => Promise<void>,
      target: BrowserLocation
    ) => {
      return { time: new Date().toISOString() };
    },
  },
});
```

#### Understanding Action Handler Parameters

Action handlers receive four parameters that are automatically provided by Crann:

1. **`state`**: The current state object containing all shared and service state
2. **`setState`**: A function to update the state from within the action. Use this to persist changes made by your action
3. **`target`**: A `BrowserLocation` object that identifies which context called the action
4. **`...args`**: The arguments passed to the action when called via `callAction()`

```typescript
// Example showing how to use each parameter
incrementWithLogging: {
  handler: async (
    state: any,
    setState: (newState: Partial<any>) => Promise<void>,
    target: BrowserLocation,
    amount: number
  ) => {
    // Read from state
    const currentCount = state.counter;

    // Log which context called this action
    console.log(`Increment called from ${target.context} with amount ${amount}`);

    // Update state
    const newCount = currentCount + amount;
    await setState({ counter: newCount });

    // Return result (optional)
    return { counter: newCount, previousValue: currentCount };
  },
}
```

#### Using Actions in Service Worker

Actions can be called from any context that connects to Crann:

```typescript
// content-script.ts
import { connect } from "crann";
import { config } from "./config";

const { get, subscribe, onReady, callAction } = connect(config);

// Wait for connection
onReady((status) => {
  if (status.connected) {
    console.log("Connected to Crann");

    // Use the increment action
    document
      .getElementById("incrementButton")
      .addEventListener("click", async () => {
        try {
          const result = await callAction("increment", 1);
          console.log("Counter incremented to:", result);
          // Counter is updated in state automatically
        } catch (error) {
          console.error("Failed to increment:", error.message);
        }
      });

    // Use the fetchData action
    document
      .getElementById("fetchButton")
      .addEventListener("click", async () => {
        try {
          const result = await callAction(
            "fetchData",
            "https://api.example.com/data"
          );
          console.log("Fetched data:", result.data);
        } catch (error) {
          console.error("Failed to fetch data:", error.message);
        }
      });
  }
});
```

#### Using Actions in Popup/Options Pages

The same pattern works in popup and options pages:

```typescript
// popup.ts
import { connect } from "crann";
import { config } from "./config";

const { get, callAction } = connect(config);

document.addEventListener("DOMContentLoaded", () => {
  // Display the current counter
  const counterElement = document.getElementById("counter");
  counterElement.textContent = get().counter.toString();

  // Add click handler for the increment button
  document
    .getElementById("incrementButton")
    .addEventListener("click", async () => {
      try {
        const result = await callAction("increment", 1);
        counterElement.textContent = result.counter.toString();
      } catch (error) {
        console.error("Failed to increment:", error.message);
      }
    });

  // Get and display the current time
  document.getElementById("timeButton").addEventListener("click", async () => {
    try {
      const result = await callAction("getCurrentTime");
      document.getElementById("currentTime").textContent = result.time;
    } catch (error) {
      console.error("Failed to get time:", error.message);
    }
  });
});
```

#### Using Actions in React Components

Crann's React integration also supports RPC actions through the `useCrannState` hook:

```tsx
// MyReactComponent.tsx
import React, { useState } from "react";
import { createCrannStateHook } from "crann";
import { config } from "./config";

// Create a custom hook for your config
const useCrannState = createCrannStateHook(config);

function CounterComponent() {
  const { useStateItem, callAction } = useCrannState();
  const [counter, setCounter] = useStateItem("counter");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState<string | null>(null);

  const handleIncrement = async () => {
    setIsLoading(true);
    setError(null);

    try {
      // Call the increment action defined in the service worker
      const result = await callAction("increment", 1);
      // Note: The state will be automatically updated through the subscription,
      // but you can also use the result directly if needed
      console.log("Counter incremented to:", result.counter);
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const fetchCurrentTime = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const result = await callAction("getCurrentTime");
      setCurrentTime(result.time);
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div>
      <h2>Counter: {counter}</h2>

      <button onClick={handleIncrement} disabled={isLoading}>
        {isLoading ? "Incrementing..." : "Increment Counter"}
      </button>

      <button onClick={fetchCurrentTime} disabled={isLoading}>
        {isLoading ? "Fetching..." : "Get Current Time"}
      </button>

      {currentTime && <p>Current time: {currentTime}</p>}
      {error && <p className="error">Error: {error}</p>}
    </div>
  );
}

export default CounterComponent;
```

#### Key Benefits of RPC Actions

1. **Type Safety**: Full TypeScript support for action parameters and return values
2. **Validation**: Optional validation of action parameters before execution
3. **Service Worker Context**: Actions run in the service worker where they have access to all extension APIs
4. **Automatic State Updates**: Actions can return state updates that are automatically synchronized
5. **Error Handling**: Proper error propagation from service worker to calling context
6. **Unified API**: Same pattern works across all contexts (content scripts, popups, React components)
7. **Simplified Architecture**: Centralize complex operations in the service worker

### React Integration

Crann provides a custom React hook for easy integration with React applications. This is particularly useful when you have a React app running in an iframe injected by your content script.

```typescript
// In your React component
import { useCrann } from "crann";

function MyReactComponent() {
  // The hook returns the same interface as connect()
  const { get, set, subscribe } = useCrann();

  // Get the current state
  const { isEnabled, count } = get();

  // Set state (triggers re-render)
  const toggleEnabled = () => {
    set({ isEnabled: !isEnabled });
  };

  // Subscribe to specific state changes
  subscribe(
    (changes) => {
      console.log("Count changed:", changes.count);
    },
    ["count"]
  );

  return (
    <div>
      <button onClick={toggleEnabled}>
        {isEnabled ? "Disable" : "Enable"}
      </button>
      <p>Count: {count}</p>
    </div>
  );
}
```

The `useCrann` hook provides the same functionality as `connect()`, but with React-specific optimizations:

- Automatically re-renders components when subscribed state changes
- Handles cleanup of subscriptions when components unmount
- Provides TypeScript support for your state types

#### Using with TypeScript

For better type safety, you can create a custom hook that includes your state types:

```typescript
// types.ts
interface MyState {
  isEnabled: boolean;
  count: number;
  user: {
    name: string;
    age: number;
  } | null;
}

// hooks.ts
import { useCrann } from "crann";
import type { MyState } from "./types";

export function useMyCrann() {
  return useCrann<MyState>();
}

// MyComponent.tsx
import { useMyCrann } from "./hooks";

function MyComponent() {
  const { get, set } = useMyCrann();

  // TypeScript now knows the shape of your state
  const { user } = get();

  const updateUser = () => {
    set({
      user: {
        name: "Alice",
        age: 30,
      },
    });
  };

  return (
    <div>
      {user && <p>Hello, {user.name}!</p>}
      <button onClick={updateUser}>Update User</button>
    </div>
  );
}
```

#### Performance Considerations

The `useCrann` hook is optimized for React usage:

- Only re-renders when subscribed state actually changes
- Batches multiple state updates to minimize re-renders
- Automatically cleans up subscriptions on unmount
- Supports selective subscription to specific state keys

For best performance:

1. Subscribe only to the state keys your component needs
2. Use the second parameter of `subscribe` to specify which keys to listen for
3. Consider using `useMemo` for derived state
4. Use `useCallback` for event handlers that update state

```typescript
function OptimizedComponent() {
  const { get, set, subscribe } = useCrann();
  const { items, filter } = get();

  // Only re-render when items or filter changes
  const filteredItems = useMemo(() => {
    return items.filter((item) => item.includes(filter));
  }, [items, filter]);

  // Memoize the handler
  const handleFilterChange = useCallback(
    (newFilter: string) => {
      set({ filter: newFilter });
    },
    [set]
  );

  // Only subscribe to the keys we care about
  subscribe(
    (changes) => {
      console.log("Filter changed:", changes.filter);
    },
    ["filter"]
  );

  return (
    <div>
      <input
        value={filter}
        onChange={(e) => handleFilterChange(e.target.value)}
      />
      <ul>
        {filteredItems.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}
```

## What Was The Problem?

Browser extensions often have multiple components:

- **Service Worker:** A background script handling core logic and events.
- **Content Scripts:** JavaScript injected directly into web pages.
- **Popup:** A small window shown when clicking the extension icon.
- **Side Panels, DevTools Pages:** Other specialized UI or inspection contexts.

These components run in isolated environments. Sharing data or coordinating actions between them traditionally requires manually sending messages back and forth using APIs like `chrome.runtime.sendMessage` and setting up listeners (`chrome.runtime.onMessage`). This can quickly lead to complex, hard-to-debug "spaghetti code" as your extension grows.

## Why Is This Better: How Crann Simplifies Synchronization

Crann acts as a central state management hub, typically initialized in your service worker. It provides a single source of truth for your shared data. Other contexts connect to this hub, allowing them to easily read state, update it, and subscribe to changes.

**Visualizing the Problem: Manual Message Passing vs. Crann's Centralized State**

![with_messages](img/with_messages.png)
_Traditional message passing requires complex, bidirectional communication between all parts._

![with_crann](img/with_crann.png)
_Crann's centralized state management simplifies the architecture by eliminating the need for manual message passing._

This dramatically simplifies your architecture:

- **No more manual messaging:** Crann handles the communication internally.
- **Single source of truth:** State is managed centrally.
- **Reactivity:** Components automatically react to state changes they care about.
