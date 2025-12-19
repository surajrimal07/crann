import browser from "webextension-polyfill";
import {
  DerivedInstanceState,
  DerivedServiceState,
  ConfigItem,
  DerivedState,
  Partition,
  CrannOptions,
  ActionDefinition,
  AnyConfig,
  isStateItem,
  isActionItem,
  SetStateCallback,
  SetStateFunction,
  StateChangeListener,
  StateChanges,
  MergeStateTypes,
} from "./model/crann.model";
import { AgentInfo, source, Agent } from "porter-source-fork";
import { deepEqual } from "./utils/deepEqual";
import { BrowserLocation } from "porter-source-fork";
import { trackStateChange } from "./utils/tracking";
import { DebugManager } from "./utils/debug";
import { createCrannRPCAdapter } from "./rpc/adapter";
import { Logger } from "./utils/logger";
import { getAgentTag } from "./utils/agent";

export class Crann<TConfig extends AnyConfig> {
  private static instance: Crann<any> | null = null;
  private instances: Map<string, DerivedInstanceState<TConfig>> = new Map();
  private defaultServiceState: DerivedServiceState<TConfig>;
  private defaultInstanceState: DerivedInstanceState<TConfig>;
  private serviceState: DerivedServiceState<TConfig>;
  private stateChangeListeners: Array<StateChangeListener<TConfig>> = [];
  private instanceReadyListeners: Array<
    (instanceId: string, agent: AgentInfo) => void
  > = [];
  private storagePrefix = "crann_";
  private porter = source("crann", { debug: false });
  private rpcEndpoint: ReturnType<typeof createCrannRPCAdapter>;
  private logger: Logger;

  constructor(private config: TConfig, options?: CrannOptions) {
    // Set the debug flag globally
    if (options?.debug) {
      DebugManager.setDebug(true);
      Logger.setDebug(true);
    }
    this.storagePrefix = options?.storagePrefix ?? this.storagePrefix;

    // Set up the core logger
    this.logger = Logger.forContext("Core");
    this.logger.log("Constructing Crann with new logger");

    // Hydrate the initial state from the config defaults and from storage
    this.defaultInstanceState = this.initializeInstanceDefault();
    this.defaultServiceState = this.serviceState =
      this.initializeServiceDefault();
    this.hydrate();

    // Set up the message handlers
    this.logger.log("Crann constructed, setting initial message handlers");
    this.porter.on({
      setState: (message, info) => {
        if (!info) {
          this.logger.warn("setState message heard from unknown agent");
          return;
        }

        const agentTag = getAgentTag(info);
        this.logger.withTag(agentTag).log("Setting state:", message);
        this.set(message.payload.state, info.id);
      },
    });

    // Track which agents we've already sent initialState to
    const agentsInitialized = new Set<string>();

    // Once the agents are connected and have set up their listeners, send them the initial state
    this.porter.onMessagesSet((info: AgentInfo) => {
      if (!info) {
        this.logger.error("Messages set but no agent info.", { info });
        return;
      }

      const agentTag = getAgentTag(info);
      this.logger.withTag(agentTag).log("onMessagesSet received for agent:", {
        id: info.id,
        context: info.location.context,
        tabId: info.location.tabId,
        frameId: info.location.frameId,
        alreadyInitialized: agentsInitialized.has(info.id),
      });

      // Skip sending initialState if we've already sent it to this agent
      if (agentsInitialized.has(info.id)) {
        this.logger
          .withTag(agentTag)
          .log("Already sent initialState to agent, skipping:", info.id);
        return;
      }

      // Add the agent to the set of agents we've already sent initialState to
      agentsInitialized.add(info.id);

      this.logger
        .withTag(agentTag)
        .log("Messages set received. Sending initial state.", { info });
      const fullState = this.get(info.id);
      this.porter.post(
        {
          action: "initialState",
          payload: { state: fullState, info },
        },
        info.location
      );

      this.notifyInstanceReady(info.id, info);
    });

    // Handle agent connection and disconnection
    this.porter.onConnect((info: AgentInfo) => {
      if (!info) {
        this.logger.error("Agent connected but no agent info.", { info });
        return;
      }
      const agentTag = getAgentTag(info);
      this.logger.withTag(agentTag).log("Agent connected", { info });
      this.addInstance(info.id, agentTag);
      this.porter.onDisconnect((info: AgentInfo) => {
        this.logger
          .withTag(getAgentTag(info))
          .log(
            "Agent disconnect heard. Connection type, context and location:",
            { info }
          );
        this.removeInstance(info.id);
      });
    });

    const setStateCallback: SetStateCallback<TConfig> = ((
      state: any,
      key?: string
    ) => {
      if (key !== undefined) {
        return this.set(state, key);
      } else {
        return this.set(state);
      }
    }) as SetStateCallback<TConfig>;

    // Cast to the generic version when passing to RPC adapter
    const genericSetState = setStateCallback as SetStateFunction<
      DerivedState<TConfig>
    >;

    // Initialize RPC with actions
    const actions = this.extractActions(config);

    const stateGetter = () => {
      const currentState = this.get();
      this.logger.log(
        "State getter called, returning current state:",
        currentState
      );
      return currentState;
    };

    this.rpcEndpoint = createCrannRPCAdapter(
      stateGetter,
      actions,
      this.porter,
      genericSetState
    );
  }

  public static getInstance<TConfig extends AnyConfig>(
    config: TConfig,
    options?: CrannOptions
  ): Crann<TConfig> {
    if (!Crann.instance) {
      Crann.instance = new Crann(config, options);
    } else if (options?.debug) {
      const logger = Logger.forContext("Core");
      logger.log("Instance requested and already existed, returning");
    }
    return Crann.instance;
  }

  /**
   * Add an instance to the Crann instance.
   * @param key The key of the instance to add.
   * @param agentTag The tag of the agent that is adding the instance, for logging.
   */
  private async addInstance(key: string, agentTag: string): Promise<void> {
    if (!this.instances.has(key)) {
      this.logger.withTag(agentTag).log("Adding instance from agent key");
      const initialInstanceState = {
        ...this.defaultInstanceState,
      } as DerivedInstanceState<TConfig>;
      this.instances.set(key, initialInstanceState);
    } else {
      this.logger
        .withTag(agentTag)
        .log("Instance was already registered, ignoring request from key");
    }
  }

  private async removeInstance(key: string): Promise<void> {
    if (this.instances.has(key)) {
      this.logger.withTag(key).log("Remove instance requested");
      this.instances.delete(key);
    } else {
      this.logger
        .withTag(key)
        .log("Remove instance requested but it did not exist!");
    }
  }

  @trackStateChange
  public async setServiceState(
    state: Partial<DerivedServiceState<TConfig>>
  ): Promise<void> {
    this.logger.log("Request to set service state with update:", state);
    this.logger.log("Existing service state was ", this.serviceState);
    const update = { ...this.serviceState, ...state };
    if (!deepEqual(this.serviceState, update)) {
      this.logger.log(
        "Confirmed new state was different than existing so proceeding to persist then notify all connected instances."
      );
      this.serviceState = update;
      await this.persist(state);
      this.notify(state as StateChanges<TConfig>);
    } else {
      this.logger.log("New state seems to be the same as existing, skipping");
    }
  }

  @trackStateChange
  public async setInstanceState(
    key: string,
    state: Partial<DerivedInstanceState<TConfig>>
  ): Promise<void> {
    this.logger
      .withTag(key)
      .log("Request to update instance state, update:", state);
    const currentState = this.instances.get(key) || this.defaultInstanceState;
    const update = { ...currentState, ...state };
    if (!deepEqual(currentState, update)) {
      this.logger
        .withTag(key)
        .log("Instance state update is different, updating and notifying.");
      this.instances.set(key, update);
      this.notify(state as StateChanges<TConfig>, key);
    } else {
      this.logger
        .withTag(key)
        .log("Instance state update is not different, skipping update.");
    }
  }

  // If we pass in specific state to persist, it only persists that state.
  // Otherwise persists all of the worker state.
  private async persist(
    state?: Partial<DerivedServiceState<TConfig>>
  ): Promise<void> {
    this.logger.log("Persisting state");
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
      this.logger.log("State was persisted");
    } else {
      this.logger.log("Nothing to persist");
    }
  }

  public async clear(): Promise<void> {
    this.logger.log("Clearing state");
    this.serviceState = this.defaultServiceState;
    this.instances.forEach((_, key) => {
      this.instances.set(key, this.defaultInstanceState);
    });
    await this.persist();
    this.notify({} as StateChanges<TConfig>);
  }

  public subscribe(listener: StateChangeListener<TConfig>): void {
    this.logger.log("Subscribing to state");
    this.stateChangeListeners.push(listener);
  }

  // Right now we notify the instance even if the state change came from the instance.
  // This should probably be skipped for instance state, since it already knows.
  private notify(changes: StateChanges<TConfig>, key?: string): void {
    const agent = key ? this.porter.getAgentById(key) : undefined;
    const state = key ? this.get(key) : this.get();

    if (this.stateChangeListeners.length > 0) {
      this.logger.log("Notifying state change listeners in source");
      this.stateChangeListeners.forEach((listener) => {
        listener(state, changes, agent?.info);
      });
    }

    if (key && agent?.info.location) {
      this.logger.withTag(key).log("Notifying of state change.");
      this.porter.post(
        { action: "stateUpdate", payload: { state: changes } },
        agent.info.location
      );
    } else {
      this.logger.log("Notifying everyone");
      // for every key of this.instances, post the state update to the corresponding key
      this.instances.forEach((_, key) => {
        this.porter.post(
          { action: "stateUpdate", payload: { state: changes } },
          key
        );
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


  // Convenience re-export of the porter-source queryAgents method.
  public queryAgents(query: Partial<BrowserLocation>): Agent[] {
    return this.porter.queryAgents(query);
  }

  public async set(state: Partial<DerivedServiceState<TConfig>>): Promise<void>;
  public async set(
    state: Partial<
      MergeStateTypes<
        DerivedInstanceState<TConfig>,
        DerivedServiceState<TConfig>
      >
    >,
    key: string
  ): Promise<void>;
  public async set(
    state:
      | Partial<DerivedServiceState<TConfig>>
      | Partial<
          MergeStateTypes<
            DerivedInstanceState<TConfig>,
            DerivedServiceState<TConfig>
          >
        >,
    key?: string
  ): Promise<void> {
    const instance = {} as Partial<DerivedInstanceState<TConfig>>;
    const worker = {} as Partial<DerivedServiceState<TConfig>>;

    for (const itemKey in state) {
      const item = this.config[itemKey as keyof TConfig];
      if (isConfigItem(item)) {
        if (item.partition === "instance") {
          const instanceItemKey =
            itemKey as keyof DerivedInstanceState<TConfig>;
          const instanceState = state as Partial<DerivedInstanceState<TConfig>>;
          instance[instanceItemKey] = instanceState[instanceItemKey];
        } else if (!item.partition || item.partition === Partition.Service) {
          const serviceItemKey = itemKey as keyof DerivedServiceState<TConfig>;
          const serviceState = state as Partial<DerivedServiceState<TConfig>>;
          worker[serviceItemKey] = serviceState[serviceItemKey]!;
        }
      }
    }

    if (key && Object.keys(instance).length > 0) {
      this.logger.withTag(key).log("Setting instance state:", instance);
      this.setInstanceState(key, instance);
    }
    if (Object.keys(worker).length > 0) {
      this.logger.log("Setting service state:", worker);
      this.setServiceState(worker);
    }
  }

  private async hydrate(): Promise<void> {
    this.logger.log("Hydrating state from storage.");
    const local = await browser.storage.local.get(null);
    const session = await browser.storage.session.get(null);
    const combined = { ...local, ...session };

    this.logger.log("Storage data is:", { local, session, combined });

    const update: Partial<DerivedServiceState<TConfig>> = {}; // Cast update as Partial<DerivedState<TConfig>>
    let hadItems = false;
    for (const prefixedKey in combined) {
      const key = this.removePrefix(prefixedKey);
      this.logger.log(`Checking storage key ${prefixedKey} -> ${key}`);

      if (this.config.hasOwnProperty(key)) {
        const value = combined[prefixedKey];

        this.logger.log(`Found storage value for ${key}:`, value);
        update[key as keyof DerivedServiceState<TConfig>] = value;
        hadItems = true;
      }
    }
    if (hadItems) {
      this.logger.log("Hydrated some items.");
    } else {
      this.logger.log("No items found in storage.");
    }
    this.serviceState = { ...this.defaultServiceState, ...update };
  }

  private removePrefix(key: string): string {
    if (key.startsWith(this.storagePrefix)) {
      return key.replace(this.storagePrefix, "");
    }
    return key;
  }

  private initializeInstanceDefault(): DerivedInstanceState<TConfig> {
    const instanceState: any = {};
    Object.keys(this.config).forEach((key) => {
      const item = this.config[key];
      if (isStateItem(item) && item.partition === "instance") {
        instanceState[key] = item.default;
      }
    });
    return instanceState;
  }

  private initializeServiceDefault(): DerivedServiceState<TConfig> {
    this.logger.log("Initializing service default state");
    this.logger.log("Config is:", this.config);

    const serviceState: any = {};
    Object.keys(this.config).forEach((key) => {
      const item = this.config[key];
      this.logger.log("Item is:", item);
      if (
        isStateItem(item) &&
        (!item.partition || item.partition === Partition.Service)
      ) {
        serviceState[key] = item.default;
        this.logger.log(
          "Setting service state for key:",
          key,
          "to",
          item.default
        );
      }
    });
    this.logger.log("Final service state is:", serviceState);
    return serviceState;
  }

  public subscribeToInstanceReady(
    listener: (instanceId: string, agent: AgentInfo) => void
  ): () => void {
    this.logger.log("Subscribing to instance ready events");
    this.instanceReadyListeners.push(listener);

    this.instances.forEach((_, instanceId) => {
      const agent = this.porter.getAgentById(instanceId);
      if (agent?.info) {
        listener(instanceId, agent.info);
      }
    });

    return () => {
      this.logger.log("Unsubscribing from instance ready events");
      const index = this.instanceReadyListeners.indexOf(listener);
      if (index !== -1) {
        this.instanceReadyListeners.splice(index, 1);
      }
    };
  }

  private notifyInstanceReady(instanceId: string, info: AgentInfo): void {
    if (this.instanceReadyListeners.length > 0) {
      const agentTag = getAgentTag(info);
      this.logger.withTag(agentTag).log("Notifying instance ready listeners");
      this.instanceReadyListeners.forEach((listener) => {
        listener(instanceId, info);
      });
    }
  }

  private extractActions(
    config: TConfig
  ): Record<string, ActionDefinition<DerivedState<TConfig>, any[], any>> {
    return Object.entries(config)
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
          [key]: action,
        };
      }, {});
  }
}

// Define an interface for the API returned by create()
export interface CrannAPI<TConfig extends AnyConfig> {
  get: {
    (): DerivedState<TConfig>;
    (key: string): DerivedInstanceState<TConfig> & DerivedServiceState<TConfig>;
  };
  set: {
    (state: Partial<DerivedServiceState<TConfig>>): Promise<void>;
    (
      state: Partial<
        MergeStateTypes<
          DerivedInstanceState<TConfig>,
          DerivedServiceState<TConfig>
        >
      >,
      key: string
    ): Promise<void>;
  };
  subscribe: (listener: StateChangeListener<TConfig>) => void;
  onInstanceReady: (
    listener: (instanceId: string, agent: AgentInfo) => void
  ) => () => void;
  queryAgents: (query: Partial<BrowserLocation>) => Agent[];
  clear: () => Promise<void>;
}

export function create<TConfig extends AnyConfig>(
  config: TConfig,
  options?: CrannOptions
): CrannAPI<TConfig> {
  const instance = Crann.getInstance(config, options);

  return {
    get: instance.get.bind(instance),
    set: instance.set.bind(instance),
    subscribe: instance.subscribe.bind(instance),
    onInstanceReady: instance.subscribeToInstanceReady.bind(instance),
    queryAgents: instance.queryAgents.bind(instance),
    clear: instance.clear.bind(instance),
  };
}

function isConfigItem(item: any): item is ConfigItem<any> {
  return item && typeof item === "object" && "default" in item;
}
