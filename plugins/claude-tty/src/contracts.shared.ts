import { defineRpc } from "@getpaseo/plugin/server";
import { z } from "zod";

export const ProviderStateSchema = z.enum(["absent", "matching", "mismatched", "foreign"]);

export const StatusSchema = z.object({
  /** The checkout this plugin was installed from, or null when it could not be identified. */
  repoRoot: z.string().nullable(),
  /** Why there is no checkout to manage; everything below is meaningless while this is set. */
  problem: z.string().nullable(),
  adapter: z.object({
    binary: z.string().nullable(),
    built: z.boolean(),
  }),
  provider: z.object({
    id: z.string(),
    state: ProviderStateSchema,
    label: z.string().nullable(),
    command: z.array(z.string()).nullable(),
    expectedCommand: z.array(z.string()).nullable(),
  }),
  host: z.object({
    node: z.string(),
    pnpm: z.string().nullable(),
    claude: z.string().nullable(),
  }),
  stateDirectory: z.string(),
});

export type StatusPayload = z.output<typeof StatusSchema>;

export const getStatus = defineRpc({
  name: "claude-tty.status",
  input: z.object({}),
  output: StatusSchema,
});
