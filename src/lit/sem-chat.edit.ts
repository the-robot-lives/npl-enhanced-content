/**
 * sem-chat — edit descriptor (data bucket, Phase 2 — HAND-WRITTEN).
 *
 * sem-chat is absent from elements.json (agent-kit element outside the
 * normative schema); the schema service seeds a schema-complete spec for it
 * (schema/load-schema.ts) and this descriptor is its edit face. Three
 * authoring surfaces:
 *
 *  - the `<script type="application/json">` fixture payload — declared via
 *    `jsonItems`; the property modal edits it as a validated list in a raw
 *    text node (the model parses script bodies as ONE raw text node, edits
 *    are byte-exact `setText`s, and the payload never executes — §8 renders
 *    it as an inert template holder);
 *  - the authored zero-JS transcript — `<div class="sem-chat-msg">`
 *    children with a `.sem-chat-content` span; the span is a text slot;
 *  - `endpoint`, the one URL attribute, as a link field (§8-checked).
 *
 * No `regions()`/`rerender()` yet: the element's `#wire` builds its
 * transcript chrome (`.sem-chat-log` / `.sem-chat-error` /
 * `.sem-chat-composer`) WITHOUT the `data-sem-chrome` mark and moves the
 * authored msg nodes INTO the log, so attach-after-enhance bakes runtime
 * chrome into the model and the slot selector loses its `:scope >` anchor
 * once msgs are re-parented. Fixing that is an element/attach change
 * (cross-lane request with the exact patch in the lane report); until it
 * lands, edit chat attached in the authored form — which is what the lazy
 * edit-mode hook and these tests do.
 */

import { registerDescriptor } from '../editor/schema/registry.js';

const MSG = ':scope > .sem-chat-msg > .sem-chat-content';

registerDescriptor({
  tag: 'sem-chat',
  title: 'Chat',
  bucket: 'data',
  summary: 'An endpoint-driven chat transcript with a composer (fixtures or live).',
  textSlots: [
    {
      selector: MSG,
      label: 'Message',
      multiline: true,
      placeholder: 'Message text…',
      escape: 'entities',
    },
  ],
  linkFields: [{ attr: 'endpoint', label: 'Endpoint URL' }],
  jsonItems: {
    selector: ':scope > script[type="application/json"]',
    label: 'Fixture payload (JSON)',
    schemaHint:
      '{ "rooms": [{ "id": "room-1", "name": "General" }], ' +
      '"messages": [{ "id": "m1", "room_id": "room-1", "sender": "user", "content": "hi" }] } ' +
      '— the shapes of GET /chat/rooms and GET /chat/rooms/:id/messages. ' +
      'While a payload is present the element never fetches the endpoint.',
  },
  templates: [
    {
      id: 'sem-chat-fixtures',
      label: 'Chat (fixture payload)',
      group: 'Data',
      xml:
        '<sem-chat id="${1:chat-id}">\n' +
        '  <script type="application/json">${2:chat-fixture-json}</script>\n' +
        '</sem-chat>',
    },
    {
      id: 'sem-chat-endpoint',
      label: 'Chat (endpoint)',
      group: 'Data',
      xml: '<sem-chat id="${1:chat-id}" endpoint="${2:/chat/api}"></sem-chat>',
    },
    {
      id: 'sem-chat-transcript',
      label: 'Chat (authored transcript)',
      group: 'Data',
      xml:
        '<sem-chat id="${1:chat-id}" endpoint="${2:/chat/api}">\n' +
        '  <div class="sem-chat-msg" data-role="${3|user,assistant|}" data-id="${4:msg-1}">\n' +
        '    <span class="sem-chat-content">${5:Message text}</span>\n' +
        '  </div>\n' +
        '</sem-chat>',
    },
  ],
});
