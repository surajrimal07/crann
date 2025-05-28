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
  ActionDefinition,
  AnyConfig,
  isStateItem,
  isActionItem,
} from "./model/crann.model";
import {
  AgentInfo,
  connect as connectPorter,
  PorterContext,
} from "porter-source";
import { createCrannRPCAdapter } from "./rpc/adapter";
import { Logger } from "./utils/logger";

let connectionStatus: ConnectionStatus = { connected: false };
let crannInstance: unknown = null;

export function connect<TConfig extends AnyConfig>(
  config: TConfig,
  options?: { context?: string; debug?: boolean }
): ConnectReturn<TConfig> {
  const debug = options?.debug || false;
  const context = options?.context;

  // Set up logger
  if (debug) {
    Logger.setDebug(true);
  }
  const logger = Logger.forContext("Agent");
  logger.log("Testing new logger in crannAgent");

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
    return crannInstance as ConnectReturn<TConfig>;
  }

  log("No existing instance, creating a new one");
  const porter = connectPorter({
    namespace: "crann",
  });

  console.log("[DEBUG] Porter connection created");

  // Initialize RPC with empty actions since this is the client side
  const actions = Object.entries(config)
    .filter(([_, value]) => isActionItem(value))
    .reduce<
      Record<string, ActionDefinition<DerivedState<TConfig>, any[], any>>
    >((acc, [key, value]) => {
      const action = value as ActionDefinition<
        DerivedState<TConfig>,
        any[],
        any
      >;
      return {
        ...acc,
        [key]: {
          type: "action",
          handler: action.handler,
          validate: action.validate,
        },
      };
    }, {});

  const rpcEndpoint = createCrannRPCAdapter(
    getDerivedState(config),
    actions,
    porter
  );

  let initialStateReceived = false;

  porter.on({
    initialState: (message) => {
      console.log("[DEBUG] initialState received", {
        alreadyReceived: initialStateReceived,
        payload: message.payload,
      });

      if (initialStateReceived) {
        console.log("[DEBUG] Ignoring duplicate initialState message");
        return;
      }

      initialStateReceived = true;

      _state = message.payload.state;
      _myInfo = message.payload.info;
      _myTag = getAgentTag(_myInfo);
      connectionStatus = { connected: true, agent: _myInfo };

      // Update logger with the agent tag once we have it
      logger.setTag(_myTag);
      logger.log(
        `Initial state received and ${listeners.size} listeners notified`,
        {
          message,
        }
      );

      log(`Initial state received and  ${listeners.size} listeners notified`, {
        message,
      });

      readyCallbacks.forEach((callback) => {
        console.log("Calling onReady callbacks");
        callback(connectionStatus);
      });
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
    porter.post({ action: "setState", payload: { state: newState } });
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
    const getValue = () => {
      const value = get()[key];
      return value as TConfig[K] extends ConfigItem<any>
        ? TConfig[K]["default"]
        : never;
    };

    const setValue = (
      value: TConfig[K] extends ConfigItem<any> ? TConfig[K]["default"] : never
    ) => set({ [key]: value } as Partial<DerivedState<TConfig>>);

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
            } as StateChangeUpdate<TConfig, K>);
            previousValue = currentValue;
          }
        },
        [key]
      );
    };

    return [getValue(), setValue, subscribeToChanges];
  };

  const onReady = (callback: (info: ConnectionStatus) => void) => {
    console.log("[Crann:Agent], onReady callback added");
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

  const callAction = async (name: string, ...args: any[]) => {
    console.log("MOC Calling action", name, args);
    return (rpcEndpoint as any)[name](...args);
  };

  const instance = {
    useCrann,
    get,
    set,
    subscribe,
    getAgentInfo,
    onReady,
    callAction,
  };

  crannInstance = instance;

  return crannInstance as ConnectReturn<TConfig>;
}

export function connected(): boolean {
  return crannInstance !== null;
}

function getDerivedState<TConfig extends AnyConfig>(
  config: TConfig
): DerivedState<TConfig> {
  const state: any = {};
  Object.keys(config).forEach((key) => {
    const item = config[key];
    if (isStateItem(item)) {
      state[key] = item.default;
    }
  });
  return state;
}

function getAgentTag(agent: AgentInfo): string {
  return `${agent.location.context}:${agent.location.tabId}:${agent.location.frameId}`;
}
