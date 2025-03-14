import { AgentInfo } from "porter-source";

export const Partition = {
  Instance: "instance" as const,
  Service: "service" as const,
};

export const Persistence = {
  Session: "session" as const,
  Local: "local" as const,
  None: "none" as const,
};

type ConfigItem<T> = {
  default: T;
  partition?: (typeof Partition)[keyof typeof Partition];
  persist?: (typeof Persistence)[keyof typeof Persistence];
};

type AnyConfig = Record<string, ConfigItem<any>>;

type DerivedState<T extends AnyConfig> = {
  [P in keyof T]: T[P]["default"];
};

type DerivedInstanceState<T extends AnyConfig> = {
  [P in keyof T as T[P]["partition"] extends "instance"
    ? P
    : never]: T[P]["default"];
};

type DerivedServiceState<T extends AnyConfig> = {
  [P in keyof T as T[P]["partition"] extends "service"
    ? P
    : never]: T[P]["default"];
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

type ConnectReturn<TConfig extends AnyConfig> = [
  UseCrann<TConfig>,
  CrannAgent<TConfig>["get"],
  CrannAgent<TConfig>["set"],
  CrannAgent<TConfig>["subscribe"],
  CrannAgent<TConfig>["getAgentInfo"],
  CrannAgent<TConfig>["onReady"]
];

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

export {
  AnyConfig,
  ConfigItem,
  DerivedState,
  DerivedInstanceState,
  DerivedServiceState,
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
