import { AgentInfo, BrowserLocation } from "porter-source";

export const Partition = {
  Instance: "instance" as const,
  Service: "service" as const,
};

export const Persistence = {
  Session: "session" as const,
  Local: "local" as const,
  None: "none" as const,
};

export type ActionHandler<TState, TArgs extends any[], TResult> = (
  state: TState,
  setState: (newState: Partial<TState>) => Promise<void>,
  target: BrowserLocation,
  ...args: TArgs
) => Promise<TResult>;

export type ActionDefinition<TState, TArgs extends any[], TResult> = {
  handler: ActionHandler<TState, TArgs, TResult>;
  validate?: (...args: TArgs) => void;
};

export type ActionsConfig<TState> = {
  [K: string]: ActionDefinition<TState, any[], Partial<TState>>;
};

// Input types (what users provide in their config)
export type ConfigItem<T> = {
  default: T;
  partition?: (typeof Partition)[keyof typeof Partition];
  persist?: (typeof Persistence)[keyof typeof Persistence];
};

export type AnyConfig = Record<
  string,
  ConfigItem<any> | ActionDefinition<any, any[], any>
>;

// Helper type to extract just the state items from a config
export type StateConfig<T extends AnyConfig> = {
  [P in keyof T]: T[P] extends ConfigItem<any> ? T[P] : never;
};

// Helper type to extract just the action items from a config
export type ActionConfig<T extends AnyConfig> = {
  [P in keyof T]: T[P] extends ActionDefinition<any, any[], any> ? T[P] : never;
};

// Update DerivedState to use the internal types
export type DerivedState<T extends AnyConfig> = {
  [P in keyof T]: T[P] extends ConfigItem<infer DefaultType>
    ? DefaultType
    : never;
};

// Update DerivedInstanceState to use the internal types
export type DerivedInstanceState<T extends AnyConfig> = {
  [P in keyof T]: T[P] extends ConfigItem<infer DefaultType> & {
    partition: "instance";
  }
    ? DefaultType
    : never;
};

// Update DerivedServiceState to use the internal types
export type DerivedServiceState<T extends AnyConfig> = {
  [P in keyof T]: T[P] extends ConfigItem<infer DefaultType>
    ? T[P] extends { partition: "instance" }
      ? never
      : DefaultType
    : never;
};

// Type guards
export const isStateItem = <T>(
  item: ConfigItem<T> | ActionDefinition<any, any[], any>
): item is ConfigItem<T> => {
  return !("handler" in item);
};

export const isActionItem = <TState, TArgs extends any[], TResult>(
  item: ConfigItem<any> | ActionDefinition<TState, TArgs, TResult>
): item is ActionDefinition<TState, TArgs, TResult> => {
  return "handler" in item;
};

type StateSubscriber<TConfig extends AnyConfig> = {
  keys?: Array<keyof DerivedState<TConfig>>;
  callback: (changes: StateUpdate<TConfig>) => void;
};

type CrannAgent<TConfig extends AnyConfig> = {
  get: () => DerivedState<TConfig>;
  set: (update: StateUpdate<TConfig>) => void;
  subscribe: (
    callback: (changes: StateUpdate<TConfig>) => void,
    keys?: Array<keyof TConfig>
  ) => () => void;
  getAgentInfo: () => AgentInfo;
  onReady: (callback: (info: ConnectionStatus) => void) => () => void;
};

type UseCrann<TConfig extends AnyConfig> = <
  K extends keyof DerivedState<TConfig>
>(
  key: K
) => [
  DerivedState<TConfig>[K],
  (value: DerivedState<TConfig>[K]) => void,
  (callback: (update: StateChangeUpdate<TConfig, K>) => void) => () => void
];

type ConnectReturn<TConfig extends AnyConfig> = {
  useCrann: UseCrann<TConfig>;
  get: CrannAgent<TConfig>["get"];
  set: CrannAgent<TConfig>["set"];
  subscribe: CrannAgent<TConfig>["subscribe"];
  getAgentInfo: CrannAgent<TConfig>["getAgentInfo"];
  onReady: CrannAgent<TConfig>["onReady"];
  callAction: (name: string, ...args: any[]) => Promise<any>;
};

type StateChangeUpdate<
  TConfig extends AnyConfig,
  K extends keyof DerivedState<TConfig>
> = {
  current: DerivedState<TConfig>[K];
  previous: DerivedState<TConfig>[K];
  state: DerivedState<TConfig>;
};

type AgentSubscription<TConfig extends AnyConfig> = {
  (
    callback: (changes: StateUpdate<TConfig>) => void,
    key?: keyof DerivedState<TConfig>
  ): number;
};

type StateUpdate<TConfig extends AnyConfig> = Partial<DerivedState<TConfig>>;

export type CrannOptions = {
  debug?: boolean;
  storagePrefix?: string;
};

type ConnectionStatus = {
  connected: boolean;
  agent?: AgentInfo;
};

export type CrannConfig<TState> = {
  [K: string]: ConfigItem<any> | ActionsConfig<TState>;
};

export {
  StateSubscriber,
  CrannAgent,
  AgentSubscription,
  StateUpdate,
  DerivedState as State,
  ConnectReturn,
  UseCrann,
  ConnectionStatus,
  StateChangeUpdate,
};
