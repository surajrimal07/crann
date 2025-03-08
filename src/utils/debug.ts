// Create a global debug state manager
export class DebugManager {
  private static _debug: boolean = false;

  static setDebug(value: boolean): void {
    DebugManager._debug = value;
  }

  static isDebugEnabled(): boolean {
    return DebugManager._debug;
  }
}

// Export a convenience function
export function isDebugEnabled(): boolean {
  return DebugManager.isDebugEnabled();
}
