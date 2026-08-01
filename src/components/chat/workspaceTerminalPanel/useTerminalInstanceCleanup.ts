import { useEffect, type MutableRefObject } from "react";
import type { TabTerminalInstance } from "./terminalInstance";

export function useTerminalInstanceCleanup(
  tabInstancesRef: MutableRefObject<Map<string, TabTerminalInstance>>,
) {
  useEffect(() => {
    const tabInstances = tabInstancesRef.current;
    return () => {
      tabInstances.forEach((instance) => {
        instance.disposables.forEach((disposable) => disposable.dispose());
        instance.terminal.dispose();
        if (instance.container.parentElement) {
          instance.container.remove();
        }
      });
      tabInstances.clear();
    };
  }, [tabInstancesRef]);
}
