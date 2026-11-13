import { html } from 'lit'

/**
 * Иконки (20×20, currentColor) и превью-подсказки (170×68) для своих пунктов «/»-меню —
 * в той же манере, что встроенные Heading/Quote/Code Block из @blocksuite/blocks.
 */

// prettier-ignore
export const CarouselIcon = html`<svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
<rect x="4.75" y="4.25" width="10.5" height="9" rx="1.5" stroke="currentColor" stroke-width="1.5"/>
<path d="M2 7v4M18 7v4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
<path d="M6.5 11.5l2.25-2.5 1.75 1.75 1.25-1.25 1.75 2" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>
<circle cx="8" cy="16.5" r="0.9" fill="currentColor"/><circle cx="10" cy="16.5" r="0.9" fill="currentColor" opacity=".45"/><circle cx="12" cy="16.5" r="0.9" fill="currentColor" opacity=".45"/>
</svg>`

// prettier-ignore
export const PollIcon = html`<svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
<path d="M3 4.5h8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
<rect x="3" y="8" width="14" height="3" rx="1.5" stroke="currentColor" stroke-width="1.3"/>
<rect x="3" y="8" width="9" height="3" rx="1.5" fill="currentColor" opacity=".35"/>
<rect x="3" y="13.5" width="14" height="3" rx="1.5" stroke="currentColor" stroke-width="1.3"/>
<rect x="3" y="13.5" width="4.5" height="3" rx="1.5" fill="currentColor" opacity=".35"/>
</svg>`

// prettier-ignore
export const CalloutIcon = html`<svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
<rect x="2.75" y="3.75" width="14.5" height="12.5" rx="2" stroke="currentColor" stroke-width="1.5"/>
<path d="M2.75 5.75v8.5" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>
<path d="M7.5 8h6.5M7.5 11.5h4.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
</svg>`

// prettier-ignore
export const CarouselTooltip = html`<svg width="170" height="68" viewBox="0 0 170 68" fill="none" xmlns="http://www.w3.org/2000/svg">
<rect width="170" height="68" rx="2" fill="white"/>
<rect x="10" y="10" width="44" height="34" rx="3" fill="#E9E8EC"/>
<rect x="63" y="10" width="44" height="34" rx="3" fill="#C9C7CF"/>
<path d="M70 38l8-9 6 6 4-4 9 7" stroke="white" stroke-width="2" stroke-linejoin="round"/>
<circle cx="96" cy="19" r="3" fill="white"/>
<rect x="116" y="10" width="44" height="34" rx="3" fill="#E9E8EC"/>
<path d="M4 27l3-3v6z" fill="#C2C1C5"/><path d="M166 27l-3-3v6z" fill="#C2C1C5"/>
<circle cx="79" cy="55" r="2" fill="#121212"/><circle cx="85" cy="55" r="2" fill="#C2C1C5"/><circle cx="91" cy="55" r="2" fill="#C2C1C5"/>
</svg>`

// prettier-ignore
export const PollTooltip = html`<svg width="170" height="68" viewBox="0 0 170 68" fill="none" xmlns="http://www.w3.org/2000/svg">
<rect width="170" height="68" rx="2" fill="white"/>
<text fill="#121212" xml:space="preserve" style="white-space: pre" font-family="Inter" font-size="10" font-weight="600" letter-spacing="0px"><tspan x="12" y="18">О чём написать дальше?</tspan></text>
<rect x="12" y="26" width="146" height="14" rx="3" stroke="#E3E2E4"/>
<rect x="12" y="26" width="98" height="14" rx="3" fill="#E9E8EC"/>
<text fill="#121212" font-family="Inter" font-size="8.5"><tspan x="18" y="36">Identity и DID</tspan></text>
<text fill="#8E8D91" font-family="Inter" font-size="8.5"><tspan x="138" y="36">67%</tspan></text>
<rect x="12" y="45" width="146" height="14" rx="3" stroke="#E3E2E4"/>
<rect x="12" y="45" width="48" height="14" rx="3" fill="#E9E8EC"/>
<text fill="#121212" font-family="Inter" font-size="8.5"><tspan x="18" y="55">Лексиконы</tspan></text>
<text fill="#8E8D91" font-family="Inter" font-size="8.5"><tspan x="138" y="55">33%</tspan></text>
</svg>`

// prettier-ignore
export const CalloutTooltip = html`<svg width="170" height="68" viewBox="0 0 170 68" fill="none" xmlns="http://www.w3.org/2000/svg">
<rect width="170" height="68" rx="2" fill="white"/>
<rect x="10" y="12" width="150" height="44" rx="4" fill="#EBF2FE"/>
<rect x="10" y="12" width="3" height="44" rx="1.5" fill="#3B82F6"/>
<text font-family="Inter" font-size="14"><tspan x="20" y="39">💡</tspan></text>
<text fill="#121212" xml:space="preserve" style="white-space: pre" font-family="Inter" font-size="10" letter-spacing="0px"><tspan x="42" y="30">Важно: подпишите метку</tspan><tspan x="42" y="44">ключом своей коллегии.</tspan></text>
</svg>`
