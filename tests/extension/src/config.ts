import { Partition, Persistence } from "crann";
import { BrowserLocation } from "porter-source";
import { CrannConfig } from "../../../dist/types/model/crann.model";

// Define our test configuration
export const config: CrannConfig<any> = {
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
      const newValue = state.timesUsed + amount;
      await setState({ timesUsed: newValue });
      console.log("Increment heard from target: ", target);
      return newValue;
    },
    validate: (amount: number) => {
      if (amount < 0) throw new Error("Amount must be positive");
    },
  },
};
