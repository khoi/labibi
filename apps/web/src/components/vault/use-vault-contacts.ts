import { useQuery } from "@tanstack/react-query";
import { useSpaceQueries } from "../../lib/query";
import type { BillingContact } from "./VaultItemEditor";

/** The saved contacts in the member's vault, which a card can bill to. */
export function useVaultContacts(): BillingContact[] | undefined {
  const queries = useSpaceQueries();
  const { data } = useQuery(queries.vault.list.queryOptions());
  return data?.flatMap((item) =>
    item.auth?.type === "contact" ? [{ name: item.name, title: item.title }] : [],
  );
}
