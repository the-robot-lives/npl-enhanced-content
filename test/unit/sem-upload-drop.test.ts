// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import '../../src/lit/sem-upload-drop.js';

function makeUpload(accept?: string, maxBytes?: number): HTMLElement {
  const el = document.createElement('sem-upload-drop') as HTMLElement;
  if (accept !== undefined) (el as any).accept = accept;
  if (maxBytes !== undefined) (el as any).maxBytes = maxBytes;
  return el;
}

async function mount(el: HTMLElement): Promise<void> {
  document.body.appendChild(el);
  await (el as any).updateComplete;
}

function dropZone(el: HTMLElement): HTMLElement | null {
  return el.shadowRoot!.querySelector('.dropzone');
}

function errorEl(el: HTMLElement): HTMLElement | null {
  return el.shadowRoot!.querySelector('.error');
}

function progressContainer(el: HTMLElement): HTMLElement | null {
  return el.shadowRoot!.querySelector('.progress-container');
}

function fileInput(el: HTMLElement): HTMLInputElement | null {
  return el.shadowRoot!.querySelector('input[type="file"]');
}

function simulateFile(el: HTMLElement, file: File): void {
  const input = fileInput(el)!;
  // Use DataTransfer to set files on the input
  const dt = new DataTransfer();
  dt.items.add(file);
  Object.defineProperty(input, 'files', { value: dt.files, writable: false });
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

function makeFile(name: string, type: string, size: number): File {
  return new File([new ArrayBuffer(size)], name, { type });
}

describe('sem-upload-drop', () => {
  let upload: HTMLElement;

  afterEach(() => {
    if (upload && upload.parentNode) upload.remove();
  });

  describe('rendering', () => {
    it('renders a drop zone', async () => {
      upload = makeUpload();
      await mount(upload);
      expect(dropZone(upload)).not.toBeNull();
    });

    it('renders a hidden file input', async () => {
      upload = makeUpload();
      await mount(upload);
      expect(fileInput(upload)).not.toBeNull();
    });

    it('sets the accept attribute on the file input', async () => {
      upload = makeUpload('image/png,image/jpeg');
      await mount(upload);
      expect(fileInput(upload)!.accept).toBe('image/png,image/jpeg');
    });

    it('shows the accept hint text', async () => {
      upload = makeUpload('image/png,image/jpeg');
      await mount(upload);
      expect(dropZone(upload)!.textContent).toContain('image/png, image/jpeg');
    });

    it('shows max-bytes hint text', async () => {
      upload = makeUpload(undefined, 1048576);
      await mount(upload);
      expect(dropZone(upload)!.textContent).toContain('1 MB');
    });
  });

  describe('keyboard accessibility', () => {
    it('drop zone has tabindex 0', async () => {
      upload = makeUpload();
      await mount(upload);
      expect(dropZone(upload)!.getAttribute('tabindex')).toBe('0');
    });

    it('Enter key on drop zone triggers file picker click', async () => {
      upload = makeUpload();
      await mount(upload);
      const dz = dropZone(upload)!;
      let clicked = false;
      fileInput(upload)!.addEventListener('click', () => { clicked = true; });
      dz.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      expect(clicked).toBe(true);
    });
  });

  describe('file validation', () => {
    it('rejects a file with wrong MIME type', async () => {
      upload = makeUpload('image/png,image/jpeg');
      await mount(upload);
      simulateFile(upload, makeFile('test.txt', 'text/plain', 100));
      await (upload as any).updateComplete;
      expect(errorEl(upload)).not.toBeNull();
      expect(errorEl(upload)!.textContent).toContain('File type not accepted');
      expect(errorEl(upload)!.textContent).toContain('image/png, image/jpeg');
    });

    it('rejects a file that exceeds max-bytes', async () => {
      upload = makeUpload(undefined, 100);
      await mount(upload);
      simulateFile(upload, makeFile('big.png', 'image/png', 500));
      await (upload as any).updateComplete;
      expect(errorEl(upload)).not.toBeNull();
      expect(errorEl(upload)!.textContent).toContain('File too large');
    });

    it('accepts a valid file and starts the progress flow', async () => {
      upload = makeUpload('image/png', 1024);
      await mount(upload);
      simulateFile(upload, makeFile('valid.png', 'image/png', 200));
      await (upload as any).updateComplete;
      expect(errorEl(upload)).toBeNull();
      expect(progressContainer(upload)).not.toBeNull();
    });

    it('error message has role="alert"', async () => {
      upload = makeUpload('image/png');
      await mount(upload);
      simulateFile(upload, makeFile('bad.txt', 'text/plain', 100));
      await (upload as any).updateComplete;
      expect(errorEl(upload)!.getAttribute('role')).toBe('alert');
    });
  });

  describe('three-step progress', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('shows presign step label first', async () => {
      upload = makeUpload('image/png', 10000);
      await mount(upload);
      simulateFile(upload, makeFile('ok.png', 'image/png', 500));
      await (upload as any).updateComplete;
      const label = progressContainer(upload)!.querySelector('.progress-label')!;
      expect(label.textContent).toContain('Presigning');
    });

    it('completes all three steps and emits sem-media-added', async () => {
      upload = makeUpload('image/png', 10000);
      await mount(upload);

      let emitted: any = null;
      upload.addEventListener('sem-media-added', ((e: CustomEvent) => {
        emitted = e.detail;
      }) as EventListener);

      simulateFile(upload, makeFile('my-file.png', 'image/png', 500));
      await (upload as any).updateComplete;

      // Advance through all three steps: 600ms + 1200ms + 400ms = 2200ms
      await vi.advanceTimersByTimeAsync(2200);
      await (upload as any).updateComplete;

      // After the finish timeout (600ms), the event should have fired
      await vi.advanceTimersByTimeAsync(700);
      await (upload as any).updateComplete;

      expect(emitted).not.toBeNull();
      expect(emitted.mime).toBe('image/png');
      expect(emitted.caption).toBe('my-file.png');
      expect(emitted.src).toMatch(/^blob:/);
    });

    it('resets to idle after successful upload', async () => {
      upload = makeUpload('image/png', 10000);
      await mount(upload);
      simulateFile(upload, makeFile('ok.png', 'image/png', 500));
      await (upload as any).updateComplete;

      await vi.advanceTimersByTimeAsync(3000); // well past all steps + finish timeout
      await (upload as any).updateComplete;

      // Should be back to drop zone
      expect(dropZone(upload)).not.toBeNull();
      expect(errorEl(upload)).toBeNull();
    });
  });

  describe('drag and drop', () => {
    it('accepts a file via drop event', async () => {
      upload = makeUpload('image/png', 10000);
      await mount(upload);

      const file = makeFile('dropped.png', 'image/png', 200);
      const dt = new DataTransfer();
      dt.items.add(file);

      const event = new Event('drop', { bubbles: true });
      Object.defineProperty(event, 'dataTransfer', { value: dt, writable: false });
      upload.dispatchEvent(event);
      await (upload as any).updateComplete;

      // Should start progress
      expect(progressContainer(upload)).not.toBeNull();
      expect(errorEl(upload)).toBeNull();
    });
  });
});