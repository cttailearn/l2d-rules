// 共享样例角色：demo-chan（P4a 测试 + golden 生成共用，保证完全同源）
import { rigCharacter, type RigCharacterSpec, type RigResult } from "../src/index.ts";

export function sampleSpec(): RigCharacterSpec {
  return {
    id: "demo-chan",
    canvas: { width: 480, height: 640 },
    parts: [
      { id: "hair-back", semantic: "hair_back", bbox: { x: 138, y: 78, width: 204, height: 264 } },
      { id: "neck", semantic: "neck", bbox: { x: 224, y: 298, width: 32, height: 44 } },
      { id: "body", semantic: "body_upper", bbox: { x: 168, y: 330, width: 144, height: 188 } },
      { id: "hair-side-l", semantic: "hair_side", bbox: { x: 148, y: 138, width: 30, height: 168 } },
      { id: "hair-side-r", semantic: "hair_side", side: "right", bbox: { x: 302, y: 138, width: 30, height: 168 } },
      { id: "face", semantic: "face", bbox: { x: 174, y: 138, width: 132, height: 168 } },
      { id: "nose", semantic: "nose", bbox: { x: 234, y: 252, width: 12, height: 16 } },
      { id: "mouth", semantic: "mouth", bbox: { x: 219, y: 266, width: 42, height: 22 } },
      { id: "eyeball-l", semantic: "eyeball", bbox: { x: 204, y: 192, width: 26, height: 22 } },
      { id: "eyeball-r", semantic: "eyeball", side: "right", bbox: { x: 250, y: 192, width: 26, height: 22 } },
      { id: "eye-l", semantic: "eye", bbox: { x: 198, y: 186, width: 38, height: 22 } },
      { id: "eye-r", semantic: "eye", side: "right", bbox: { x: 244, y: 186, width: 38, height: 22 } },
      { id: "brow-l", semantic: "brow", bbox: { x: 198, y: 172, width: 40, height: 9 } },
      { id: "brow-r", semantic: "brow", side: "right", bbox: { x: 244, y: 172, width: 40, height: 9 } },
      { id: "hair-front", semantic: "hair_front", bbox: { x: 168, y: 126, width: 144, height: 78 } },
    ],
  };
}

export function sampleRig(): RigResult {
  return rigCharacter(sampleSpec());
}
