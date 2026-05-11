type Listener = () => void;
const listeners = new Set<Listener>();

export const assistantBus = {
  subscribe(fn: Listener) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  open() {
    listeners.forEach((fn) => {
      try { fn(); } catch {}
    });
  },
};
