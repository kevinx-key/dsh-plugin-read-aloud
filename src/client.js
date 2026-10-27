/**
 * Client entry: register the assistant-message action, mount the global
 * selection menu/floating player, and own the controller for the plugin
 * lifetime.
 */

import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { ReadAloudController } from './controller.js'
import { ReadAloudAction, ReadAloudGlobal } from './ui.jsx'
import { READ_ALOUD_CSS } from './styles.js'

const PLUGIN_ID = 'dsh-plugin-read-aloud'
const STYLE_ATTR = 'data-read-aloud-style'

/** Required services: the slot registry that owns the action strip. */
export const inject = ['slots']

/**
 * Register the per-message speaker entry.
 * @param {import('@deepseek-ai/cordis').Context} ctx - client root context.
 */
export function apply(ctx) {
  if (typeof document === 'undefined') return

  const controller = new ReadAloudController()

  ctx.effect(() => {
    let style = document.head.querySelector(`style[${STYLE_ATTR}="${PLUGIN_ID}"]`)
    if (style === null) {
      style = document.createElement('style')
      style.setAttribute(STYLE_ATTR, PLUGIN_ID)
      style.dataset.plugin = PLUGIN_ID
      style.textContent = READ_ALOUD_CSS
      document.head.appendChild(style)
    }

    const globalHost = document.createElement('div')
    globalHost.setAttribute('data-read-aloud-global', PLUGIN_ID)
    document.body.appendChild(globalHost)
    const root = createRoot(globalHost)
    root.render(createElement(ReadAloudGlobal, { controller }))

    const onPageHide = () => { controller.dispose() }
    window.addEventListener('pagehide', onPageHide, { once: true })

    return () => {
      controller.dispose()
      window.removeEventListener('pagehide', onPageHide)
      root.unmount()
      globalHost.remove()
      style?.remove()
    }
  }, 'read-aloud: lifecycle')

  ctx.slots.inject('conversation.chat.assistant-actions', () => ctx.slots.register({
    name: 'conversation.chat.assistant-actions',
    id: 'read-aloud',
    order: 5,
    inject: () => ({
      hooks: { readAloud: controller },
      start: (messageId, anchor) => controller.start(messageId, anchor),
      pause: () => controller.pause(),
      resume: () => controller.resume(),
      stop: () => controller.stop(),
      restart: () => controller.restart(),
      setRate: value => controller.setRate(value),
      setVoice: uri => controller.setVoice(uri),
      refreshVoices: () => controller.refreshVoices(),
      openPanel: () => controller.openPanel(),
      closePanel: () => controller.closePanel(),
    }),
  }, ReadAloudAction))
}
