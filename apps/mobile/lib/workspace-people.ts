import type { SpaceMember } from "@labradoodle/contracts";
import { rpc, selectedSpaceId } from "./api";

/** The people of the workspace on screen, without the person asking. */
export async function loadWorkspacePeople(): Promise<SpaceMember[]> {
  const me = await rpc("me");
  const { members } = await rpc("spaces/members/list", {
    spaceId: selectedSpaceId() ?? me.spaceId,
  });
  return members.filter((member) => member.userId !== me.userId);
}
