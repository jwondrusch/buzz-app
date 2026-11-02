import { Service, type Context } from "@deepseek-ai/cordis";
import type { ComponentType } from "react";
import {
  createContributions,
  type Contribution,
} from "../../plugins/contributions";

/** While registered, the sidebar shows only Solo: the All/Solo/Team tabs and
 * page destinations give way to `banner`, and the saved tab returns after. */
export type SidebarRestriction = Readonly<{
  id: string;
  scope: "solo";
  banner: ComponentType;
  /** `solo` (the default) also keeps other conversations from opening;
   * `any` hides them from the sidebar only, so search and links still work. */
  reach?: "solo" | "any";
}>;
export type RegisteredSidebarRestriction = Contribution<SidebarRestriction>;
export type SidebarScope = Readonly<{
  snapshot(): readonly RegisteredSidebarRestriction[];
  subscribe(listener: () => void): () => void;
  /** Returns a remover; disabling the plugin removes it too. */
  restrict(restriction: SidebarRestriction): () => void;
}>;

declare module "@deepseek-ai/cordis" {
  interface Context {
    sidebarScope: SidebarScope;
  }
}

export class SidebarScopeService extends Service implements SidebarScope {
  private readonly restrictions;
  constructor(ctx: Context) {
    super(ctx, "sidebarScope");
    this.restrictions = createContributions<SidebarRestriction>(ctx);
  }
  snapshot = () => this.restrictions.snapshot();
  subscribe = (listener: () => void) => this.restrictions.subscribe(listener);
  restrict(restriction: SidebarRestriction) {
    if (
      !restriction ||
      typeof restriction.id !== "string" ||
      !/^[a-z0-9][a-z0-9._-]*$/.test(restriction.id) ||
      restriction.scope !== "solo" ||
      (restriction.reach !== undefined &&
        restriction.reach !== "solo" &&
        restriction.reach !== "any") ||
      typeof restriction.banner !== "function"
    )
      throw new Error("A sidebar restriction needs an id, scope and banner");
    return this.restrictions.register(this.ctx, restriction);
  }
}

/** Whether a restriction keeps conversations outside Solo from opening. */
export function soloReach(scope: SidebarScope | undefined) {
  return !!scope?.snapshot().some((item) => item.reach !== "any");
}
