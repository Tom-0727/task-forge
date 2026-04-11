import { useEffect, useState } from '../vendor/preact-hooks.mjs';
import { subscribe, getState } from './store.js';

// useStore(selector) re-renders when the selector's output changes (by ref).
export function useStore(selector) {
  const [value, setValue] = useState(() => selector(getState()));
  useEffect(() => {
    let prev = selector(getState());
    setValue(prev);
    return subscribe(() => {
      const next = selector(getState());
      if (next !== prev) {
        prev = next;
        setValue(next);
      }
    });
  }, []);
  return value;
}
