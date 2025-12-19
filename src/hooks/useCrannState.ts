import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { AnyConfig, DerivedState, StateChanges, StateUpdate } from "../model/crann.model";
import { connect } from "../crannAgent";

export function createCrannStateHook<TConfig extends AnyConfig>(config: TConfig) {
  return function useCrannState(context?: string) {
    const { useCrann, get, set, subscribe, callAction } = useMemo(() => connect(config), [context]);

    const useStateItem = useCallback(<K extends keyof DerivedState<TConfig>>(key: K) => {
      const [value, setValueState] = useState<DerivedState<TConfig>[K]>(get()[key]);

      useEffect(() => {
        setValueState(get()[key]);
        const unsubscribe = subscribe((changes: StateUpdate<TConfig>) => {
          if (key in changes) {
            setValueState(changes[key] as DerivedState<TConfig>[K]);
          }
        }, [key]);

        return unsubscribe;
      }, [key]);

      const setValue = useCallback((newValue: DerivedState<TConfig>[K]) => {
        set({ [key]: newValue } as StateChanges<TConfig>);
      }, [key]);

      return [value, setValue] as const;
    }, [get, set, subscribe]);

    const getState = useCallback(() => get(), [get]);
    const setState = useCallback((newState: StateChanges<TConfig>) => set(newState), [set]);

    return {
      useStateItem,
      getState,
      setState,
      useCrann,
      callAction,
    };
  };
}
