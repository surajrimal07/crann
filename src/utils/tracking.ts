import { isDebugEnabled } from "./debug";

export type StateChangeMetadata = {
  source: string;
  timestamp: number;
  changes: any;
  instanceKey?: string;
};

export function trackStateChange(
  target: any,
  propertyKey: string,
  descriptor: PropertyDescriptor
): PropertyDescriptor {
  const originalMethod = descriptor.value;

  descriptor.value = function (...args: any[]) {
    // Only log if debugging is enabled
    if (isDebugEnabled()) {
      // Get the stack trace to find the actual caller
      const stack = new Error().stack;
      const lines = stack?.split("\n") || [];
      const callerMatch = lines[3]?.match(/at\s+(\S+)\s+/);
      const caller = callerMatch ? callerMatch[1] : "unknown";

      const changes = args.length > 1 ? args[1] : undefined;

      const metadata: StateChangeMetadata = {
        source: caller,
        timestamp: Date.now(),
        instanceKey: args[0],
        changes,
      };

      console.log(`Crann State Change:`, metadata);
    }
    return originalMethod.apply(this, args);
  };

  return descriptor;
}
