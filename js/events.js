export const bus = {
  listeners: {},
  on(evt, fn) {
    if (!this.listeners[evt]) this.listeners[evt] = [];
    this.listeners[evt].push(fn);
  },
  off(evt, fn) {
    if (!this.listeners[evt]) return;
    this.listeners[evt] = this.listeners[evt].filter(f => f !== fn);
  },
  emit(evt, data) {
    if (!this.listeners[evt]) return;
    this.listeners[evt].forEach(fn => fn(data));
  }
};
