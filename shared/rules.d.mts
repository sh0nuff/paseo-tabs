import type { SavedSettings } from "./install-state.mjs";
type Env = Record<string, string | undefined>;

export declare const RULE_APPENDED_ENV: "PASEO_TABS_RULE_APPENDED";
export declare const RULE_PENDING: string;
export declare const RULE_TABS_MD: string;
export declare function fillRule(text: string, options: { agentId: string; cwd: string; pluginRoot: string; autoArchive: boolean }): string;
export declare function isGitTopLevel(dir: string): boolean;
export declare function buildRule(options: { agentId: string; cwd: string; env?: Env; saved?: SavedSettings | null; fallbackRoot?: string | null }): string | null;
