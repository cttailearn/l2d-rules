// 场景渲染排序（规格 6.2：drawOrder/opacity/blendMode；服装组切换）
export interface RenderPart {
  id: string;
  drawOrder: number;
  opacity: number;
  blendMode: "normal" | "add" | "multiply";
  visible: boolean;
  category: "body" | "clothing";
  costumeGroup: number | null;
  texturePage: number;
  meshId: string | null;
}

export interface SceneOptions {
  activeCostumeGroup: number | null; // null=全部显示（编辑态）
}

export function buildRenderList(parts: RenderPart[], opts: SceneOptions): RenderPart[] {
  const filtered = parts.filter(p => {
    if (!p.visible) return false;
    if (p.category === "clothing" && opts.activeCostumeGroup !== null && p.costumeGroup !== null && p.costumeGroup !== opts.activeCostumeGroup) return false;
    return true;
  });
  return [...filtered].sort((a, b) => a.drawOrder - b.drawOrder);
}
