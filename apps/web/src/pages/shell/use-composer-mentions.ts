import type { Chat, Connection, ConnectionCatalogItem } from "@labradoodle/contracts";
import { buildComposerMentionOptions, mentionConnectorsFrom } from "@labradoodle/core";
import { useLingui } from "@lingui/react/macro";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { connectedAppMarks } from "../../lib/connected-apps";
import { cronLabels } from "../../lib/cron";
import type { SpaceQueries } from "../../lib/query";
import { queryClient } from "../../lib/query";
import type { createSpaceRpc } from "../../lib/rpc";

function connectedAppMarksOf(
  data: { catalog: ConnectionCatalogItem[] | null; connections: Connection[] | null } | undefined,
) {
  return data?.catalog && data.connections ? connectedAppMarks(data.catalog, data.connections) : [];
}

/**
 * What the composer can @mention in the open chat: the people in it, and Doodle with its
 * routines and the person's apps while Doodle is on. Also the apps the sidebar footer shows.
 */
export function useComposerMentions({
  rpc,
  queries,
  chat,
  userId,
  integrationsOpen,
  ready,
}: {
  rpc: ReturnType<typeof createSpaceRpc>;
  queries: SpaceQueries;
  chat: Chat | undefined;
  userId: string | undefined;
  integrationsOpen: boolean;
  ready: boolean;
}) {
  const { i18n } = useLingui();
  const doodle = chat?.doodle === true;
  const routines = useQuery({
    ...queries.routines.list.queryOptions({ input: { threadId: chat?.id ?? "" } }),
    enabled: Boolean(chat) && doodle,
  }).data;
  const composerConnections = useQuery({
    queryKey: [...queries.connections.catalog.queryKey({ input: {} }), "with-connections"],
    // The catalog call reconciles connection rows, so list them after it.
    queryFn: async () => {
      const catalog = await rpc.connections.catalog({}).catch(() => null);
      const connections = await rpc.connections.list().catch(() => null);
      return { catalog, connections };
    },
    enabled: ready,
  });
  // Apps can change in the integrations overlay; leaving it refreshes what the composer offers.
  const wasIntegrationsOpen = useRef(integrationsOpen);
  useEffect(() => {
    if (wasIntegrationsOpen.current && !integrationsOpen) {
      void queryClient.invalidateQueries({ queryKey: queries.connections.key() });
    }
    wasIntegrationsOpen.current = integrationsOpen;
  }, [integrationsOpen, queries]);
  const [footerLogos, setFooterLogos] = useState(() =>
    connectedAppMarksOf(composerConnections.data),
  );
  useEffect(() => {
    if (composerConnections.data?.catalog && composerConnections.data.connections) {
      setFooterLogos(connectedAppMarksOf(composerConnections.data));
    }
  }, [composerConnections.data]);
  const mentionConnectors = useMemo(() => {
    const { catalog, connections } = composerConnections.data ?? {};
    return mentionConnectorsFrom(connections ?? [], catalog ?? []);
  }, [composerConnections.data]);
  const composerMentionTargets = useMemo(
    () =>
      buildComposerMentionOptions({
        query: "",
        doodle,
        people: (chat?.members ?? [])
          .filter((member) => member.userId !== userId)
          .map((member) => ({ id: member.userId, name: member.name })),
        routines: doodle
          ? (routines ?? []).map((routine) => ({
              id: routine.id,
              name: routine.name,
              crons: routine.crons,
            }))
          : [],
        connectors: doodle ? mentionConnectors : [],
        cronLabels: cronLabels(i18n.locale),
      }),
    [chat?.members, doodle, i18n.locale, mentionConnectors, routines, userId],
  );
  return { composerMentionTargets, footerLogos, setFooterLogos };
}
