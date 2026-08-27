// dom.ts —— 极简 DOM 取元素助手（页面胶水共用）
export function need(id: string): HTMLElement {
  const node = document.getElementById(id);
  if (!node) throw new Error("缺少 #" + id);
  return node;
}

export function needInput(id: string): HTMLInputElement {
  return need(id) as HTMLInputElement;
}

export function needBtn(id: string): HTMLButtonElement {
  return need(id) as HTMLButtonElement;
}
