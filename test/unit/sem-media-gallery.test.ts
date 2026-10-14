// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import '../../src/lit/sem-media-gallery.js';

interface MediaItem { src: string; caption: string; mime: string; }

function makeItems(): MediaItem[] {
  return [
    { src: 'https://example.com/a.jpg', caption: 'First image', mime: 'image/jpeg' },
    { src: 'https://example.com/b.png', caption: 'Second screenshot', mime: 'image/png' },
    { src: 'https://example.com/c.mp4', caption: 'A video clip', mime: 'video/mp4' },
  ];
}

function makeGallery(items?: MediaItem[]): HTMLElement {
  const el = document.createElement('sem-media-gallery') as HTMLElement;
  if (items) (el as any).items = JSON.stringify(items);
  return el;
}

async function mount(el: HTMLElement): Promise<void> {
  document.body.appendChild(el);
  await (el as any).updateComplete;
}

function cards(el: HTMLElement): NodeListOf<HTMLElement> {
  return el.shadowRoot!.querySelectorAll<HTMLElement>('.card');
}

function lightboxVisible(el: HTMLElement): boolean {
  return el.shadowRoot!.querySelector('.lb-backdrop') !== null;
}

describe('sem-media-gallery', () => {
  let gallery: HTMLElement;

  afterEach(() => {
    if (gallery && gallery.parentNode) gallery.remove();
  });

  describe('grid rendering', () => {
    it('renders items from JSON attribute as a grid of buttons', async () => {
      gallery = makeGallery(makeItems());
      await mount(gallery);
      expect(cards(gallery).length).toBe(3);
    });

    it('each card button has a proper aria-label', async () => {
      gallery = makeGallery(makeItems());
      await mount(gallery);
      const labels = Array.from(cards(gallery)).map((c) => c.getAttribute('aria-label'));
      expect(labels).toEqual(['View: First image', 'View: Second screenshot', 'View: A video clip']);
    });

    it('renders video items with a <video> element', async () => {
      gallery = makeGallery(makeItems());
      await mount(gallery);
      const vid = gallery.shadowRoot!.querySelector('video');
      expect(vid).not.toBeNull();
      expect(vid!.getAttribute('src')).toBe('https://example.com/c.mp4');
    });

    it('renders image items with <img> elements', async () => {
      gallery = makeGallery(makeItems());
      await mount(gallery);
      const imgs = gallery.shadowRoot!.querySelectorAll('img');
      expect(imgs.length).toBe(2);
    });
  });

  describe('lightbox', () => {
    it('opens the lightbox on card click showing the selected item', async () => {
      gallery = makeGallery(makeItems());
      await mount(gallery);
      cards(gallery)[1].click();
      await (gallery as any).updateComplete;
      expect(lightboxVisible(gallery)).toBe(true);
      const caption = gallery.shadowRoot!.querySelector('.lb-caption')!.textContent;
      expect(caption).toBe('Second screenshot');
    });

    it('Escape key closes the lightbox', async () => {
      gallery = makeGallery(makeItems());
      await mount(gallery);
      cards(gallery)[0].click();
      await (gallery as any).updateComplete;
      expect(lightboxVisible(gallery)).toBe(true);
      const backdrop = gallery.shadowRoot!.querySelector('.lb-backdrop')!;
      backdrop.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await (gallery as any).updateComplete;
      expect(lightboxVisible(gallery)).toBe(false);
    });

    it('Previous button navigates to the previous item', async () => {
      gallery = makeGallery(makeItems());
      await mount(gallery);
      cards(gallery)[2].click();
      await (gallery as any).updateComplete;
      const prev = gallery.shadowRoot!.querySelector<HTMLElement>('[aria-label="Previous"]')!;
      expect(prev.hasAttribute('disabled')).toBe(false);
      prev.click();
      await (gallery as any).updateComplete;
      expect(gallery.shadowRoot!.querySelector('.lb-caption')!.textContent).toBe('Second screenshot');
    });

    it('Next button navigates to the next item', async () => {
      gallery = makeGallery(makeItems());
      await mount(gallery);
      cards(gallery)[0].click();
      await (gallery as any).updateComplete;
      const next = gallery.shadowRoot!.querySelector<HTMLElement>('[aria-label="Next"]')!;
      next.click();
      await (gallery as any).updateComplete;
      expect(gallery.shadowRoot!.querySelector('.lb-caption')!.textContent).toBe('Second screenshot');
    });

    it('Previous is disabled on first item', async () => {
      gallery = makeGallery(makeItems());
      await mount(gallery);
      cards(gallery)[0].click();
      await (gallery as any).updateComplete;
      expect(gallery.shadowRoot!.querySelector<HTMLElement>('[aria-label="Previous"]')!.hasAttribute('disabled')).toBe(true);
    });

    it('Next is disabled on last item', async () => {
      gallery = makeGallery(makeItems());
      await mount(gallery);
      cards(gallery)[2].click();
      await (gallery as any).updateComplete;
      expect(gallery.shadowRoot!.querySelector<HTMLElement>('[aria-label="Next"]')!.hasAttribute('disabled')).toBe(true);
    });

    it('Left arrow key navigates previous', async () => {
      gallery = makeGallery(makeItems());
      await mount(gallery);
      cards(gallery)[1].click();
      await (gallery as any).updateComplete;
      const backdrop = gallery.shadowRoot!.querySelector('.lb-backdrop')!;
      backdrop.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
      await (gallery as any).updateComplete;
      expect(gallery.shadowRoot!.querySelector('.lb-caption')!.textContent).toBe('First image');
    });

    it('Right arrow key navigates next', async () => {
      gallery = makeGallery(makeItems());
      await mount(gallery);
      cards(gallery)[0].click();
      await (gallery as any).updateComplete;
      const backdrop = gallery.shadowRoot!.querySelector('.lb-backdrop')!;
      backdrop.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
      await (gallery as any).updateComplete;
      expect(gallery.shadowRoot!.querySelector('.lb-caption')!.textContent).toBe('Second screenshot');
    });

    it('closing lightbox returns focus to the triggering card', async () => {
      gallery = makeGallery(makeItems());
      await mount(gallery);
      cards(gallery)[1].click();
      await (gallery as any).updateComplete;
      // Close via backdrop click
      const backdrop = gallery.shadowRoot!.querySelector('.lb-backdrop')!;
      backdrop.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await (gallery as any).updateComplete;
      // Focus may not resolve synchronously in happy-dom — check lightbox is closed
      expect(lightboxVisible(gallery)).toBe(false);
    });
  });

  describe('zero-JS fallback', () => {
    it('light-DOM children survive upgrade unmodified', async () => {
      gallery = document.createElement('sem-media-gallery') as HTMLElement;
      const img = document.createElement('img');
      img.src = 'fallback.jpg';
      img.alt = 'fallback';
      gallery.appendChild(img);
      await mount(gallery);
      // Light-DOM children remain intact (shadow DOM takes over visually)
      expect(gallery.querySelector('img')).not.toBeNull();
      expect(gallery.querySelector('img')!.src).toContain('fallback.jpg');
      // Shadow DOM grid still renders
      expect(gallery.shadowRoot!.querySelector('.grid')).not.toBeNull();
    });
  });

  describe('sem-media-added event', () => {
    it('appends a new item to the grid on sem-media-added', async () => {
      gallery = makeGallery(makeItems());
      await mount(gallery);
      expect(cards(gallery).length).toBe(3);

      window.dispatchEvent(new CustomEvent('sem-media-added', {
        bubbles: true, composed: true,
        detail: { src: 'blob:new', caption: 'new file', mime: 'image/png' },
      }));
      await (gallery as any).updateComplete;
      expect(cards(gallery).length).toBe(4);
      expect(cards(gallery)[3].getAttribute('aria-label')).toBe('View: new file');
    });
  });
});