import { createElement, type Component, type FunctionComponent } from 'preact';

/** Of twee reeksen gegevens (props) per onderdeel gelijk zijn: zelfde sleutels, zelfde waarden. */
export function shallowEqual(a: object, b: object): boolean {
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = Object.keys(left);
  if (keys.length !== Object.keys(right).length) return false;
  return keys.every((key) => key in right && Object.is(left[key], right[key]));
}

/**
 * Een onderdeel dat niet opnieuw tekent als zijn gegevens (props) gelijk zijn gebleven. Zoals
 * `memo` uit preact/compat, zonder die hele laag mee te leveren. Wat het onderdeel zelf bijhoudt
 * (state, context) werkt gewoon door.
 */
export function memo<P extends object>(inner: FunctionComponent<P>): FunctionComponent<P> {
  function Memoized(this: Component<P>, props: P) {
    this.shouldComponentUpdate = (next) => !shallowEqual(this.props, next);
    return createElement(inner as FunctionComponent<object>, props);
  }
  Memoized.displayName = `memo(${inner.displayName ?? inner.name})`;
  return Memoized as FunctionComponent<P>;
}
