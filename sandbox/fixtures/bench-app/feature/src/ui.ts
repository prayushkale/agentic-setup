// Browser helpers for the invoice page. `el` is any element-like object.
export function markOverdue(el: { innerHTML: string }): void {
  el.innerHTML = '<strong class="badge">Overdue</strong>';
}

export function showNote(el: { textContent: string | null }, note: string): void {
  el.textContent = note;
}
