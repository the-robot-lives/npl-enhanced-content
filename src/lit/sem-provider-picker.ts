import { SemElement } from './base.js';

/**
 * sem-provider-picker — radio group for choosing an AI provider.
 *
 * Pure presentation + selection state: ids and labels only. No keys, no base
 * URLs, no secret names — the caller maps a provider id onto whatever its
 * plumbing needs. Light DOM per PRD §4 rule 5, like every SemText element;
 * pages style the `.sem-*` classes with ordinary theme CSS (the vocabulary
 * sheet carries no rules for this one — it is app chrome, not spec markup).
 */

/** The list is one place to edit: add a provider here, nothing else changes. */
export const PROVIDERS = [
  { id: 'zai', label: 'z.ai', note: 'GLM models — default account' },
  { id: 'zai-alt', label: 'z.ai (alt account)', note: 'GLM models — second account' },
  { id: 'dashscope', label: 'Alibaba DashScope', note: 'Qwen models via DashScope' },
  { id: 'anthropic', label: 'Anthropic', note: 'Claude models' },
  { id: 'deepseek', label: 'DeepSeek', note: 'DeepSeek models' },
  { id: 'qwen-flash', label: 'Qwen Flash', note: 'Fast, low-cost Qwen tier' },
  { id: 'groq', label: 'Groq', note: 'Ultra-fast open-model inference' },
] as const;

export type ProviderId = (typeof PROVIDERS)[number]['id'];

export const DEFAULT_PROVIDER_ID: ProviderId = 'zai';

/** Radio inputs share a group only within one picker instance. */
let instanceSeq = 0;

const providerFor = (id: string): (typeof PROVIDERS)[number] | undefined =>
  PROVIDERS.find((p) => p.id === id);

export class SemProviderPicker extends SemElement {
  static properties = {
    value: { type: String, reflect: true },
  };

  declare value: string;

  #name = '';
  #built = false;
  /** Which option currently holds the roving tabindex (-1 = not yet moved). */
  #roving = -1;

  constructor() {
    super();
    this.#name = `sem-provider-${++instanceSeq}`;
    this.value = DEFAULT_PROVIDER_ID;
  }

  connectedCallback(): void {
    super.connectedCallback();
    this.addEventListener('keydown', this.#onKeydown);
    this.addEventListener('focusin', this.#onFocusin);
    this.addEventListener('change', this.#onChange);
  }

  disconnectedCallback(): void {
    this.removeEventListener('keydown', this.#onKeydown);
    this.removeEventListener('focusin', this.#onFocusin);
    this.removeEventListener('change', this.#onChange);
    super.disconnectedCallback();
  }

  updated(): void {
    // Unknown id: fall back to the default silently — a stale or foreign
    // value must never throw or strand the group with nothing checked.
    if (!providerFor(this.value)) {
      this.value = DEFAULT_PROVIDER_ID;
      return; // the reflected re-update rebuilds with the valid state
    }
    this.#build();
    this.#sync();
  }

  #build(): void {
    if (this.#built) return;
    this.#built = true;
    if (!this.hasAttribute('role')) this.setAttribute('role', 'radiogroup');
    if (!this.hasAttribute('aria-label')) this.setAttribute('aria-label', 'AI provider');
    for (const p of PROVIDERS) {
      const input = document.createElement('input');
      input.type = 'radio';
      input.name = this.#name;
      input.value = p.id;
      input.className = 'sem-provider-input';

      const label = document.createElement('span');
      label.className = 'sem-provider-label';
      label.textContent = p.label;

      const note = document.createElement('span');
      note.className = 'sem-provider-note';
      note.textContent = p.note;

      const option = document.createElement('label');
      option.className = 'sem-provider-option';
      option.append(input, label, note);
      this.appendChild(option);
    }
  }

  #inputs(): HTMLInputElement[] {
    return Array.from(this.querySelectorAll<HTMLInputElement>('input[type="radio"]'));
  }

  /** Checked state + roving tabindex follow `value` / `#roving`. */
  #sync(): void {
    const inputs = this.#inputs();
    if (inputs.length === 0) return;
    if (this.#roving < 0) this.#roving = inputs.findIndex((i) => i.value === this.value);
    const roving = Math.min(Math.max(this.#roving, 0), inputs.length - 1);
    inputs.forEach((input, i) => {
      input.checked = input.value === this.value;
      input.tabIndex = i === roving ? 0 : -1;
    });
  }

  /** One selection path — attribute write lands BEFORE the event dispatch. */
  #select(id: string): void {
    const p = providerFor(id);
    if (!p) return;
    this.value = p.id;
    this.setAttribute('value', p.id);
    this.#sync();
    this.emit('sem-provider-change', { provider: p.id, label: p.label });
  }

  #onChange = (e: Event): void => {
    const t = e.target;
    if (t instanceof HTMLInputElement && t.type === 'radio' && this.contains(t)) {
      this.#select(t.value);
    }
  };

  #onFocusin = (e: Event): void => {
    const t = e.target;
    if (!(t instanceof HTMLInputElement) || !this.contains(t)) return;
    const inputs = this.#inputs();
    const i = inputs.indexOf(t);
    if (i >= 0 && i !== this.#roving) {
      this.#roving = i;
      this.#sync();
    }
  };

  /**
   * Roving tabindex radiogroup (APG): arrows move focus — wrapping — and
   * Space or Enter selects the focused option. Arrows deliberately do NOT
   * select: moving through the list must not commit a provider per step.
   */
  #onKeydown = (e: Event): void => {
    const ke = e as KeyboardEvent;
    const t = ke.target;
    if (!(t instanceof HTMLInputElement) || t.type !== 'radio' || !this.contains(t)) return;
    const inputs = this.#inputs();
    const i = inputs.indexOf(t);
    if (i < 0) return;

    const step =
      ke.key === 'ArrowDown' || ke.key === 'ArrowRight' ? 1 :
      ke.key === 'ArrowUp' || ke.key === 'ArrowLeft' ? -1 : 0;
    if (step !== 0) {
      ke.preventDefault();
      const next = (i + step + inputs.length) % inputs.length;
      this.#roving = next;
      this.#sync();
      inputs[next].focus();
      return;
    }
    if (ke.key === ' ' || ke.key === 'Enter') {
      ke.preventDefault();
      this.#select(inputs[i].value);
    }
  };
}

SemElement.register('sem-provider-picker', SemProviderPicker);
