import {
  ConfigItem,
  DerivedState,
  StateSubscriber,
  DerivedInstanceState,
  DerivedServiceState,
  ConnectReturn,
  UseCrann,
  ConnectionStatus,
  StateChangeUpdate,
} from "./model/crann.model";
import {
  AgentInfo,
  connect as connectPorter,
  PorterContext,
} from "porter-source";

let connectionStatus: ConnectionStatus = { connected: false };
let crannInstance: unknown = null;

export function connect<TConfig extends Record<string, ConfigItem<any>>>(
  config: TConfig,
  options?: { context?: string; debug?: boolean }
): ConnectReturn<TConfig> {
  const debug = options?.debug || false;
  const context = options?.context;
  let _myInfo: AgentInfo;
  let _myTag = "unset";
  const log = (message: string, ...args: any[]) => {
    if (debug) {
      console.log(`CrannAgent [${_myTag}] ` + message, ...args);
    }
  };

  const readyCallbacks = new Set<(info: ConnectionStatus) => void>();

  log("Initializing with context: ", context);
  if (crannInstance) {
    log("We had an instance already, returning");

    if (connectionStatus.connected) {
      console.log("[Crann:Agent] connect, calling onReady callback");
      setTimeout(() => {
        readyCallbacks.forEach((callback) => callback(connectionStatus));
      }, 0);
    }
    const instance = crannInstance as ConnectReturn<TConfig>;
    return [
      instance[0],
      instance[1],
      instance[2],
      instance[3],
      instance[4],
      (callback: (info: ConnectionStatus) => void) => {
        console.log("[Crann:Agent] connect, adding onReady callback");
        readyCallbacks.add(callback);
        return () => readyCallbacks.delete(callback);
      },
    ];
  }

  log("No existing instance, creating a new one");
  const [post, setMessages] = connectPorter({
    namespace: "crann",
  });

  setMessages({
    initialState: (message) => {
      _state = message.payload.state;
      _myInfo = message.payload.info;
      _myTag = getAgentTag(_myInfo);
      connectionStatus = { connected: true, agent: _myInfo };

      log(`Initial state received and  ${listeners.size} listeners notified`, {
        message,
      });
      readyCallbacks.forEach((callback) => callback(connectionStatus));
      listeners.forEach((listener) => {
        listener.callback(_state);
      });
    },
    stateUpdate: (message) => {
      changes = message.payload.state;
      _state = { ..._state, ...changes };
      log("State updated: ", { message, changes, _state });
      if (!changes) return;

      listeners.forEach((listener) => {
        if (listener.keys === undefined) {
          listener.callback(changes!);
        } else {
          const matchFound = listener.keys.some((key) => key in changes!);
          if (matchFound) {
            // log("Found a specific listener for this item, notifying");
            listener.callback(changes!);
          }
        }
      });
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
      callback: (update: StateChangeUpdate<TConfig, K>) => void
    ) => {
      let previousValue = getValue();

      return subscribe(
        (changes) => {
          if (key in changes) {
            const currentValue = getValue();
            const fullState = get();
            callback({
              current: currentValue,
              previous: previousValue,
              state: fullState,
            });
            previousValue = currentValue;
          }
        },
        [key]
      );
    };

    return [getValue(), setValue, subscribeToChanges];
  };

  const onReady = (callback: (info: ConnectionStatus) => void) => {
    readyCallbacks.add(callback);
    if (connectionStatus.connected) {
      console.log("[Crann:Agent], calling onReady callback");
      setTimeout(() => {
        callback(connectionStatus);
      }, 0);
    }
    return () => readyCallbacks.delete(callback);
  };

  const getAgentInfo = () => _myInfo;

  const instance: ConnectReturn<TConfig> = [
    useCrann,
    get,
    set,
    subscribe,
    getAgentInfo,
    onReady,
  ];
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
    if (item.partition === "service") {
      serviceState[key as keyof DerivedServiceState<TConfig>] = item.default;
    }
  });

  return {
    ...instanceState,
    ...serviceState,
  } as unknown as DerivedState<TConfig>;
}

function getAgentTag(info: AgentInfo): string {
  return `${info.location.context}:${info.location.tabId}:${info.location.frameId}`;
}
