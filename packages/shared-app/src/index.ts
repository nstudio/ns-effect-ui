import * as Layer from 'effect/Layer';
import { FetchPulseSnapshot, TriggerHaptic } from './domain/Task.ts';

export * from './domain/Task.ts';
export * from './components/App.ts';

/**
 * Shared domain Layer providing `FetchPulseSnapshot` and `TriggerHaptic`.
 * Requires only the host-agnostic `DeviceInfo` and `Haptics` services.
 */
export const SharedDomainLayer = Layer.mergeAll(
  FetchPulseSnapshot.layer,
  TriggerHaptic.layer,
);
