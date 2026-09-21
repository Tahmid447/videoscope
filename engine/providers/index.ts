import {direct} from './direct.ts';
import { youtube } from './youtube.ts';
import { tokyomotion } from './tokyomotion.ts';
import { meta } from './meta.ts';
import { generic, wordpressRss } from './generic.ts';
import { publicUrl } from '../network.ts';
import { ProviderError } from '../errors.ts';
import type { Provider, Detection } from '../model.ts';
export const providers: Provider[] = [youtube, tokyomotion, meta, direct, wordpressRss, generic];
export function providerById(id: string): Provider {
  const found = providers.find(p => p.id === id);
  if (!found) throw new ProviderError('unsupported_provider', 'This provider adapter is not registered.');
  return found;
}
export function detect(raw: string): Detection {
  const u = publicUrl(raw);
  for (const p of [youtube, tokyomotion, meta, direct, generic]) { const source = p.detect(u); if (source) return source; }
  throw new ProviderError('unsupported_source', 'No adapter can inspect this public source.');
}
