import { html } from '../../vendor/htm.mjs';


export function Modal({ children, onClose }) {
  const onOverlayClick = (e) => {
    if (e.target === e.currentTarget && onClose) onClose();
  };
  return html`
    <div class="modal-overlay" onClick=${onOverlayClick}>
      <div class="modal">${children}</div>
    </div>
  `;
}
