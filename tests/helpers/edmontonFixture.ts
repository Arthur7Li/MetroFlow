import edmontonManifestRaw from '../../src/cities/edmonton/manifest.json';
import edmontonNodesRaw from '../../src/cities/edmonton/nodes.json';
import type { CityManifest, CityNodeSeed } from '../../src/cities/types';

export const EDMONTON_MANIFEST_FIXTURE = edmontonManifestRaw as CityManifest;
export const EDMONTON_NODES_16_FIXTURE = (edmontonNodesRaw as CityNodeSeed[]).slice(0, 16);
