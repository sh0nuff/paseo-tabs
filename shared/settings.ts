import { defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

/** How TABS.md and the panel show the tabs. Shown under Settings, Plugins, Tabs. */
export const displaySettings = defineSettings({
  id: "display",
  scope: "host",
  version: 1,
  schema: z.object({
    statusDots: z.boolean().default(true),
    shortenNames: z.boolean().default(true),
    maxNameLength: z.number().int().min(20).max(80).default(40),
  }),
});

export type DisplayValues = z.infer<typeof displaySettings.schema>;
