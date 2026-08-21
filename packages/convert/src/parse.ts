// parse.ts —— 官方 JSON 结构解析（宽松、防御，坏字段降级为缺省）
// 与 l2dp validate 的分工：这里只保证"读得动真实官方文件"，不承担语义深度校验；
// 产出给 convert.ts 使用。任何字段缺失/错型都给出明确 error 或忽略（非致命）。

import type {
  Cdi3Json, Exp3Json, Model3Json, Motion3Json, Physics3Json, Physics3Setting, Pose3Json, UserData3Json,
} from "./types.ts";

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

export function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function str(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function bool(v: unknown): boolean | undefined {
  return typeof v === "boolean" ? v : undefined;
}

// ---------------- model3.json ----------------

export function parseModel3(raw: unknown): ParseResult<Model3Json> {
  if (!isObj(raw)) return { ok: false, error: "model3 根必须是 JSON 对象" };
  const fr = raw.FileReferences;
  if (!isObj(fr) || typeof fr.Moc !== "string") {
    return { ok: false, error: "model3 缺 FileReferences.Moc" };
  }
  const textures = (Array.isArray(fr.Textures) ? fr.Textures : []).filter((t): t is string => typeof t === "string");
  const expr: Model3Json["FileReferences"]["Expressions"] = [];
  if (Array.isArray(fr.Expressions)) {
    for (const e of fr.Expressions) {
      if (isObj(e) && typeof e.Name === "string" && typeof e.File === "string") {
        expr.push({ Name: e.Name, File: e.File });
      }
    }
  }
  const mot: Model3Json["FileReferences"]["Motions"] = {};
  if (isObj(fr.Motions)) {
    for (const [group, list] of Object.entries(fr.Motions)) {
      if (!Array.isArray(list)) continue;
      mot[group] = list
        .filter((m): m is Record<string, unknown> => isObj(m) && typeof m.File === "string")
        .map((m) => ({
          File: m.File as string,
          FadeInTime: num(m.FadeInTime),
          FadeOutTime: num(m.FadeOutTime),
          Sound: str(m.Sound),
        }));
    }
  }
  const groups: Model3Json["Groups"] = [];
  if (Array.isArray(raw.Groups)) {
    for (const g of raw.Groups) {
      if (isObj(g) && typeof g.Name === "string" && Array.isArray(g.Ids)) {
        groups.push({
          Target: str(g.Target) ?? "Parameter",
          Name: g.Name,
          Ids: g.Ids.filter((x): x is string => typeof x === "string"),
        });
      }
    }
  }
  const hitAreas: Model3Json["HitAreas"] = [];
  if (Array.isArray(raw.HitAreas)) {
    for (const h of raw.HitAreas) {
      if (isObj(h) && typeof h.Id === "string") {
        hitAreas.push({ Id: h.Id, Name: str(h.Name) ?? h.Id });
      }
    }
  }
  const layout: Record<string, number> = {};
  if (isObj(raw.Layout)) {
    for (const [k, v] of Object.entries(raw.Layout)) {
      const n = num(v);
      if (n !== undefined) layout[k] = n;
    }
  }
  return {
    ok: true,
    value: {
      Version: num(raw.Version) ?? 3,
      FileReferences: {
        Moc: fr.Moc,
        Textures: textures,
        Physics: str(fr.Physics),
        Pose: str(fr.Pose),
        DisplayInfo: str(fr.DisplayInfo),
        UserData: str(fr.UserData),
        Expressions: expr,
        Motions: mot,
      },
      Groups: groups,
      HitAreas: hitAreas,
      Layout: Object.keys(layout).length > 0 ? layout : undefined,
    },
  };
}

// ---------------- cdi3.json（显示信息：参数/分组/部件目录） ----------------

export function parseCdi3(raw: unknown): ParseResult<Cdi3Json> {
  if (!isObj(raw)) return { ok: false, error: "cdi3 根必须是 JSON 对象" };
  const params: Cdi3Json["Parameters"] = [];
  if (Array.isArray(raw.Parameters)) {
    for (const p of raw.Parameters) {
      if (isObj(p) && typeof p.Id === "string") {
        params.push({ Id: p.Id, GroupId: str(p.GroupId), Name: str(p.Name) });
      }
    }
  }
  const pgroups: Cdi3Json["ParameterGroups"] = [];
  if (Array.isArray(raw.ParameterGroups)) {
    for (const g of raw.ParameterGroups) {
      if (isObj(g) && typeof g.Id === "string") {
        pgroups.push({ Id: g.Id, GroupId: str(g.GroupId), Name: str(g.Name) });
      }
    }
  }
  const parts: Cdi3Json["Parts"] = [];
  if (Array.isArray(raw.Parts)) {
    for (const p of raw.Parts) {
      if (isObj(p) && typeof p.Id === "string") parts.push({ Id: p.Id, Name: str(p.Name) });
    }
  }
  return { ok: true, value: { Version: num(raw.Version), Parameters: params, ParameterGroups: pgroups, Parts: parts } };
}

// ---------------- physics3.json ----------------

export function parsePhysics3(raw: unknown): ParseResult<Physics3Json> {
  if (!isObj(raw)) return { ok: false, error: "physics3 根必须是 JSON 对象" };
  const meta = isObj(raw.Meta) ? raw.Meta : {};
  const dict = (Array.isArray(meta.PhysicsDictionary) ? meta.PhysicsDictionary : [])
    .filter((d): d is Record<string, unknown> => isObj(d) && typeof d.Id === "string")
    .map((d) => ({ Id: d.Id as string, Name: str(d.Name) }));
  const settings: Physics3Setting[] = [];
  if (Array.isArray(raw.PhysicsSettings)) {
    for (const s of raw.PhysicsSettings) {
      if (!isObj(s)) continue;
      settings.push({
        Id: str(s.Id),
        Input: (Array.isArray(s.Input) ? s.Input : [])
          .filter((i): i is Record<string, unknown> => isObj(i))
          .map((i) => ({
            Source: isObj(i.Source) ? { Target: str(i.Source.Target), Id: str(i.Source.Id) } : undefined,
            Weight: num(i.Weight),
            Type: str(i.Type),
            Reflect: bool(i.Reflect),
          })),
        Output: (Array.isArray(s.Output) ? s.Output : [])
          .filter((o): o is Record<string, unknown> => isObj(o))
          .map((o) => ({
            Destination: isObj(o.Destination) ? { Target: str(o.Destination.Target), Id: str(o.Destination.Id) } : undefined,
            VertexIndex: num(o.VertexIndex),
            Scale: num(o.Scale),
            Weight: num(o.Weight),
            Type: str(o.Type),
            Reflect: bool(o.Reflect),
          })),
        Vertices: (Array.isArray(s.Vertices) ? s.Vertices : [])
          .filter((v): v is Record<string, unknown> => isObj(v))
          .map((v) => ({
            Position: isObj(v.Position) ? { X: num(v.Position.X), Y: num(v.Position.Y) } : undefined,
            Mobility: num(v.Mobility),
            Delay: num(v.Delay),
            Acceleration: num(v.Acceleration),
            Radius: num(v.Radius),
          })),
        Normalization: (() => {
          if (!isObj(s.Normalization)) return undefined;
          const tri = (o: unknown): [number, number, number] => {
            const x = isObj(o) ? o : {};
            return [num(x.Minimum) ?? 0, num(x.Default) ?? 0, num(x.Maximum) ?? 0];
          };
          return { position: tri(s.Normalization.Position), angle: tri(s.Normalization.Angle) };
        })(),
      });
    }
  }
  return {
    ok: true,
    value: {
      Version: num(raw.Version),
      Meta: {
        PhysicsSettingCount: num(meta.PhysicsSettingCount),
        TotalInputCount: num(meta.TotalInputCount),
        TotalOutputCount: num(meta.TotalOutputCount),
        VertexCount: num(meta.VertexCount),
        EffectiveForces: isObj(meta.EffectiveForces)
          ? {
            Gravity: isObj(meta.EffectiveForces.Gravity)
              ? { X: num(meta.EffectiveForces.Gravity.X), Y: num(meta.EffectiveForces.Gravity.Y) } : undefined,
            Wind: isObj(meta.EffectiveForces.Wind)
              ? { X: num(meta.EffectiveForces.Wind.X), Y: num(meta.EffectiveForces.Wind.Y) } : undefined,
          } : undefined,
        PhysicsDictionary: dict,
      },
      PhysicsSettings: settings,
    },
  };
}

// ---------------- pose3.json / userdata3.json ----------------

export function parsePose3(raw: unknown): ParseResult<Pose3Json> {
  if (!isObj(raw)) return { ok: false, error: "pose3 根必须是 JSON 对象" };
  const groups: Pose3Json["Groups"] = [];
  if (Array.isArray(raw.Groups)) {
    for (const g of raw.Groups) {
      if (!Array.isArray(g)) continue;
      const ids: { Id: string; Link: string[] }[] = [];
      for (const e of g) {
        if (isObj(e) && typeof e.Id === "string") {
          ids.push({ Id: e.Id, Link: Array.isArray(e.Link) ? e.Link.filter((x): x is string => typeof x === "string") : [] });
        }
      }
      groups.push(ids);
    }
  }
  return { ok: true, value: { Type: str(raw.Type), Groups: groups } };
}

export function parseUserData3(raw: unknown): ParseResult<UserData3Json> {
  if (!isObj(raw)) return { ok: false, error: "userdata3 根必须是 JSON 对象" };
  const list: UserData3Json["UserData"] = [];
  if (Array.isArray(raw.UserData)) {
    for (const u of raw.UserData) {
      if (isObj(u) && typeof u.Id === "string") list.push({ Target: str(u.Target), Id: u.Id, Value: str(u.Value) });
    }
  }
  return { ok: true, value: { Version: num(raw.Version), UserData: list } };
}

// ---------------- motion3.json / exp3.json ----------------

export function parseMotion3(raw: unknown): ParseResult<Motion3Json> {
  if (!isObj(raw)) return { ok: false, error: "motion3 根必须是 JSON 对象" };
  const meta = isObj(raw.Meta) ? raw.Meta : {};
  const curves: Motion3Json["Curves"] = [];
  if (Array.isArray(raw.Curves)) {
    for (const c of raw.Curves) {
      if (isObj(c) && typeof c.Id === "string" && Array.isArray(c.Segments)) {
        curves.push({
          Target: str(c.Target),
          Id: c.Id,
          Segments: c.Segments.filter((x): x is number => typeof x === "number" && Number.isFinite(x)),
        });
      }
    }
  }
  return {
    ok: true,
    value: {
      Version: num(raw.Version),
      Meta: { Duration: num(meta.Duration), Fps: num(meta.Fps), Loop: bool(meta.Loop) },
      Curves: curves,
    },
  };
}

export function parseExp3(raw: unknown): ParseResult<Exp3Json> {
  if (!isObj(raw)) return { ok: false, error: "exp3 根必须是 JSON 对象" };
  const list: Exp3Json["Parameters"] = [];
  if (Array.isArray(raw.Parameters)) {
    for (const p of raw.Parameters) {
      if (isObj(p) && typeof p.Id === "string") {
        const b = str(p.Blend);
        list.push({
          Id: p.Id,
          Value: num(p.Value),
          Blend: b === "Add" || b === "Multiply" || b === "Overwrite" ? b : "Add",
        });
      }
    }
  }
  return { ok: true, value: { Type: str(raw.Type), Parameters: list } };
}
