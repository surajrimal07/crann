import {
  ConfigItem,
  DerivedState,
  StateSubscriber,
  ConnectReturn,
  UseCrann,
  ConnectionStatus,
  StateChangeUpdate,
  ActionDefinition,
  AnyConfig,
  isStateItem,
  isActionItem,
  StateChanges,
} from './model/crann.model';
import { AgentInfo, connect as connectPorter } from 'porter-source-fork';
import { createCrannRPCAdapter } from './rpc/adapter';
import { Logger } from './utils/logger';
import { getAgentTag } from './utils/agent';

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
  const logger = Logger.forContext('Agent');

  let connectionStatus: ConnectionStatus = { connected: false };
  let _myInfo: AgentInfo;
  let _myTag = 'unset';
  const readyCallbacks = new Set<(info: ConnectionStatus) => void>();

  logger.log(
    'Initializing Crann Agent' + (context ? ` with context: ${context}` : '')
  );

  logger.log('No existing instance, creating a new one');
  const porter = connectPorter({
    namespace: 'crann',
    debug: false,
  });

  logger.log('Porter connection created');

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
          type: 'action',
          handler: action.handler,
          validate: action.validate,
        },
      };
    }, {});

  const rpcEndpoint = createCrannRPCAdapter(
    () => getDerivedState(config),
    actions,
    porter
  );

  let initialStateReceived = false;

  porter.on({
    initialState: (message) => {
      logger.log('initialState received', {
        alreadyReceived: initialStateReceived,
        payload: message.payload,
      });

      if (initialStateReceived) {
        logger.log('Ignoring duplicate initialState message');
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
      readyCallbacks.forEach((callback) => {
        logger.log('Calling onReady callbacks');
        callback(connectionStatus);
      });
      listeners.forEach((listener) => {
        listener.callback(_state as StateChanges<TConfig>);
      });
    },
    stateUpdate: (message) => {
      changes = message.payload.state;
      _state = { ..._state, ...changes };
      logger.log('State updated:', { message, changes, _state });
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
  logger.log('Porter connected. Setting up state and listeners');
  let _state = getDerivedState(config);
  let changes: StateChanges<TConfig> | null = null;
  const listeners = new Set<StateSubscriber<TConfig>>();

  logger.log('Completed setup, returning instance');

  const get = () => _state;
  const set = (newState: StateChanges<TConfig>) => {
    logger.log('Calling post with setState', newState);
    porter.post({ action: 'setState', payload: { state: newState } });
  };

  const subscribe = (
    callback: (changes: StateChanges<TConfig>) => void,
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
        ? TConfig[K]['default']
        : never;
    };

    const setValue = (
      value: TConfig[K] extends ConfigItem<any> ? TConfig[K]['default'] : never
    ) => set({ [key]: value } as StateChanges<TConfig>);

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
    logger.log('onReady callback added');
    readyCallbacks.add(callback);
    if (connectionStatus.connected) {
      logger.log('calling onReady callback');
      setTimeout(() => {
        callback(connectionStatus);
      }, 0);
    }
    return () => readyCallbacks.delete(callback);
  };

  const getAgentInfo = () => _myInfo;

  const callAction = async (name: string, ...args: any[]) => {
    logger.log('Calling action', name, args);
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

  return instance as ConnectReturn<TConfig>;
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
