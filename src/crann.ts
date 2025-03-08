import browser from "webextension-polyfill";
import {
  DerivedInstanceState,
  DerivedServiceState,
  ConfigItem,
  DerivedState,
  Partition,
  CrannOptions,
} from "./model/crann.model";
import {
  AgentInfo,
  source,
  getAgentById,
  getAgentByLocation,
  MessageTarget,
} from "porter-source";
import { deepEqual } from "./utils/deepEqual";
import { Message, BrowserLocation } from "porter-source";
import { trackStateChange } from "./utils/tracking";
import { DebugManager } from "./utils/debug";

export class Crann<TConfig extends Record<string, ConfigItem<any>>> {
  private static instance: Crann<any> | null = null;
  private instances: Map<string, DerivedInstanceState<TConfig>> = new Map();
  private defaultServiceState: DerivedServiceState<TConfig>;
  private defaultInstanceState: DerivedInstanceState<TConfig>;
  private serviceState: DerivedServiceState<TConfig>;
  private stateChangeListeners: Array<
    (
      state: DerivedInstanceState<TConfig> | DerivedState<TConfig>,
      changes: Partial<
        DerivedServiceState<TConfig> & DerivedInstanceState<TConfig>
      >,
      agent?: AgentInfo
    ) => void
  > = [];
  private storagePrefix = "crann_";
  private post: (message: Message<any>, target?: MessageTarget) => void =
    () => {};
  private debug: boolean = false;

  constructor(private config: TConfig, options?: CrannOptions) {
    // Set the debug flag globally
    if (options?.debug) {
      DebugManager.setDebug(true);
    }
    this.debug = options?.debug || false;
    this.storagePrefix = options?.storagePrefix ?? this.storagePrefix;
    this.log("Constructing");
    this.defaultInstanceState = this.initializeInstanceDefault();
    this.defaultServiceState = this.serviceState =
      this.initializeServiceDefault();
    this.hydrate();
    const [post, setMessages, onConnect, onDisconnect, onMessagesSet] =
      source("crann");
    this.post = post;
    setMessages({
      setState: (message, info) => {
        if (!info) {
          this.log("setState message heard from unknown agent");
          return;
        }

        const agentTag = this.getAgentTag(info);
        this.instanceLog("Setting state: ", agentTag, message);
        this.set(message.payload.state, info.id);
      },
    });
    onMessagesSet((info: AgentInfo) => {
      this.instanceLog(
        "Messages set received. Sending initial state.",
        this.getAgentTag(info),
        { info }
      );
      const fullState = this.get(info.id);
      this.post(
        {
          action: "initialState",
          payload: { state: fullState, key: info.id },
        },
        info.location
      );
    });
    onConnect((info: AgentInfo) => {
      const agentTag = this.getAgentTag(info);
      this.instanceLog("Agent connected ", agentTag, { info });
      this.addInstance(info.id);
      onDisconnect((info: AgentInfo) => {
        this.instanceLog(
          "Agent disconnect heard. Connection type, context and location: ",
          this.getAgentTag(info),
          { info }
        );
        this.removeInstance(info.id);
      });
    });
  }

  public static getInstance<TConfig extends Record<string, ConfigItem<any>>>(
    config: TConfig,
    options?: CrannOptions
  ): Crann<TConfig> {
    if (!Crann.instance) {
      Crann.instance = new Crann(config, options);
    } else if (options?.debug) {
      console.log(
        "CrannSource [static-core], Instance requested and already existed, returning"
      );
    }
    return Crann.instance;
  }

  private async addInstance(key: string): Promise<void> {
    if (!this.instances.has(key)) {
      this.instanceLog("Adding instance from agent key: ", key);
      const initialInstanceState = {
        ...this.defaultInstanceState,
      } as DerivedInstanceState<TConfig>;
      this.instances.set(key, initialInstanceState);
    } else {
      this.instanceLog(
        "Instance was already registered, ignoring request from key: ",
        key
      );
    }
  }

  private async removeInstance(key: string): Promise<void> {
    if (this.instances.has(key)) {
      this.instanceLog("Remove instance requested. ", key);
      this.instances.delete(key);
    } else {
      this.instanceLog(
        "Remove instance requested but it did not exist!. ",
        key
      );
    }
  }

  @trackStateChange
  public async setServiceState(
    state: Partial<DerivedServiceState<TConfig>>
  ): Promise<void> {
    this.log("Request to set service state with: ", state);
    const update = { ...this.serviceState, ...state };
    if (!deepEqual(this.serviceState, update)) {
      this.log(
        "Confirmed new state was different than existing so proceeding to persist then notify all connected instances."
      );
      this.serviceState = update;
      await this.persist(state);
      this.notify(state as Partial<DerivedState<TConfig>>);
    } else {
      this.log("New state seems to be the same as existing, skipping");
    }
  }

  @trackStateChange
  public async setInstanceState(
    key: string,
    state: Partial<DerivedInstanceState<TConfig>>
  ): Promise<void> {
    this.instanceLog("Request to update instance state, update: ", key, state);
    const currentState = this.instances.get(key) || this.defaultInstanceState;
    const update = { ...currentState, ...state };
    if (!deepEqual(currentState, update)) {
      this.instanceLog(
        "Instance state update is different, updating and notifying. ",
        key
      );
      this.instances.set(key, update);
      this.notify(state as Partial<DerivedState<TConfig>>, key);
    } else {
      this.instanceLog(
        "Instance state update is not different, skipping update. ",
        key
      );
    }
  }

  // If we pass in specific state to persist, it only persists that state.
  // Otherwise persists all of the worker state.
  private async persist(
    state?: Partial<DerivedServiceState<TConfig>>
  ): Promise<void> {
    this.log("Persisting state");
    let wasPersisted = false;
    for (const key in state || this.serviceState) {
      const item = this.config[key] as ConfigItem<any>;
      const persistence = item.persist || "none";
      const value = state
        ? state[key as keyof DerivedServiceState<TConfig>]
        : this.serviceState[key];
      switch (persistence) {
        case "session":
          await browser.storage.session.set({
            [this.storagePrefix + (key as string)]: value,
          });
          wasPersisted = true;
          break;
        case "local":
          await browser.storage.local.set({
            [this.storagePrefix + (key as string)]: value,
          });
          wasPersisted = true;
          break;
        default:
          break;
      }
    }
    if (wasPersisted) {
      this.log("State was persisted");
    } else {
      this.log("Nothing to persist");
    }
  }

  public async clear(): Promise<void> {
    this.log("Clearing state");
    this.serviceState = this.defaultServiceState;
    this.instances.forEach((_, key) => {
      this.instances.set(key, this.defaultInstanceState);
    });
    await this.persist();
    this.notify({});
  }

  public subscribe(
    listener: (
      state: DerivedInstanceState<TConfig> | DerivedState<TConfig>,
      changes: Partial<
        DerivedInstanceState<TConfig> & DerivedServiceState<TConfig>
      >,
      agent?: AgentInfo
    ) => void
  ): void {
    this.log("Subscribing to state");
    this.stateChangeListeners.push(listener);
  }

  // Right now we notify the instance even if the state change came from the instance.
  // This should probably be skipped for instance state, since it already knows.
  private notify(changes: Partial<DerivedState<TConfig>>, key?: string): void {
    const agent = key ? getAgentById(key) : undefined;
    const state = key ? this.get(key) : this.get();

    if (this.stateChangeListeners.length > 0) {
      this.log("Notifying state change listeners in source");
      this.stateChangeListeners.forEach((listener) => {
        listener(state, changes, agent?.info);
      });
    }

    if (key && agent?.info.location) {
      this.instanceLog("Notifying of state change.", key);
      this.post(
        { action: "stateUpdate", payload: { state: changes } },
        agent.info.location
      );
    } else {
      console.log("Notifying everyone");
      // for every key of this.instances, post the state update to the corresponding key
      this.instances.forEach((_, key) => {
        this.post({ action: "stateUpdate", payload: { state: changes } }, key);
      });
    }
  }

  public get(): DerivedState<TConfig>;
  public get(
    key: string
  ): DerivedInstanceState<TConfig> & DerivedServiceState<TConfig>;
  public get(
    key?: string
  ): DerivedServiceState<TConfig> | DerivedState<TConfig> {
    if (!key) {
      return { ...this.serviceState, ...({} as DerivedInstanceState<TConfig>) };
    }
    return { ...this.serviceState, ...this.instances.get(key) };
  }

  // Todo: Should we return the instance data? What is the point of this.
  public findInstance(location: BrowserLocation): string | null {
    const agent = getAgentByLocation(location);
    if (!agent) {
      this.log("Could not find agent for location: ", { location });
      return null;
    }
    for (const [key, instance] of this.instances) {
      if (key === agent.info.id) {
        this.log("Found instance for key: ", key);
        return key;
      }
    }
    this.log("Could not find instance for context and location: ", {
      location,
    });
    return null;
  }

  public async set(state: Partial<DerivedServiceState<TConfig>>): Promise<void>;
  public async set(
    state: Partial<
      DerivedInstanceState<TConfig> & DerivedServiceState<TConfig>
    >,
    key: string
  ): Promise<void>;
  public async set(
    state: Partial<
      DerivedInstanceState<TConfig> | DerivedServiceState<TConfig>
    >,
    key?: string
  ): Promise<void> {
    const instance = {} as Partial<DerivedInstanceState<TConfig>>;
    const worker = {} as Partial<DerivedServiceState<TConfig>>;

    for (const itemKey in state) {
      const item = this.config[itemKey as keyof TConfig] as ConfigItem<any>;
      if (item.partition === "instance") {
        const instanceItemKey = itemKey as keyof DerivedInstanceState<TConfig>;
        const instanceState = state as Partial<DerivedInstanceState<TConfig>>;
        instance[instanceItemKey] = instanceState[instanceItemKey];
      } else if (!item.partition || item.partition === Partition.Service) {
        const serviceItemKey = itemKey as keyof DerivedServiceState<TConfig>;
        const serviceState = state as Partial<DerivedServiceState<TConfig>>;
        worker[serviceItemKey] = serviceState[serviceItemKey]!;
      }
    }
    if (key && Object.keys(instance).length > 0) {
      this.instanceLog("Setting instance state: ", key, instance);
      this.setInstanceState(key, instance);
    }
    if (Object.keys(worker).length > 0) {
      this.log("Setting service state: ", worker);
      this.setServiceState(worker);
    }
  }

  private async hydrate(): Promise<void> {
    this.log("Hydrating state from storage.");
    const local = await browser.storage.local.get(null);
    const session = await browser.storage.session.get(null);
    const combined = { ...local, ...session };
    const update: Partial<DerivedServiceState<TConfig>> = {}; // Cast update as Partial<DerivedState<TConfig>>
    let hadItems = false;
    for (const prefixedKey in combined) {
      const key = this.removePrefix(prefixedKey);
      if (this.config.hasOwnProperty(key)) {
        const value = combined[key];
        update[key as keyof DerivedServiceState<TConfig>] = value;
        hadItems = true;
      }
    }
    if (hadItems) {
      this.log("Hydrated some items.");
    } else {
      this.log("No items found in storage.");
    }
    this.serviceState = { ...this.defaultServiceState, ...update };
  }

  private removePrefix(key: string): string {
    if (key.startsWith(this.storagePrefix)) {
      return key.replace(this.storagePrefix, "");
    }
    return key;
  }

  private getAgentTag(agent: AgentInfo): string {
    return `${agent.location.context}:${agent.location.tabId}:${agent.location.frameId}`;
  }

  private initializeInstanceDefault(): DerivedInstanceState<TConfig> {
    const instanceState: any = {};
    Object.keys(this.config).forEach((key) => {
      const item: ConfigItem<any> = this.config[key];
      if (item.partition === "instance") {
        instanceState[key] = item.default;
      }
    });
    return instanceState;
  }

  private initializeServiceDefault(): DerivedServiceState<TConfig> {
    const serviceState: any = {};
    Object.keys(this.config).forEach((key) => {
      const item: ConfigItem<any> = this.config[key];
      if (item.partition === Partition.Service) {
        serviceState[key] = item.default;
      }
    });
    return serviceState;
  }

  private log(message: string, ...args: any[]) {
    if (this.debug) {
      console.log(`CrannSource [core], ` + message, ...args);
    }
  }
  private instanceLog(message: string, key: string, ...args: any[]) {
    if (this.debug) {
      console.log(`CrannSource [${key}], ` + message, ...args);
    }
  }
  private error(message: string, ...args: any[]) {
    console.error(`CrannSource [core], ` + message, ...args);
  }
  private warn(message: string, ...args: any[]) {
    console.warn(`CrannSource [core], ` + message, ...args);
  }
}

export function create<TConfig extends Record<string, ConfigItem<any>>>(
  config: TConfig,
  options?: CrannOptions
): [
  (key?: string) => DerivedState<TConfig>,
  (
    state: Partial<
      DerivedInstanceState<TConfig> & DerivedServiceState<TConfig>
    >,
    key?: string
  ) => Promise<void>,
  (
    listener: (
      state: DerivedInstanceState<TConfig> | DerivedState<TConfig>,
      changes: Partial<
        DerivedInstanceState<TConfig> & DerivedServiceState<TConfig>
      >,
      agent?: AgentInfo
    ) => void
  ) => void,
  (location: BrowserLocation) => string | null
] {
  const instance = Crann.getInstance(config, options);
  return [
    instance.get.bind(instance),
    instance.set.bind(instance),
    instance.subscribe.bind(instance),
    instance.findInstance.bind(instance),
  ];
}
