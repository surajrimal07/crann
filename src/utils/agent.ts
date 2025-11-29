import { AgentInfo } from "porter-source-fork";

/**
 * Formats an agent tag based on the agent information
 * @param agent Agent information
 * @param options Configuration options
 * @returns Formatted agent tag string
 */
export function getAgentTag(
  agent: AgentInfo,
  options: { terse?: boolean } = { terse: true }
): string {
  const formatTabId = (tabId: number | string): string => {
    const tabIdStr = String(tabId);
    if (tabIdStr.length >= 4) {
      return tabIdStr.slice(-4);
    } else {
      return tabIdStr.padStart(4, "0");
    }
  };

  const formattedTabId = formatTabId(agent.location.tabId);

  if (options?.terse) {
    return `${formattedTabId}:${agent.location.frameId}`;
  }
  return `${agent.location.context}:${formattedTabId}:${agent.location.frameId}`;
}
