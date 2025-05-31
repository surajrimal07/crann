import { source, AgentInfo, connect, Message, AgentAPI } from "porter-source";
import { createEndpoint } from "./endpoint";
import { MessageEndpoint, CallMessage, RPCMessage } from "./types";
import { ActionsConfig } from "../model/crann.model";
import { Logger } from "../utils/logger";
import { getAgentTag } from "../utils/agent";

export function createCrannRPCAdapter<
  TState,
  TActions extends ActionsConfig<TState>
>(
  initialState: TState,
  actions: TActions,
  porter?: ReturnType<typeof source> | ReturnType<typeof connect>,
  setState?: (newState: Partial<TState>) => Promise<void>
) {
  const porterInstance = porter || source("crann");

  // Determine if this is a service worker instance (source) or content script instance (connect)
  const isServiceWorker = !(porterInstance.type === "agent");

  // Set up logger with the appropriate context
  const logger = Logger.forContext(isServiceWorker ? "Core:RPC" : "Agent:RPC");

  const messageEndpoint: MessageEndpoint = {
    postMessage: (message, transferables) => {
      if (isServiceWorker) {
        logger.debug("Posting message from service worker:", {
          message,
          transferables,
        });
        // In service worker, we need to respond to the specific target
        const [, rpcPayload] = message;
        const target = getTargetFromMessage(rpcPayload);
        if (!target) {
          logger.warn("No target specified for RPC response in service worker");
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
        // In content script (agent) context
        // Get the agent info only when needed
        const agentInfo = (porterInstance as AgentAPI).getAgentInfo();

        if (!agentInfo) {
          logger.warn("No agent info found for posting message", { agentInfo });
          return;
        }

        // Get the agent tag for logging
        const myTag = getAgentTag(agentInfo);

        // Destructure the tuple, skipping the messageId which we don't need
        const [, rpcPayload] = message;

        // Use type guard to check if it's a call message
        if ("call" in rpcPayload) {
          // Add the target info to the call message
          rpcPayload.call.target = agentInfo?.location;
        }

        logger.withTag(myTag).debug("Sending RPC message from agent:", {
          rpcPayload,
          message,
        });
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
            if (!info) {
              logger.debug("RPC message received:", {
                message,
                event,
              });
            } else {
              // Get the agent tag for logging
              const myTag = getAgentTag(info);
              logger.withTag(myTag).debug("RPC message received:", {
                message,
                event,
              });
            }

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
            logger.error("Failed to parse RPC message payload:", e);
          }
        },
      });
    },
    removeEventListener: () => {
      // Porter-source doesn't support removing listeners
    },
    // Add context information
    context: {
      isServiceWorker,
      agentInfo: !isServiceWorker
        ? (porterInstance as AgentAPI).getAgentInfo()
        : undefined,
    },
  };

  return createEndpoint(messageEndpoint, initialState, actions, setState);
}

// Don't love this being here. Let's move it sometime soon,
// or find another way to do this.
function getTargetFromMessage(payload: RPCMessage): any {
  if ("result" in payload) return payload.result.target;
  if ("error" in payload) return payload.error.target;
  if ("call" in payload) return payload.call.target;
  if ("release" in payload) return payload.release.target;
  return undefined;
}
