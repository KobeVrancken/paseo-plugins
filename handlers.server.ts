import { z } from "zod";
import * as contracts from "./contracts.shared.ts";
import { TranscriptStore, isRecentlyActive } from "./transcript.server.ts";

const store = new TranscriptStore();

type Input<Contract extends { input: z.ZodType }> = z.output<Contract["input"]>;
type Output<Contract extends { output: z.ZodType }> = z.input<Contract["output"]>;

export async function listSessionsHandler(
  input: Input<typeof contracts.listSessions>,
): Promise<Output<typeof contracts.listSessions>> {
  const projectDir = await store.projectDir(input.workspaceDir);
  const files = await store.listSessionFiles(input.workspaceDir);
  return {
    projectDir,
    sessions: files.map((file) => ({
      sessionId: file.sessionId,
      mtime: file.mtime,
      title: file.title,
      preview: file.preview,
      isLive: isRecentlyActive(file.mtime),
      boundTerminalId: null,
    })),
  };
}

export async function getTimelineHandler(
  input: Input<typeof contracts.getTimeline>,
): Promise<Output<typeof contracts.getTimeline>> {
  const slice = await store.timelineSince(input.workspaceDir, input.sessionId, input.sinceRevision);
  if (!slice) {
    return {
      entries: [],
      total: 0,
      revision: 0,
      reset: true,
      unsupportedCount: 0,
      sessionStatus: "detached",
    };
  }
  return {
    entries: slice.entries,
    total: slice.total,
    revision: slice.revision,
    reset: slice.reset,
    unsupportedCount: slice.unsupportedCount,
    sessionStatus: "detached",
  };
}
