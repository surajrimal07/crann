import browser from 'webextension-polyfill';
import { DerivedInstanceState, DerivedCommonState, ConfigItem, DerivedState, Partition } from './model/crann.model';
import { source, getMetadata, getKey, getTarget } from 'porter-source';
import { deepEqual } from './utils/deepEqual';
import { AgentLocation, AgentMetadata, Message, PorterContext, PostTarget } from 'porter-source';

export class Crann<TConfig extends Record<string, ConfigItem<any>>> {
    private static instance: Crann<any> | null = null;
    private instances: Map<string, DerivedInstanceState<TConfig>> = new Map();
    private defaultCommonState: DerivedCommonState<TConfig>;
    private defaultInstanceState: DerivedInstanceState<TConfig>;
    private commonState: DerivedCommonState<TConfig>;
    private stateChangeListeners: Array<(state: (DerivedInstanceState<TConfig> | DerivedState<TConfig>), changes: Partial<DerivedCommonState<TConfig> & DerivedInstanceState<TConfig>>, agent?: AgentMetadata) => void> = [];
    private storagePrefix = 'crann_';
    private post: (message: Message<any>, target?: PostTarget) => void = () => { };

    constructor(private config: TConfig, storagePrefix?: string) {
        this.log('Constructing');
        this.defaultInstanceState = this.initializeInstanceDefault();
        this.defaultCommonState = this.commonState = this.initializeCommonDefault();
        this.hydrate();
        this.log('Initializing porter');
        const [post, setMessages, onConnect, onDisconnect, onMessagesSet] = source('crann');
        this.post = post;
        setMessages({
            setState: (message, agent) => {
                if (!agent) {
                    this.log('setState message heard from unknown agent');
                    return;
                }
                this.instanceLog('Setting state: ', agent.key, message);
                this.set(message.payload.state, agent.key);
            }
        });
        onMessagesSet((agent) => {
            this.instanceLog('Messages set received. Sending initial state.', agent.key, agent);
            const fullState = this.get(agent.key);
            this.post({ action: 'initialState', payload: { state: fullState, key: agent.key } }, agent.key);
        });
        onConnect(({ key, connectionType, context, location }) => {
            this.instanceLog('Agent connected. Connection type, context and location: ', key, connectionType, context, location);
            this.addInstance(key);
            onDisconnect(({ key, connectionType, context, location }) => {
                this.instanceLog('Agent disconnect heard. Connection type, context and location: ', key, connectionType, context, location);
                this.removeInstance(key);
            });
        });
        this.storagePrefix = storagePrefix ?? this.storagePrefix;
    }


    public static getInstance<TConfig extends Record<string, ConfigItem<any>>>(config: TConfig, storagePrefix?: string): Crann<TConfig> {
        if (!Crann.instance) {
            Crann.instance = new Crann(config, storagePrefix);
        } else {
            console.log('CrannSource [static-core], Instance requested and already existed, returning');
        }
        return Crann.instance;
    }

    private async addInstance(key: string): Promise<void> {
        if (!this.instances.has(key)) {
            this.instanceLog('Adding instance from agent key: ', key);
            const initialInstanceState = { ...this.defaultInstanceState } as DerivedInstanceState<TConfig>;
            this.instances.set(key, initialInstanceState);
        } else {
            this.instanceLog('Instance was already registered, ignoring request from key: ', key);
        }
    }

    private async removeInstance(key: string): Promise<void> {
        if (this.instances.has(key)) {
            this.instanceLog('Remove instance requested. ', key);
            this.instances.delete(key);
        } else {
            this.instanceLog('Remove instance requested but it did not exist!. ', key);
        }
    }

    public async setCommonState(state: Partial<DerivedCommonState<TConfig>>): Promise<void> {
        this.log('Request to set common state with: ', state);
        const update = { ...this.commonState, ...state };
        if (!deepEqual(this.commonState, update)) {
            this.log('Confirmed new state was different than existing so proceeding to persist then notify all connected instances.');
            this.commonState = update;
            await this.persist(state);
            this.notify(state as Partial<DerivedState<TConfig>>);
        } else {
            this.log('New state seems to be the same as existing, skipping');
        }
    }

    public async setInstanceState(key: string, state: Partial<DerivedInstanceState<TConfig>>): Promise<void> {
        this.instanceLog('Request to update instance state, update: ', key, state);
        const currentState = this.instances.get(key) || this.defaultInstanceState;
        const update = { ...currentState, ...state };
        if (!deepEqual(currentState, update)) {
            this.instanceLog('Instance state update is different, updating and notifying. ', key);
            this.instances.set(key, update);
            this.notify(state as Partial<DerivedState<TConfig>>, key);
        } else {
            this.instanceLog('Instance state update is not different, skipping update. ', key);
        }
    }

    // If we pass in specific state to persist, it only persists that state. 
    // Otherwise persists all of the worker state.
    private async persist(state?: Partial<DerivedCommonState<TConfig>>): Promise<void> {
        this.log('Persisting state');
        let wasPersisted = false;
        for (const key in (state || this.commonState)) {
            const item = this.config[key] as ConfigItem<any>;
            const persistence = item.persist || 'none';
            const value = state ? state[key as keyof DerivedCommonState<TConfig>] : this.commonState[key];
            switch (persistence) {
                case 'session':
                    await browser.storage.session.set({ [this.storagePrefix + (key as string)]: value });
                    wasPersisted = true;
                    break;
                case 'local':
                    await browser.storage.local.set({ [this.storagePrefix + (key as string)]: value });
                    wasPersisted = true;
                    break;
                default:
                    break;
            }
        }
        if (wasPersisted) {
            this.log('State was persisted');
        } else {
            this.log('Nothing to persist');
        }
    }

    public async clear(): Promise<void> {
        this.log('Clearing state');
        this.commonState = this.defaultCommonState;
        this.instances.forEach((_, key) => {
            this.instances.set(key, this.defaultInstanceState);
        });
        await this.persist();
        this.notify({});
    }

    public subscribe(listener: (state: (DerivedInstanceState<TConfig> | DerivedState<TConfig>), changes: Partial<DerivedInstanceState<TConfig> & DerivedCommonState<TConfig>>, agent?: AgentMetadata) => void): void {
        this.log('Subscribing to state');
        this.stateChangeListeners.push(listener);
    }

    // Right now we notify the instance even if the state change came from the instance.
    // This should probably be skipped for instance state, since it already knows.
    private notify(changes: Partial<DerivedState<TConfig>>, key?: string): void {
        const agentMeta = key ? getMetadata(key) : undefined;
        const target = agentMeta ? getTarget(agentMeta) : undefined;
        const state = key ? this.get(key) : this.get();

        if (this.stateChangeListeners.length > 0) {
            this.log('Notifying state change listeners in source');
            this.stateChangeListeners.forEach(listener => {
                listener(state, changes, agentMeta || undefined);
            });
        }

        if (key && target) {
            this.instanceLog('Notifying of state change.', key);
            this.post({ action: 'stateUpdate', payload: { state: changes } }, target);
        } else {
            console.log('Notifying everyone');
            // for every key of this.instances, post the state update to the corresponding key
            this.instances.forEach((_, key) => {
                this.post({ action: 'stateUpdate', payload: { state: changes } }, key);
            });
        }
    }

    public get(): DerivedState<TConfig>;
    public get(key: string): DerivedInstanceState<TConfig> & DerivedCommonState<TConfig>;
    public get(key?: string): (DerivedCommonState<TConfig> | DerivedState<TConfig>) {
        if (!key) {
            return { ...this.commonState, ...{} as DerivedInstanceState<TConfig> };
        }
        return { ...this.commonState, ...this.instances.get(key) };
    }

    public findInstance(context: PorterContext, location: AgentLocation): string | null {
        // Todo: This feels like too-tight coupleing between porter and crann. Should be a better way.
        const searchKey = getKey({ context, ...location })
        for (const [key, instance] of this.instances) {
            if (key === searchKey) {
                this.log('Found instance for key: ', key);
                return key
            }
        }
        this.log('Could not find instance for context and location: ', context, location);
        return null;
    }

    public async set(state: Partial<DerivedCommonState<TConfig>>): Promise<void>
    public async set(state: Partial<DerivedInstanceState<TConfig> & DerivedCommonState<TConfig>>, key: string): Promise<void>
    public async set(state: Partial<DerivedInstanceState<TConfig> | DerivedCommonState<TConfig>>, key?: string): Promise<void> {
        const instance = {} as Partial<DerivedInstanceState<TConfig>>;
        const worker = {} as Partial<DerivedCommonState<TConfig>>;

        for (const itemKey in state) {
            const item = this.config[itemKey as keyof TConfig] as ConfigItem<any>;
            if (item.partition === 'instance') {
                const instanceItemKey = itemKey as keyof DerivedInstanceState<TConfig>;
                const instanceState = state as Partial<DerivedInstanceState<TConfig>>;
                instance[instanceItemKey] = instanceState[instanceItemKey];
            } else if (!item.partition || item.partition === Partition.Common) {
                const commonItemKey = itemKey as keyof DerivedCommonState<TConfig>;
                const commonState = state as Partial<DerivedCommonState<TConfig>>;
                worker[commonItemKey] = commonState[commonItemKey]!;
            }
        }
        if (key && Object.keys(instance).length > 0) {
            this.instanceLog('Setting instance state: ', key, instance);
            this.setInstanceState(key, instance);
        }
        if (Object.keys(worker).length > 0) {
            this.log('Setting common state: ', worker);
            this.setCommonState(worker);
        }
    }

    private async hydrate(): Promise<void> {
        this.log('Hydrating state from storage.');
        const local = await browser.storage.local.get(null);
        const session = await browser.storage.session.get(null);
        const combined = { ...local, ...session };
        const update: Partial<DerivedCommonState<TConfig>> = {}; // Cast update as Partial<DerivedState<TConfig>>
        let hadItems = false;
        for (const prefixedKey in combined) {
            const key = this.removePrefix(prefixedKey);
            if (this.config.hasOwnProperty(key)) {
                const value = combined[key];
                update[key as keyof DerivedCommonState<TConfig>] = value;
                hadItems = true;
            }
        }
        if (hadItems) {
            this.log('Hydrated some items.');
        } else {
            this.log('No items found in storage.');
        }
        this.commonState = { ...this.defaultCommonState, ...update };
    }

    private removePrefix(key: string): string {
        if (key.startsWith(this.storagePrefix)) {
            return key.replace(this.storagePrefix, '');
        }
        return key;
    }

    private initializeInstanceDefault(): DerivedInstanceState<TConfig> {
        const instanceState: any = {};
        Object.keys(this.config).forEach(key => {
            const item: ConfigItem<any> = this.config[key];
            if (item.partition === 'instance') {
                instanceState[key] = item.default;
            }
        });
        return instanceState;
    }

    private initializeCommonDefault(): DerivedCommonState<TConfig> {
        const commonState: any = {};
        Object.keys(this.config).forEach(key => {
            const item: ConfigItem<any> = this.config[key];
            if (item.partition === Partition.Common) {
                commonState[key] = item.default;
            }
        });
        return commonState;
    }

    private log(message: string, ...args: any[]) {
        console.log(`CrannSource [core], ` + message, ...args);
    }
    private instanceLog(message: string, key: string, ...args: any[]) {
        console.log(`CrannSource [${key}], ` + message, ...args);
    }
    private error(message: string, ...args: any[]) {
        console.error(`CrannSource [core], ` + message, ...args);
    }
    private warn(message: string, ...args: any[]) {
        console.warn(`CrannSource [core], ` + message, ...args);
    }
}


export function create<TConfig extends Record<string, ConfigItem<any>>>(config: TConfig, storagePrefix?: string): [
    (key?: string) => (DerivedState<TConfig>),
    (state: Partial<DerivedInstanceState<TConfig> & DerivedCommonState<TConfig>>, key?: string) => Promise<void>,
    (listener: (state: (DerivedInstanceState<TConfig> | DerivedState<TConfig>), changes: Partial<DerivedInstanceState<TConfig> & DerivedCommonState<TConfig>>, agent?: AgentMetadata) => void) => void,
    (context: PorterContext, location: AgentLocation) => string | null,
] {
    const instance = Crann.getInstance(config, storagePrefix);
    return [
        instance.get.bind(instance),
        instance.set.bind(instance),
        instance.subscribe.bind(instance),
        instance.findInstance.bind(instance),
    ];
}


