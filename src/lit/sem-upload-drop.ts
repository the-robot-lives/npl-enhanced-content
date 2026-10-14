/**
 * sem-upload-drop — drag-and-drop / file-picker upload with fake progress
 * (agent-kit demo stub). Accepts files, validates type and size, then runs a
 * three-step simulated progress (presign → upload → register) and emits
 * `sem-media-added` with the result. Zero-JS: hidden via `:host(:not(:defined))`.
 *
 * Attributes:
 *   accept    — comma-separated MIME types (e.g. "image/png,image/jpeg")
 *   max-bytes — maximum file size in bytes
 */
import { LitElement, html, css, nothing } from 'lit';
import type { PropertyValues } from 'lit';

export interface MediaAddedDetail {
  src: string;
  caption: string;
  mime: string;
}

type StepState = 'idle' | 'presign' | 'upload' | 'register' | 'done';

export class SemUploadDrop extends LitElement {
  static properties = {
    accept: { type: String },
    // Lit lowercases property names for attributes but never dashes them —
    // without the explicit name this would observe `maxbytes`.
    maxBytes: { type: Number, attribute: 'max-bytes' },
  };

  declare accept: string;
  declare maxBytes: number;

  #step: StepState = 'idle';
  #error: string = '';
  #file: File | null = null;
  #progress: number = 0;
  #rafId: number = 0;
  #clickingInput = false;

  createRenderRoot(): LitElement['renderRoot'] {
    return this.attachShadow({ mode: 'open' });
  }

  static styles = css`
    :host(:not(:defined)) { display: none; }
    :host { display: block; }
    .sr-only {
      position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
      overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0;
    }
    .dropzone {
      border: 2px dashed #585b70; border-radius: 10px; padding: 2.5rem 1rem;
      text-align: center; color: #a6adc8; cursor: pointer; background: #181825;
      transition: border-color 0.2s, background 0.2s;
      min-height: 120px; display: flex; align-items: center; justify-content: center;
      flex-direction: column; gap: 0.4rem;
    }
    .dropzone:hover, .dropzone:focus-visible, .dropzone.drag-over {
      border-color: #89b4fa; background: #1e1e2e; outline: 2px solid #89b4fa;
    }
    .dropzone-icon { font-size: 1.8rem; }
    .dropzone-label { font-size: 0.95rem; }
    .dropzone-hint { font-size: 0.8rem; color: #6c7086; }
    .error {
      color: #f38ba8; font-size: 0.85rem; margin-top: 0.5rem;
      padding: 0.4rem 0.6rem; background: rgba(243,139,168,0.1);
      border-radius: 4px;
    }
    .progress-container { margin-top: 1rem; }
    .progress-label { font-size: 0.85rem; color: #a6adc8; margin-bottom: 0.3rem; }
    .progress-track {
      height: 6px; background: #313244; border-radius: 3px; overflow: hidden;
    }
    .progress-fill {
      height: 100%; background: #89b4fa; border-radius: 3px;
      transition: width 0.05s linear;
    }
  `;

  connectedCallback(): void {
    super.connectedCallback();
    this.addEventListener('dragover', this.#onDragOver);
    this.addEventListener('dragleave', this.#onDragLeave);
    this.addEventListener('drop', this.#onDrop);
  }

  disconnectedCallback(): void {
    this.removeEventListener('dragover', this.#onDragOver);
    this.removeEventListener('dragleave', this.#onDragLeave);
    this.removeEventListener('drop', this.#onDrop);
    this.#cancelProgress();
    super.disconnectedCallback();
  }

  #acceptList(): string[] {
    return (this.accept || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }

  render() {
    const acceptList = this.#acceptList();
    return html`
      ${this.#step === 'idle' ? this.#renderDrop(acceptList) : this.#renderProgress()}
      ${this.#error ? html`<div class="error" role="alert">${this.#error}</div>` : nothing}
    `;
  }

  #renderDrop(acceptList: string[]) {
    return html`
      <div class="dropzone"
        tabindex="0" role="button"
        aria-label="Upload a file. Accepted types: ${acceptList.join(', ') || 'any'}"
        @click=${this.#onClick}
        @keydown=${this.#onKey}
      >
        <span class="dropzone-icon" aria-hidden="true">+</span>
        <span class="dropzone-label">Drop files here or click to browse</span>
        <span class="dropzone-hint">
          ${acceptList.length ? `Accepted: ${acceptList.join(', ')}` : 'All file types'}
          ${this.maxBytes ? ` / Max ${this.#formatBytes(this.maxBytes)}` : ''}
        </span>
        <input type="file" class="sr-only"
          accept=${this.accept || nothing}
          @change=${this.#onFileChange}
        >
      </div>
    `;
  }

  #renderProgress() {
    const labels: Record<StepState, string> = {
      idle: '', presign: 'Presigning upload...', upload: 'Uploading...',
      register: 'Registering media...', done: 'Done',
    };
    const label = labels[this.#step] || '';
    return html`
      <div class="progress-container">
        <div class="progress-label">${label}</div>
        <div class="progress-track">
          <div class="progress-fill" style="width:${this.#progress}%"></div>
        </div>
      </div>
    `;
  }

  #onClick(): void {
    if (this.#clickingInput) return;
    this.#clickingInput = true;
    const input = this.shadowRoot?.querySelector('input[type="file"]') as HTMLInputElement | null;
    input?.click();
    this.#clickingInput = false;
  }

  #onKey(e: KeyboardEvent): void {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      this.#onClick();
    }
  }

  #onFileChange(e: Event): void {
    const input = e.target as HTMLInputElement;
    if (input.files?.length) {
      this.#handleFile(input.files[0]);
      input.value = '';
    }
  }

  #onDragOver(e: Event): void {
    e.preventDefault();
    const dz = this.shadowRoot?.querySelector('.dropzone');
    dz?.classList.add('drag-over');
  }

  #onDragLeave(_e: Event): void {
    const dz = this.shadowRoot?.querySelector('.dropzone');
    dz?.classList.remove('drag-over');
  }

  #onDrop(e: Event): void {
    e.preventDefault();
    const dz = this.shadowRoot?.querySelector('.dropzone');
    dz?.classList.remove('drag-over');
    const dt = (e as { dataTransfer?: DataTransfer | null }).dataTransfer;
    const file = dt?.files?.[0];
    if (file) this.#handleFile(file);
  }

  #handleFile(file: File): void {
    this.#error = '';
    this.#file = null;

    const acceptList = this.#acceptList();
    if (acceptList.length > 0 && !acceptList.includes(file.type)) {
      this.#error = `File type not accepted. Allowed: ${acceptList.join(', ')}`;
      this.requestUpdate();
      return;
    }
    if (this.maxBytes && file.size > this.maxBytes) {
      this.#error = `File too large (${this.#formatBytes(file.size)}). Maximum: ${this.#formatBytes(this.maxBytes)}`;
      this.requestUpdate();
      return;
    }

    this.#file = file;
    this.#startProgress();
  }

  #startProgress(): void {
    this.#cancelProgress();
    this.#step = 'presign';
    this.#progress = 0;
    this.requestUpdate();
    this.#animateStep('presign', 600, () => {
      this.#step = 'upload';
      this.#progress = 0;
      this.requestUpdate();
      this.#animateStep('upload', 1200, () => {
        this.#step = 'register';
        this.#progress = 0;
        this.requestUpdate();
        this.#animateStep('register', 400, () => {
          this.#finish();
        });
      });
    });
  }

  #animateStep(_step: StepState, durationMs: number, onDone: () => void): void {
    const start = performance.now();
    const tick = (now: number) => {
      const elapsed = now - start;
      this.#progress = Math.min(100, Math.round((elapsed / durationMs) * 100));
      this.requestUpdate();
      if (elapsed < durationMs) {
        this.#rafId = requestAnimationFrame(tick);
      } else {
        this.#progress = 100;
        this.requestUpdate();
        onDone();
      }
    };
    this.#rafId = requestAnimationFrame(tick);
  }

  #finish(): void {
    if (!this.#file) return;
    this.#step = 'done';
    this.#progress = 100;
    const detail: MediaAddedDetail = {
      src: URL.createObjectURL(this.#file),
      caption: this.#file.name,
      mime: this.#file.type,
    };
    this.dispatchEvent(
      new CustomEvent<MediaAddedDetail>('sem-media-added', {
        bubbles: true, composed: true, detail,
      }),
    );
    // Reset after a brief pause so the user sees "Done"
    setTimeout(() => {
      this.#step = 'idle';
      this.#progress = 0;
      this.#file = null;
      this.#error = '';
      this.requestUpdate();
    }, 600);
  }

  #cancelProgress(): void {
    if (this.#rafId) { cancelAnimationFrame(this.#rafId); this.#rafId = 0; }
  }

  #formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    const mb = bytes / (1024 * 1024);
    return `${Number.isInteger(mb) ? mb.toFixed(0) : mb.toFixed(1)} MB`;
  }
}

if (typeof customElements !== 'undefined' && !customElements.get('sem-upload-drop')) {
  customElements.define('sem-upload-drop', SemUploadDrop);
}