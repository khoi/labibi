/**
 * Skills, MCP servers and plugin or tool-source installs belong to the person who added them and
 * work in every Space of theirs. Their secrets are the account's, so each of those Spaces reads them.
 */
export function itemSecretIn(scope: { userId: string }) {
  return { userId: scope.userId, spaceId: null };
}
