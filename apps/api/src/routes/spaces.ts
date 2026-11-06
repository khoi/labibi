import type { Actor } from "@labradoodle/contracts";
import type { PrismaClient } from "@labradoodle/db";
import {
  acceptSpaceInvite,
  CannotRemoveSpaceOwnerError,
  CannotRenameSpaceAsNonOwnerError,
  cancelSpaceInvites,
  createSpaceInvite,
  fallbackSpaceForMember,
  getSpaceDoodle,
  InvalidSpaceNameError,
  leaveSpace,
  listChats,
  listSpaceMembers,
  listWorkspacesForMember,
  previewSpaceInvite,
  recordAuditEvent,
  removeSpaceMember,
  renameSpaceForMember,
  runAsSystem,
  runAsTenant,
  SpaceDeletionInProgressError,
  SpaceInviteLimitError,
  SpaceInviteNotFoundError,
  SpaceMemberNotFoundError,
  SpaceNotFoundError,
  SpaceOwnerCannotLeaveError,
} from "@labradoodle/db";
import { ORPCError } from "@orpc/server";
import { otherSpaceOfChat } from "../chat-space.js";
import { afterSpaceDeparture } from "../space-departure.js";
import { resolveChatTarget, threadSnapshot } from "../thread-target.js";
import type { RouterContext } from "./context.js";
import { meDto } from "./shared.js";

function mapSpaceMemberError(error: unknown): never {
  if (
    error instanceof SpaceInviteNotFoundError ||
    error instanceof SpaceMemberNotFoundError ||
    error instanceof SpaceNotFoundError
  ) {
    throw new ORPCError("NOT_FOUND", { message: error.message });
  }
  if (
    error instanceof CannotRemoveSpaceOwnerError ||
    error instanceof SpaceOwnerCannotLeaveError ||
    error instanceof SpaceInviteLimitError
  ) {
    throw new ORPCError("BAD_REQUEST", { message: error.message });
  }
  if (error instanceof SpaceDeletionInProgressError) {
    throw new ORPCError("CONFLICT", { message: error.message });
  }
  throw error;
}

/**
 * Runs `fn` scoped to another of the actor's Spaces. Membership is checked first,
 * so a client-supplied Space id never opens that Space's rows on its own.
 */
async function asMemberOf<T>(
  prisma: PrismaClient,
  actor: Actor,
  spaceId: string,
  fn: () => Promise<T>,
): Promise<T> {
  const member = await prisma.spaceMember.findFirst({
    where: { spaceId, userId: actor.userId },
    select: { id: true },
  });
  if (!member) throw new ORPCError("NOT_FOUND", { message: new SpaceNotFoundError().message });
  return runAsTenant({ spaceId, userId: actor.userId }, fn);
}

export function spacesRoutes(ctx: RouterContext) {
  const { deps, authed } = ctx;
  // Reads across the person's workspaces; every query is limited to their own memberships.
  const workspaces = (actor: Actor) =>
    runAsSystem("list the member's workspaces", () =>
      listWorkspacesForMember(deps.prisma, actor.userId),
    );
  return {
    spaces: {
      list: authed.spaces.list.handler(({ context }) => workspaces(context.actor)),
      // Renames another of the member's Spaces; membership is checked inside.
      rename: authed.spaces.rename.handler(({ context, input }) =>
        asMemberOf(deps.prisma, context.actor, input.spaceId, async () => {
          try {
            const renamed = await renameSpaceForMember(deps.prisma, {
              currentSpaceId: context.actor.spaceId,
              userId: context.actor.userId,
              spaceId: input.spaceId,
              name: input.name,
            });
            await recordAuditEvent({
              action: "space.renamed",
              actor: { type: "user", id: context.actor.userId },
              spaceId: renamed.id,
              target: { type: "space", id: renamed.id, label: renamed.name },
            });
            return renamed;
          } catch (error) {
            if (error instanceof SpaceNotFoundError) {
              throw new ORPCError("NOT_FOUND", { message: error.message });
            }
            if (error instanceof CannotRenameSpaceAsNonOwnerError) {
              throw new ORPCError("FORBIDDEN", { message: error.message });
            }
            if (error instanceof InvalidSpaceNameError) {
              throw new ORPCError("BAD_REQUEST", { message: error.message });
            }
            if (error instanceof SpaceDeletionInProgressError) {
              throw new ORPCError("CONFLICT", { message: error.message });
            }
            throw error;
          }
        }),
      ),
      members: {
        list: authed.spaces.members.list.handler(({ context, input }) =>
          asMemberOf(deps.prisma, context.actor, input.spaceId, () =>
            listSpaceMembers(deps.prisma, {
              spaceId: input.spaceId,
              userId: context.actor.userId,
            }).catch(mapSpaceMemberError),
          ),
        ),
        remove: authed.spaces.members.remove.handler(({ context, input }) =>
          asMemberOf(deps.prisma, context.actor, input.spaceId, async () => {
            const departure = await removeSpaceMember(deps.prisma, {
              spaceId: input.spaceId,
              userId: context.actor.userId,
              memberUserId: input.userId,
            }).catch(mapSpaceMemberError);
            await recordAuditEvent({
              action: "space.member.removed",
              actor: { type: "user", id: context.actor.userId },
              spaceId: input.spaceId,
              target: { type: "user", id: input.userId },
            });
            await afterSpaceDeparture(
              deps,
              { spaceId: input.spaceId, userId: context.actor.userId },
              departure,
            );
            return { ok: true as const };
          }),
        ),
        leave: authed.spaces.members.leave.handler(({ context, input }) =>
          asMemberOf(deps.prisma, context.actor, input.spaceId, async () => {
            const departure = await leaveSpace(deps.prisma, {
              spaceId: input.spaceId,
              userId: context.actor.userId,
            }).catch(mapSpaceMemberError);
            await recordAuditEvent({
              action: "space.member.left",
              actor: { type: "user", id: context.actor.userId },
              spaceId: input.spaceId,
            });
            await afterSpaceDeparture(
              deps,
              { spaceId: input.spaceId, userId: context.actor.userId },
              departure,
            );
            const activeSpaceId =
              input.spaceId === context.actor.spaceId
                ? await fallbackSpaceForMember(deps.prisma, context.actor.userId)
                : context.actor.spaceId;
            if (!activeSpaceId) throw new ORPCError("NOT_FOUND");
            return { ok: true as const, activeSpaceId };
          }),
        ),
      },
      invites: {
        create: authed.spaces.invites.create.handler(({ context, input }) =>
          asMemberOf(deps.prisma, context.actor, input.spaceId, async () => {
            const invite = await createSpaceInvite(deps.prisma, {
              spaceId: input.spaceId,
              userId: context.actor.userId,
            }).catch(mapSpaceMemberError);
            await recordAuditEvent({
              action: "space.invite.created",
              actor: { type: "user", id: context.actor.userId },
              spaceId: input.spaceId,
            });
            return {
              url: new URL(`/invite/${invite.token}`, deps.env.webOrigin).toString(),
              expiresAt: invite.expiresAt.toISOString(),
            };
          }),
        ),
        // The invitee is not a member yet, so these look the Space up by the link alone.
        preview: authed.spaces.invites.preview.handler(({ context, input }) =>
          previewSpaceInvite(deps.prisma, {
            token: input.token,
            userId: context.actor.userId,
          }).catch(mapSpaceMemberError),
        ),
        accept: authed.spaces.invites.accept.handler(async ({ context, input }) => {
          const accepted = await acceptSpaceInvite(deps.prisma, {
            token: input.token,
            userId: context.actor.userId,
          }).catch(mapSpaceMemberError);
          if (accepted.joined) {
            await recordAuditEvent({
              action: "space.member.joined",
              actor: { type: "user", id: context.actor.userId },
              spaceId: accepted.spaceId,
            });
          }
          return { spaceId: accepted.spaceId };
        }),
        cancel: authed.spaces.invites.cancel.handler(({ context, input }) =>
          asMemberOf(deps.prisma, context.actor, input.spaceId, async () => {
            await cancelSpaceInvites(deps.prisma, {
              spaceId: input.spaceId,
              userId: context.actor.userId,
            }).catch(mapSpaceMemberError);
            await recordAuditEvent({
              action: "space.invites.cancelled",
              actor: { type: "user", id: context.actor.userId },
              spaceId: input.spaceId,
            });
            return { ok: true as const };
          }),
        ),
      },
    },
    bootstrap: authed.bootstrap.handler(async ({ context, input }) => {
      const actor = context.actor;
      const [me, spaces, doodle, chats] = await Promise.all([
        meDto(deps, actor),
        workspaces(actor),
        getSpaceDoodle(deps.prisma, actor),
        listChats(deps.prisma, actor),
      ]);
      const requested = input.threadId
        ? chats.find((chat) => chat.id === input.threadId)
        : undefined;
      const threadSpaceId =
        input.threadId && !requested
          ? await otherSpaceOfChat(deps.prisma, actor, input.threadId)
          : undefined;
      const thread = requested
        ? await threadSnapshot(
            deps,
            await resolveChatTarget(deps.prisma, actor, { threadId: requested.id }),
            actor,
          )
        : null;
      return {
        me,
        workspaces: spaces,
        doodle,
        chats,
        thread,
        ...(threadSpaceId ? { threadSpaceId } : {}),
      };
    }),
  };
}
