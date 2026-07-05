import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { adminApi } from "../../api/admin";
import { erpApi } from "../../api/erp";
import type { FilterOption } from "./ErpFinanceFilter";

/**
 * Populates the §15.3 global-filter dropdowns for any finance screen:
 *  - agents from the admin agents list (stable, independent of the filter);
 *  - properties from the FY's dashboard `commissionByProperty` — fetched with ONLY
 *    the financial year, so selecting a property/agent never collapses the property
 *    list to the single selected one.
 * Both are lightly cached; every figure is still server-owned.
 */
export function useErpFilterOptions(financialYear?: number): {
  propertyOptions: FilterOption[];
  agentOptions: FilterOption[];
} {
  const agents = useQuery({
    queryKey: ["erp", "agent-options"],
    queryFn: () => adminApi.listAgents(undefined, 50),
    staleTime: 5 * 60_000,
  });
  const agentOptions = useMemo<FilterOption[]>(
    () => (agents.data?.items ?? []).map((a) => ({ id: a.id, label: a.fullName })),
    [agents.data],
  );

  const properties = useQuery({
    queryKey: ["erp", "property-options", financialYear ?? null],
    queryFn: () => erpApi.dashboard({ financialYear }),
    staleTime: 5 * 60_000,
  });
  const propertyOptions = useMemo<FilterOption[]>(
    () => (properties.data?.commissionByProperty ?? []).map((p) => ({ id: p.listingId, label: p.listingAlias })),
    [properties.data],
  );

  return { propertyOptions, agentOptions };
}
