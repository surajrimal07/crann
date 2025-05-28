import { Partition, Persistence } from "crann";

// Define our test configuration
export const config = {
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

  // RPC action example
  increment: {
    handler: async (
      state: any,
      setState: (newState: Partial<any>) => Promise<void>,
      amount: number
    ) => {
      const newValue = state.timesUsed + amount;
      await setState({ timesUsed: newValue });
      return newValue;
    },
    validate: (amount: number) => {
      if (amount < 0) throw new Error("Amount must be positive");
    },
  },
};
