/**
 * sem-facts — edit descriptor (pilot, schema lane).
 *
 * The item list is the light-DOM `sem-fact` children (either authoring
 * form via sel()); each inserted fact rebuilds through the document
 * factories with fresh ids (adoption rule, EDITOR.md §2.3). The per-fact
 * statement/conclusion slots belong to a sem-fact descriptor — a Phase 2
 * data-bucket deliverable; until it lands, fact text is editable through
 * the code view and facts are added/removed/reordered here.
 */

import { registerDescriptor } from '../editor/schema/registry.js';
import { sel } from '../shared/sel.js';

const FACT = ':scope > ' + sel('fact');

registerDescriptor({
  tag: 'sem-facts',
  title: 'Facts',
  bucket: 'data',
  summary: 'A collection of fact/claim pairs.',
  itemList: {
    childSelector: FACT,
    label: 'fact',
    template: {
      id: 'sem-fact',
      label: 'Fact',
      xml:
        '<sem-fact>\n' +
        '  <statement>${1:Statement}</statement>\n' +
        '  <conclusion>${2:Conclusion}</conclusion>\n' +
        '</sem-fact>',
    },
  },
  templates: [
    {
      id: 'sem-facts',
      label: 'Facts',
      group: 'Data',
      xml:
        '<sem-facts id="${1:facts-id}" view-as="${2|list,flashcards,quiz|}">\n' +
        '  <sem-fact id="${3:fact-id}">\n' +
        '    <statement>${4:Statement}</statement>\n' +
        '    <conclusion>${5:Conclusion}</conclusion>\n' +
        '  </sem-fact>\n' +
        '</sem-facts>',
    },
  ],
});
