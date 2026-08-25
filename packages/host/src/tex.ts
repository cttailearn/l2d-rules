// tex.ts —— 宿主纹理解码（L2dmPlayer 需要 atlas: Map<string, Tex2D> 才能渲染带纹理模型）
// 职责边界：engine 明确“纹理解码/上传管理归宿主”；本文件即 SDK 侧（@l2dp/host）对 .l2dm
// 内嵌 atlas(data URI) 的标准解码器：dataUriToBytes → cutout.decodePng → Tex2D。
// 纯 ts，兼容 Node/浏览器；确定性纯函数。
import { dataUriToBytes, decodePng } from "@l2dp/cutout";
import type { Tex2D } from "@l2dp/engine";

/** 把 .l2dm 内嵌 atlas（文件名 → data URI/base64）解码成 engine 的 Tex2D 表。 */
export function decodeModelAtlas(atlas: Record<string, string> | undefined): Map<string, Tex2D> {
  const out = new Map<string, Tex2D>();
  for (const [key, uri] of Object.entries(atlas ?? {})) {
    try {
      const img = decodePng(dataUriToBytes(uri));
      out.set(key, { width: img.width, height: img.height, data: img.data });
    } catch (e) {
      throw new Error("atlas '" + key + "' 解码失败: " + (e instanceof Error ? e.message : String(e)));
    }
  }
  return out;
}