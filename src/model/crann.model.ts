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
};

type UseCrann<TConfig extends AnyConfig> = <
  K extends keyof DerivedState<TConfig>
>(
  key: K
) => [
  DerivedState<TConfig>[K],
  (value: DerivedState<TConfig>[K]) => void,
  (callback: (value: DerivedState<TConfig>[K]) => void) => () => void
];

type ConnectReturn<TConfig extends AnyConfig> = [
  UseCrann<TConfig>,
  CrannAgent<TConfig>["get"],
  CrannAgent<TConfig>["set"],
  CrannAgent<TConfig>["subscribe"]
];

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
};
