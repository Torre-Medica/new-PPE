type SimListener = (event: MessageEvent) => void;

class SimEventSource {
  private readonly _map = new Map<string, SimListener[]>();
  onerror: ((ev: Event) => void) | null = null;
  onopen: ((ev: Event) => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;

  addEventListener(type: string, listener: SimListener) {
    const list = this._map.get(type) ?? [];
    list.push(listener);
    this._map.set(type, list);
  }

  removeEventListener(type: string, listener: SimListener) {
    const list = this._map.get(type) ?? [];
    this._map.set(type, list.filter((l) => l !== listener));
  }

  _dispatch(type: string, data: object) {
    const event = new MessageEvent(type, { data: JSON.stringify(data) });
    for (const listener of this._map.get(type) ?? []) {
      listener(event);
    }
  }

  close() {}
}

const _instance = new SimEventSource();

export function getSimEventSource(): SimEventSource {
  return _instance;
}

export function fireSimEvent(type: string, data: object) {
  _instance._dispatch(type, data);
}
