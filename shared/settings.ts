import { defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

/**
 * The plugin's settings, shown under Settings, Plugins, Tabs.
 *
 * `mode` and `autoArchive` are optional on purpose: left unsaved, the plugin works them out
 * from what is on disk (see shared/install-state.mjs), so an upgrade from 1.x keeps its
 * behaviour and a fresh install gets the Pending panel. `pendingStore` is the 1.x-era switch,
 * still honoured when `mode` was never saved.
 */
export const displaySettings = defineSettings({
  id: "display",
  scope: "host",
  version: 1,
  schema: z.object({
    statusDots: z.boolean().default(true),
    shortenNames: z.boolean().default(true),
    maxNameLength: z.number().int().min(20).max(80).default(40),
    overdueAfterDays: z.number().int().min(0).max(365).default(7),
    palette: z.enum(["default", "catppuccin", "gruvbox", "nord"]).default("default"),
    workspaceOrder: z.enum(["newest", "latestMessage"]).default("newest"),
    removeFinished: z.boolean().default(true),
    pendingStore: z.boolean().default(false),
    mode: z.enum(["pending", "tabs-md"]).optional(),
    autoArchive: z.boolean().optional(),
  }),
});

export type DisplayValues = z.infer<typeof displaySettings.schema>;
