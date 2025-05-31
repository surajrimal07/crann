import { createBasicEncoder } from "./encoding";
import type {
  MessageEndpoint,
  RemoteCallable,
  EncodingStrategy,
  EncodingStrategyApi,
  Retainer,
  CallMessage,
  ResultMessage,
  ErrorMessage,
  RPCMessage,
} from "./types";
import { ActionsConfig } from "../model/crann.model";
import { Logger } from "../utils/logger";
import { getAgentTag } from "../utils/agent";

const CALL = 0;
const RESULT = 1;
const TERMINATE = 2;
const RELEASE = 3;
const FUNCTION_APPLY = 5;
const FUNCTION_RESULT = 6;

type AnyFunction = (...args: any[]) => any;

export interface CreateEndpointOptions<T = unknown> {
  uuid?(): string;
  createEncoder?(api: EncodingStrategyApi): EncodingStrategy;
  callable?: (keyof T)[];
}

export interface Endpoint<T> {
  readonly call: RemoteCallable<T>;
  replace(messenger: MessageEndpoint): void;
  expose(api: Record<string, AnyFunction | undefined>): void;
  callable(...methods: string[]): void;
  terminate(): void;
}

/**
 * An endpoint wraps around a messenger, acting as the intermediary for all
 * messages both send from, and received by, that messenger. The endpoint sends
 * all messages as arrays, where the first element is the message type, and the
 * second is the arguments for that message (as an array). For messages that send
 * meaningful content across the wire (e.g., arguments to function calls, return
 * results), the endpoint first encodes these values.
 *
 * Encoding is done using a CBOR-like encoding scheme. The value is encoded into
 * an array buffer, and is paired with an additional array buffer that contains all
 * the strings used in that message (in the encoded value, strings are encoded as
 * their index in the "strings" encoding to reduce the cost of heavily-duplicated
 * strings, which is more likely in payloads containing UI). This encoding also takes
 * care of encoding functions: it uses a "tagged" item in CBOR to represent a
 * function as a string ID, which the opposite endpoint will be capable of turning
 * into a consistent, memory-manageable function proxy.
 *
 * The main CBOR encoding is entirely take from the [cbor.js package](https://github.com/paroga/cbor-js).
 * The special behavior for encoding strings and functions was then added in to the
 * encoder and decoder. For additional details on CBOR:
 *
 * @see https://tools.ietf.org/html/rfc7049
 */
export function createEndpoint<TState, TActions extends ActionsConfig<TState>>(
  messenger: MessageEndpoint,
  state: TState,
  actions: TActions,
  setState?: (newState: Partial<TState>) => Promise<void>,
  encodingStrategy?: EncodingStrategy
): RemoteCallable<TActions> {
  const callbacks = new Map<number, (result: unknown) => void>();
  const retainedObjects = new Map<string, Set<Retainer>>();

  // Create logger - will be used in Service Worker or Agent context based on the messenger's context
  const contextPrefix = messenger.context?.isServiceWorker ? "Core" : "Agent";
  const logger = Logger.forContext(`${contextPrefix}:RPC`);

  // If we have agent info, set the tag
  if (messenger.context?.agentInfo) {
    logger.setTag(getAgentTag(messenger.context.agentInfo));
  }

  messenger.addEventListener("message", (event) => {
    logger.debug("Message received:", event);
    const [id, message] = event.data as [number, RPCMessage];

    if ("call" in message && "args" in message.call) {
      logger.debug("Processing call message:", message);
      const callMessage = message.call;
      const { id: callId, args, target } = callMessage;
      const action = actions[callId];
      if (!action) {
        messenger.postMessage([
          id,
          {
            error: { id: callId, error: "Action not found", target },
          } as ErrorMessage,
        ] as [number, ErrorMessage]);
        return;
      }

      try {
        if (action.validate) {
          action.validate(...args);
        }

        // Ensure we have a target - if not provided, we need to handle this case
        if (!target) {
          messenger.postMessage([
            id,
            {
              error: {
                id: callId,
                error: "No target provided for action call",
                target,
              },
            } as ErrorMessage,
          ] as [number, ErrorMessage]);
          return;
        }

        // Handle both synchronous and asynchronous results
        Promise.resolve(action.handler(state, setState!, target, ...args)).then(
          (result: unknown) => {
            logger.debug("Action handler result:", {
              result,
              target,
            });
            messenger.postMessage([
              id,
              { result: { id: callId, result, target } },
            ] as [number, ResultMessage]);
          },
          (error: Error) => {
            messenger.postMessage([
              id,
              {
                error: { id: callId, error: error.message, target },
              } as ErrorMessage,
            ] as [number, ErrorMessage]);
          }
        );
      } catch (error) {
        if (error instanceof Error) {
          messenger.postMessage([
            id,
            { error: { id: callId, error: error.message, target } },
          ] as [number, ErrorMessage]);
        } else {
          messenger.postMessage([
            id,
            {
              error: { id: callId, error: "Unknown error occurred", target },
            } as ErrorMessage,
          ] as [number, ErrorMessage]);
        }
      }
    } else if ("result" in message) {
      const resultMessage = message.result;
      const callback = callbacks.get(id);
      if (callback) {
        callback(resultMessage.result);
        callbacks.delete(id);
      }
    } else if ("error" in message) {
      const errorMessage = message.error;
      const callback = callbacks.get(id);
      if (callback) {
        callback(Promise.reject(new Error(errorMessage.error)));
        callbacks.delete(id);
      }
    } else if ("release" in message) {
      const releaseMessage = message.release;
      const retainers = retainedObjects.get(releaseMessage.id);
      if (retainers) {
        retainers.clear();
        retainedObjects.delete(releaseMessage.id);
      }
    }
  });

  const proxy = new Proxy({} as RemoteCallable<TActions>, {
    get(_, prop: string) {
      return (...args: unknown[]) => {
        const id = Math.random();
        return new Promise((resolve, reject) => {
          callbacks.set(id, (result) => {
            if (result instanceof Promise) {
              result.then(resolve, reject);
            } else {
              resolve(result);
            }
          });
          messenger.postMessage([id, { call: { id: prop, args } }] as [
            number,
            CallMessage
          ]);
        });
      };
    },
  });

  return proxy;
}

function defaultUuid() {
  return `${uuidSegment()}-${uuidSegment()}-${uuidSegment()}-${uuidSegment()}`;
}

function uuidSegment() {
  return Math.floor(Math.random() * Number.MAX_SAFE_INTEGER).toString(16);
}

function createCallable<T>(
  handlerForCall: (
    property: string | number | symbol
  ) => AnyFunction | undefined,
  callable?: (keyof T)[]
): RemoteCallable<T> {
  let call: any;

  if (callable == null) {
    if (typeof Proxy !== "function") {
      throw new Error(
        `You must pass an array of callable methods in environments without Proxies.`
      );
    }

    const cache = new Map<string | number | symbol, AnyFunction | undefined>();

    call = new Proxy(
      {},
      {
        get(_target, property) {
          if (cache.has(property)) {
            return cache.get(property);
          }

          const handler = handlerForCall(property);
          cache.set(property, handler);
          return handler;
        },
      }
    );
  } else {
    call = {};

    for (const method of callable) {
      Object.defineProperty(call, method, {
        value: handlerForCall(method),
        writable: false,
        configurable: true,
        enumerable: true,
      });
    }
  }

  return call;
}
