// SPDX-License-Identifier: GPL-2.0-or-later
/** Combines physical keys and independent virtual input sources without losing held actions. */
export class ActionState {
  readonly held = new Set<string>();
  private virtual = new Map<string, Set<string>>();
  bindings: Record<string, string[]>;
  constructor(bindings: Record<string, readonly string[]>) {
    this.bindings = Object.fromEntries(Object.entries(bindings).map(([action, keys]) => [action, [...keys]]));
  }
  press(code: string) { this.held.add(code); }
  release(code: string) { this.held.delete(code); }
  setActions(source: string, actions: readonly string[]) {
    if (actions.length) this.virtual.set(source, new Set(actions));
    else this.virtual.delete(source);
  }
  clear() { this.held.clear(); this.virtual.clear(); }
  active(action: string) {
    return (Object.hasOwn(this.bindings, action) && this.bindings[action].some(key => this.held.has(key)))
      || [...this.virtual.values()].some(actions => actions.has(action));
  }
  /** Returns the first matching binding. Applications define conflict/remapping policy. */
  action(code: string) { return Object.keys(this.bindings).find(action => this.bindings[action].includes(code)); }
}
