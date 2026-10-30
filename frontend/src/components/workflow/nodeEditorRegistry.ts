import { getNodeUI } from './nodeRegistry'
/** Optional per-node Parameters panel; schema-generated forms remain the fallback. */
export const customNodeParameters = (type: string) => getNodeUI(type)?.Parameters
