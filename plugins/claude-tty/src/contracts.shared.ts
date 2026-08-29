import { defineRpc } from "@getpaseo/plugin/server";
import { z } from "zod";
import { INSTALL_STEP_IDS } from "./install.shared.ts";

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

export const InstallStepSchema = z.object({
  id: z.enum(INSTALL_STEP_IDS),
  label: z.string(),
  state: z.enum(["pending", "running", "ok", "failed"]),
  detail: z.string(),
  stdout: z.string(),
  stderr: z.string(),
  exitCode: z.number().nullable(),
});

export const InstallJobSchema = z.object({
  state: z.enum(["running", "ok", "failed"]),
  startedAt: z.number(),
  finishedAt: z.number().nullable(),
  steps: z.array(InstallStepSchema),
});

export type InstallJobPayload = z.output<typeof InstallJobSchema>;

export const startInstall = defineRpc({
  name: "claude-tty.install.start",
  /** Repointing an entry that already exists is never part of an ordinary install. */
  input: z.object({ repair: z.boolean() }),
  output: InstallJobSchema,
});

export const getInstall = defineRpc({
  name: "claude-tty.install.status",
  input: z.object({}),
  output: InstallJobSchema.nullable(),
});
