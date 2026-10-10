export function renderMenuItems(items) {
  return items.map((item) => ({
    ...item,
    label: item.label || 'Item',
    action: item.action || (() => {})
  }));
}

export function openModal(id) {
  const modal = document.getElementById(id);
  if (modal) modal.classList.add('active');
}

export function closeModal(id) {
  const modal = document.getElementById(id);
  if (modal) modal.classList.remove('active');
}
