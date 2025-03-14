import {
  ConfigItem,
  DerivedState,
  StateSubscriber,
  DerivedInstanceState,
  DerivedServiceState,
  ConnectReturn,
  UseCrann,
} from "./model/crann.model";
import { connect as connectPorter, PorterContext } from "porter-source";

let crannInstance: unknown = null;

export function connect<TConfig extends Record<string, ConfigItem<any>>>(
  config: TConfig,
  options?: { context?: string; debug?: boolean }
): ConnectReturn<TConfig> {
  const debug = options?.debug || false;
  const context = options?.context;
  let _myKey = "unset";
  const log = (message: string, ...args: any[]) => {
    if (debug) {
      console.log(`CrannAgent [${_myKey}] ` + message, ...args);
    }
  };
  log("Initializing with context: ", context);
  if (crannInstance) {
    log("We had an instance already, returning");
    return crannInstance as ConnectReturn<TConfig>;
  }
  log("No existing instance, creating a new one");
  const [post, setMessages] = connectPorter({
    namespace: "crann",
    agentContext: context as PorterContext,
  });
  setMessages({
    initialState: (message) => {
      _state = message.payload.state;
      _myKey = message.payload.key;
      listeners.forEach((listener) => {
        listener.callback(_state);
      });
      log(`Initial state received and  ${listeners.size} listeners notified`);
    },
    stateUpdate: (message) => {
      log("State updated: ", message);
      changes = message.payload.state;
      _state = { ..._state, ...changes };
      if (!!changes) {
        log("Notifying listeners of state update");
        listeners.forEach((listener) => {
          if (listener.keys === undefined) {
            log("Found a universal listener, notifying");
            listener.callback(changes!);
          } else {
            const matchFound = listener.keys.some((key) =>
              changes!.hasOwnProperty(key)
            );
            if (matchFound) {
              log("Found a specific listener for this item, notifying");
              listener.callback(changes!);
            }
          }
        });
      }
    },
  });
  log("Porter connected. Setting up state and listeners");
  let _state = getDerivedState(config);
  let changes: Partial<DerivedState<TConfig>> | null = null;
  const listeners = new Set<StateSubscriber<TConfig>>();

  log("Completed setup, returning instance");

  const get = () => _state;
  const set = (newState: Partial<DerivedState<TConfig>>) => {
    console.log("CrannAgent, calling post with setState");
    post({ action: "setState", payload: { state: newState } });
  };
  const subscribe = (
    callback: (changes: Partial<DerivedState<TConfig>>) => void,
    keys?: Array<keyof DerivedState<TConfig>>
  ): (() => void) => {
    const listener = { keys, callback };
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };

  const useCrann: UseCrann<TConfig> = <K extends keyof DerivedState<TConfig>>(
    key: K
  ) => {
    const getValue = () => get()[key] as DerivedState<TConfig>;
    const setValue = (value: DerivedState<TConfig>[K]) =>
      set({ [key]: value } as Partial<DerivedState<TConfig>>);
    const subscribeToChanges = (
      callback: (value: DerivedState<TConfig>[K]) => void
    ) => {
      return subscribe(
        (changes) => {
          if (key in changes) {
            callback(changes[key] as DerivedState<TConfig>[K]);
          }
        },
        [key]
      );
    };

    return [getValue(), setValue, subscribeToChanges];
  };

  const instance: ConnectReturn<TConfig> = [useCrann, get, set, subscribe];
  crannInstance = instance;

  return crannInstance as ConnectReturn<TConfig>;
}

export function connected(): boolean {
  return crannInstance !== null;
}

function getDerivedState<TConfig extends Record<string, ConfigItem<any>>>(
  config: TConfig
): DerivedState<TConfig> {
  const instanceState = {} as DerivedInstanceState<TConfig>;

  Object.keys(config).forEach((key) => {
    const item: ConfigItem<any> = config[key];
    if (item.partition === "instance") {
      instanceState[key as keyof DerivedInstanceState<TConfig>] = item.default;
    }
  });

  const serviceState = {} as DerivedServiceState<TConfig>;
  Object.keys(config).forEach((key) => {
    const item: ConfigItem<any> = config[key];
    if (item.partition === "instance") {
      serviceState[key as keyof DerivedServiceState<TConfig>] = item.default;
    }
  });

  return {
    ...instanceState,
    ...serviceState,
  } as unknown as DerivedState<TConfig>;
}
