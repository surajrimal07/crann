import { source, AgentInfo, connect, Message, AgentAPI } from "porter-source";
import { createEndpoint } from "./endpoint";
import { MessageEndpoint, ActionsConfig } from "./types";

export function createCrannRPCAdapter<
  TState,
  TActions extends ActionsConfig<TState>
>(
  initialState: TState,
  actions: TActions,
  porter?: ReturnType<typeof source> | ReturnType<typeof connect>
) {
  const porterInstance = porter || source("crann");

  // Determine if this is a service worker instance (source) or content script instance (connect)
  const isServiceWorker = !(porterInstance.type === "agent");

  const messageEndpoint: MessageEndpoint = {
    postMessage: (message, transferables) => {
      if (isServiceWorker) {
        console.log(
          "MOC createCrannRPCAdapter, postMessage, isServiceWorker: ",
          { porterInstance, message, transferables }
        );
        // In service worker, we need to respond to the specific target
        const target = (message as any).target;
        if (!target) {
          console.warn(
            "No target specified for RPC response in service worker"
          );
          return;
        }
        porterInstance.post(
          {
            action: "rpc",
            payload: {
              message,
              transferables: transferables || [],
            },
          },
          target
        );
      } else {
        // In content script, target is automatically the service worker
        porterInstance.post({
          action: "rpc",
          payload: {
            message,
            transferables: transferables || [],
          },
        });
      }
    },
    addEventListener: (event, listener) => {
      porterInstance.on({
        rpc: (message: Message<string>, info?: AgentInfo) => {
          try {
            console.log("[CRANN] porterInstance, message heard, ", {
              message,
              event,
            });
            const { payload } = message;
            const { message: originalMessage, transferables = [] } = payload;
            const rpcEvent = new MessageEvent("message", {
              data: originalMessage,
              ports:
                (transferables.filter(
                  (t: unknown) => t instanceof MessagePort
                ) as MessagePort[]) || [],
            });
            listener(rpcEvent);
          } catch (e) {
            console.error("Failed to parse RPC message payload:", e);
          }
        },
      });
    },
    removeEventListener: () => {
      // Porter-source doesn't support removing listeners
    },
  };

  return createEndpoint(messageEndpoint, initialState, actions);
}
