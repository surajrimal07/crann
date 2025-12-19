import { createConfig, Partition, Persistence } from "crann";
import { BrowserLocation } from "porter-source-fork";

// Define our test configuration
export const config = createConfig({
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
    persist: Persistence.Local,
  },

  // State that resets when the browser closes
  sessionStart: {
    default: new Date(),
    persist: Persistence.Session,
  },

  // RPC action example
  increment: {
    handler: async (
      state: any,
      setState: (newState: Partial<any>) => Promise<void>,
      target: BrowserLocation,
      amount: number
    ) => {
      console.log("Increment heard, handler has properties: ", {
        state,
        target,
        amount,
      });
      const newValue = state.timesUsed + amount;
      await setState({ timesUsed: newValue });

      return newValue;
    },
    validate: (amount: number) => {
      if (amount < 0) throw new Error("Amount must be positive");
    },
  },
});
