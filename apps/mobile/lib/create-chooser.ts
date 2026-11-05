import type { MenuAction } from "@expo/ui/community/menu";
import { materialIcons } from "./material-icons";

export type CreateAction = "group";

export const createMenuItems = [
  { id: "group", label: "New group chat", sfSymbol: "person.2", materialIcon: "group" },
] as const;

export function createMenuActions(t: (text: string) => string, platform: string): MenuAction[] {
  return createMenuItems.map(({ id, label, sfSymbol, materialIcon }) => ({
    id,
    title: t(label),
    image: platform === "ios" ? sfSymbol : materialIcons[materialIcon],
  }));
}

export function isCreateAction(id: string): id is CreateAction {
  return createMenuItems.some((item) => item.id === id);
}
